// assembly — spec §8.2–§8.4, schema §8. Pure: builds the system prompt and
// the context for a reasoning task from a snapshot, within a token budget.
// Principles are never truncated; passages fill what remains in order of
// first reference; what did not fit is named so the model knows.

import type { BrainFile, BrainSnapshot, NotesFm, PrincipleFm, SetFm, SourceFm } from '../schema/types';
import { setLabel } from '../index/index';
import { parseLinks } from '../links/index';
import { MULTI_SET_RULES, PROMPTS, type Task } from './prompts/index';

export * from './prompts/index';

/** Conservative pre-request estimate (spec §8.2): ceil(utf8Bytes / 3.6). */
export function estimateTokens(text: string): number {
  return Math.ceil(new TextEncoder().encode(text).length / 3.6);
}

export interface AssembleOptions {
  /** where the `_set.md` body goes (spec §8.3, proposal §9.3); default `context` */
  setDescriptionPlacement?: 'context' | 'system';
}

export type AssemblyError =
  | { ok: false; error: 'SETS_EXCEED_BUDGET'; neededTokens: number; budgetTokens: number }
  | { ok: false; error: 'INPUT_EXCEEDS_BUDGET'; neededTokens: number; remainingTokens: number }
  | { ok: false; error: 'EMPTY_SET'; set: string };

export interface Assembly {
  ok: true;
  task: Task;
  system: string;
  /** the user-turn material: sets, principles, passages, and the input */
  context: string;
  /** refs (no `.md`) of principles and passages sent */
  included: string[];
  /** refs of grounding passages named but not sent */
  excluded: string[];
  tokensUsed: number;
  budgetTokens: number;
}

export type AssemblyResult = Assembly | AssemblyError;

const ref = (path: string) => path.replace(/\.md$/, '');
const body = (text: string) => text.replace(/\n+$/, '');
const INPUT_HEADING: Record<Task, string | null> = { reason: '## Question', relate: '## New text', free: '## Message', compare: null };

function principleBlock(p: BrainFile<PrincipleFm>): string {
  const text = body(p.body);
  return `### ${p.fm.order}. ${p.fm.title}\n${text ? `${text}\n` : ''}<!-- ref: ${ref(p.path)} -->`;
}

function passageBlock(src: BrainFile<SourceFm>): string {
  const text = body(src.body);
  return `### Passage: ${src.fm.title} — ${src.fm.author}\n${text ? `${text}\n` : ''}<!-- ref: ${ref(src.path)} -->`;
}

function omittedBlock(snapshot: BrainSnapshot, slug: string, withNotes: boolean): string {
  const src = snapshot.files.get(`sources/${slug}/raw.md`) as BrainFile<SourceFm> | undefined;
  const notes = snapshot.files.get(`sources/${slug}/notes.md`) as BrainFile<NotesFm> | undefined;
  const title = src ? `${src.fm.title} — ${src.fm.author}` : slug;
  const noteText = withNotes && notes ? body(notes.body) : '';
  return `### ${title}\n${noteText ? `${noteText}\n` : ''}<!-- ref: sources/${slug}/raw -->`;
}

const OMITTED_HEADING = '## Passages referenced but not included';

/** Step 3 of schema §8: the passages that were not sent, each with its notes body or just its title line. */
function omittedSection(snapshot: BrainSnapshot, slugs: string[], withNotes: boolean): string[] {
  return slugs.length ? [OMITTED_HEADING, ...slugs.map((slug) => omittedBlock(snapshot, slug, withNotes))] : [];
}

/**
 * Schema §8 fill order. Sets and principles go first and are never cut;
 * the input (question, text, or message) is reserved next so passages can
 * never crowd it out; passages then fill what remains in order of first
 * reference; the rest are named under their own heading.
 */
export function assemble(snapshot: BrainSnapshot, task: Task, selectedSets: string[], input: string, budgetTokens: number, options: AssembleOptions = {}): AssemblyResult {
  if (selectedSets.length === 0) throw new Error('select at least one principle set');
  const placement = options.setDescriptionPlacement ?? 'context';
  const sets: BrainFile<SetFm>[] = selectedSets.map((slug) => {
    const set = snapshot.sets.find((s) => s.path === `principles/${slug}/_set.md`);
    if (!set) throw new Error(`no principle set '${slug}'`);
    return set;
  });
  sets.sort((a, b) => a.fm.order - b.fm.order);

  let system = PROMPTS[task];
  if (sets.length > 1) system += `\n\n${MULTI_SET_RULES}`;
  const systemDescriptions: string[] = [];

  // Step 1: sets and principles, verbatim, in order.
  const chunks: string[] = [];
  const included: string[] = [];
  const groundingOrder: string[] = [];
  for (const set of sets) {
    const slug = set.path.split('/')[1]!;
    const principles = snapshot.principlesOf(slug);
    if (principles.length === 0) return { ok: false, error: 'EMPTY_SET', set: slug };
    const description = body(set.body);
    chunks.push(`## ${setLabel(set.fm)}`);
    if (description) {
      if (placement === 'context') chunks.push(description);
      else systemDescriptions.push(`## ${setLabel(set.fm)}\n${description}`);
    }
    for (const p of principles) {
      chunks.push(principleBlock(p));
      included.push(ref(p.path));
      for (const g of p.fm.grounds) if (!groundingOrder.includes(g)) groundingOrder.push(g);
    }
  }
  if (systemDescriptions.length) system += `\n\nThe curator's framing for each selected set:\n\n${systemDescriptions.join('\n\n')}`;

  const tokens = (parts: string[]) => estimateTokens(parts.join('\n\n'));
  const systemTokens = estimateTokens(system);
  // The mandatory material: sets and principles plus, at minimum, a title line for every
  // grounding passage that might end up not sent (schema §8 step 3). Conservative on purpose.
  const setsTokens = systemTokens + tokens([...chunks, ...omittedSection(snapshot, groundingOrder, false)]);
  if (setsTokens > budgetTokens) return { ok: false, error: 'SETS_EXCEED_BUDGET', neededTokens: setsTokens, budgetTokens };

  // The input is reserved before passages so they can never crowd it out.
  const heading = INPUT_HEADING[task];
  const inputBlock = heading && input.trim() ? `${heading}\n${body(input)}` : null;
  const inputTokens = inputBlock ? estimateTokens(`\n\n${inputBlock}`) : 0;
  if (inputTokens > budgetTokens - setsTokens) {
    return { ok: false, error: 'INPUT_EXCEEDS_BUDGET', neededTokens: inputTokens, remainingTokens: Math.max(0, budgetTokens - setsTokens) };
  }
  const ceiling = budgetTokens - inputTokens;

  // Step 2: grounding passages in order of first reference, until the next would not fit.
  // Each check also reserves the "not included" section for everything after it, so the
  // final total always fits the budget.
  let stopAt = groundingOrder.length;
  let passagesOpened = false;
  for (let i = 0; i < groundingOrder.length; i++) {
    const slug = groundingOrder[i]!;
    const src = snapshot.files.get(`sources/${slug}/raw.md`) as BrainFile<SourceFm> | undefined;
    const rest = omittedSection(snapshot, groundingOrder.slice(i + 1), true);
    const candidate = src && src.fm.type === 'source' ? (passagesOpened ? [passageBlock(src)] : ['## Grounding passages', passageBlock(src)]) : null;
    if (!candidate || systemTokens + tokens([...chunks, ...candidate, ...rest]) > ceiling) {
      stopAt = i;
      break;
    }
    chunks.push(...candidate);
    passagesOpened = true;
    included.push(ref(src!.path));
  }

  // Step 3: what was referenced but not sent, with notes bodies when they fit and title lines otherwise.
  const omitted = groundingOrder.slice(stopAt);
  const excluded = omitted.map((slug) => `sources/${slug}/raw`);
  if (omitted.length) {
    const withNotes = omittedSection(snapshot, omitted, true);
    chunks.push(...(systemTokens + tokens([...chunks, ...withNotes]) <= ceiling ? withNotes : omittedSection(snapshot, omitted, false)));
  }

  // Step 4: the input, last.
  if (inputBlock) chunks.push(inputBlock);

  const context = chunks.join('\n\n');
  return { ok: true, task, system, context, included, excluded, tokensUsed: systemTokens + estimateTokens(context), budgetTokens };
}

export interface Citation {
  /** the ref as written, without brackets or anchor */
  ref: string;
  /** the brain path it names, with `.md` */
  path: string;
  anchor?: string;
  /** whether the snapshot has that file (spec §8.4: unresolvable refs stay visible as plain text) */
  resolved: boolean;
  start: number;
  end: number;
}

/** Every `[[ref]]` in a model response, resolved against the snapshot (spec §8.4). */
export function parseCitations(text: string, snapshot: BrainSnapshot): Citation[] {
  return parseLinks(text, 'maps/_index.md')
    .filter((l) => l.form === 'wiki' || l.form === 'dual')
    .map((l) => {
      const c: Citation = { ref: ref(l.path), path: l.path, resolved: snapshot.files.has(l.path), start: l.start, end: l.end };
      if (l.anchor !== undefined) c.anchor = l.anchor;
      return c;
    });
}

export * from './filing';
