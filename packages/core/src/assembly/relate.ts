// Relate sources to a set — Task F (schema §7.15; tracker 2026-09-16). The
// deliberate act that filing no longer guesses at: the curator picks filed
// sources and a set, the model reads the set's principles and the passages
// in full, and proposes links (a passage as evidence for a principle),
// amendments (a principle whose wording the passage complicates), and
// principles the set lacks. The app writes them as proposal files; the
// curator decides each one.

import type { BrainFile, BrainSnapshot, PrincipleFm, SetFm, SourceFm } from '../schema/types';
import { setLabel } from '../index/index';
import { estimateTokens } from './index';
import { extractJson } from './filing';

export const RELATE_MAX = 10;

export const RELATE_PROMPT = `You are relating passages to a principle set in a Gnomon brain: a curator's collection of passages (sources) and the principles they hold. You propose; the curator decides. Nothing you write changes a principle or becomes one until the curator accepts it.

You are shown the set, with its description and every principle it holds (each with a ref), and then one or more passages in full. Say how the passages bear on the set, as proposals.

Kinds of proposal:
- "link": a passage is evidence for a principle. Accepting adds the passage to that principle's grounds, nothing looser. Name the principle by its ref in "target" and the passages in "grounds".
- "amendment": a passage complicates or contradicts a principle enough that its wording should change. Name the principle in "target", say what should change in the title, and put the passages in "grounds".
- "principle": the set lacks a principle these passages support. One line in the curator's voice, a commitment stated plainly, never a quotation; the passages in "grounds".

Rules:
- Only what the passages support. Do not import your own views or generalize past what a passage says.
- Only the refs shown for the set, and only the slugs of the passages shown. Never invent one.
- Do not propose a link to a principle that already lists that passage among its grounds, and do not restate a principle the set already holds.
- At most ${RELATE_MAX} proposals. Fewer, well-grounded, beats more; none is a fine answer when the passages do not bear on the set.
- The rationale is two or three sentences: which passage, what in it, and why.

Answer with exactly one JSON object and nothing else: no prose, no code fences. Shape:

{
  "proposals": [
    { "kind": "link", "title": "why this passage grounds that principle, one line", "target": "ps-xxxx/principle-slug", "grounds": ["source-slug"], "rationale": "..." },
    { "kind": "amendment", "title": "what should change, one line", "target": "ps-xxxx/principle-slug", "grounds": ["source-slug"], "rationale": "..." },
    { "kind": "principle", "title": "the principle, one line", "grounds": ["source-slug"], "rationale": "..." }
  ]
}`;

export interface RelatePrompt { ok: true; system: string; context: string; tokensUsed: number; passages: number; principlesOmitted: number; }
export type RelatePromptResult = RelatePrompt | { ok: false; error: 'SOURCES_EXCEED_BUDGET'; neededTokens: number; budgetTokens: number };

const passageChunk = (f: BrainFile<SourceFm>): string => {
  const slug = f.path.split('/')[1]!;
  const where = [f.fm.work, f.fm.year].filter((x) => x !== undefined && x !== '').join(', ');
  return `### Passage: ${f.fm.title} — ${f.fm.author}${where ? ` (${where})` : ''}\nslug: \`${slug}\`\n\n${f.body.replace(/\n+$/, '')}`;
};

function setOf(snapshot: BrainSnapshot, setSlug: string): BrainFile<SetFm> {
  const set = snapshot.sets.find((s) => s.path === `principles/${setSlug}/_set.md`);
  if (!set) throw new Error(`no set '${setSlug}'`);
  return set;
}

/** The user-turn material: the set with its principles (refs, bodies, current grounds), then the chosen passages in full. Passages must fit; principles trim from the end first. */
export function buildRelatePrompt(snapshot: BrainSnapshot, sourceSlugs: string[], setSlug: string, budgetTokens: number): RelatePromptResult {
  const set = setOf(snapshot, setSlug);
  const sources = sourceSlugs.map((slug) => {
    const f = snapshot.files.get(`sources/${slug}/raw.md`) as BrainFile<SourceFm> | undefined;
    if (!f || f.fm.type !== 'source') throw new Error(`no source '${slug}'`);
    return f;
  });
  const systemTokens = estimateTokens(RELATE_PROMPT);
  const passages = ['## The passages', ...sources.map(passageChunk)].join('\n\n');
  const head = [`## The set: ${setLabel(set.fm)} — set slug: ${setSlug}`, set.body.replace(/\n+$/, '') || '(no description)'].join('\n\n');
  const fixed = systemTokens + estimateTokens(head) + estimateTokens(passages) + estimateTokens('\n\n## The principles it holds\n\n(none)');
  if (fixed > budgetTokens) return { ok: false, error: 'SOURCES_EXCEED_BUDGET', neededTokens: fixed, budgetTokens };

  const principles = snapshot.principlesOf(setSlug) as BrainFile<PrincipleFm>[];
  const lines = principles.map((p) => {
    const ref = `${setSlug}/${p.path.split('/')[2]!.replace(/\.md$/, '')}`;
    const body = p.body.trim() ? `\n  ${p.body.replace(/\n+$/, '').split('\n').join('\n  ')}` : '';
    const grounds = p.fm.grounds.length ? `\n  grounds: ${p.fm.grounds.map((g) => `\`${g}\``).join(', ')}` : '';
    return `- ref \`${ref}\` — ${p.fm.title}${body}${grounds}`;
  });
  let kept = lines.length;
  let used = fixed + lines.reduce((n, l) => n + estimateTokens(l), 0);
  while (kept > 0 && used > budgetTokens) { kept--; used -= estimateTokens(lines[kept]!); }
  const omitted = lines.length - kept;
  const held = lines.length === 0 ? '(none)' : [...lines.slice(0, kept), ...(omitted ? [`(${omitted} more not shown, for room)`] : [])].join('\n');
  const context = [head, `## The principles it holds\n\n${held}`, passages].join('\n\n');
  return { ok: true, system: RELATE_PROMPT, context, tokensUsed: systemTokens + estimateTokens(context), passages: sources.length, principlesOmitted: omitted };
}

export interface RelateEntry { kind: 'link' | 'amendment' | 'principle'; title: string; rationale: string; target?: string; grounds: string[] }

export class RelateReplyError extends Error {
  override name = 'RelateReplyError';
}
function fail(msg: string): never {
  throw new RelateReplyError(msg);
}

/**
 * Validate a model's relate reply. Strict: at most RELATE_MAX entries; a
 * known kind; a one-line title and a rationale; a target that is a principle
 * of the set (link, amendment); grounds only among the chosen sources, at
 * least one; no link whose passages the target already lists; no principle
 * the set already holds; duplicates within the reply dropped. An empty list
 * is a valid answer.
 */
export function parseRelateReply(text: string, snapshot: BrainSnapshot, sourceSlugs: string[], setSlug: string): RelateEntry[] {
  setOf(snapshot, setSlug);
  let root: unknown;
  try {
    root = extractJson(text);
  } catch (e) {
    fail((e as Error).message);
  }
  if (!root || typeof root !== 'object' || Array.isArray(root)) fail('reply must be a JSON object');
  const r = root as Record<string, unknown>;
  for (const k of Object.keys(r)) if (k !== 'proposals') fail(`unknown top-level key '${k}'`);
  const list = r['proposals'] ?? [];
  if (!Array.isArray(list)) fail("'proposals' must be a list");
  if (list.length > RELATE_MAX) fail(`the reply proposes ${list.length}; at most ${RELATE_MAX}`);
  const chosen = new Set(sourceSlugs);
  const principles = new Map((snapshot.principlesOf(setSlug) as BrainFile<PrincipleFm>[]).map((p) => [`${setSlug}/${p.path.split('/')[2]!.replace(/\.md$/, '')}`, p]));
  const held = new Set([...principles.values()].map((p) => p.fm.title.trim().toLowerCase()));
  const seen = new Set<string>();
  const out: RelateEntry[] = [];
  list.forEach((item, i) => {
    const where = `proposals[${i}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail(`${where}: must be an object`);
    const o = item as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!['kind', 'title', 'rationale', 'target', 'grounds'].includes(k)) fail(`${where}: unknown key '${k}'`);
    const kind = o['kind'];
    if (kind !== 'link' && kind !== 'amendment' && kind !== 'principle') fail(`${where}: kind must be link, amendment, or principle`);
    const title = o['title'];
    if (typeof title !== 'string' || title.trim() === '') fail(`${where}: 'title' is required`);
    if (/[\r\n]/.test(title.trim())) fail(`${where}: 'title' must be one line`);
    const rationale = o['rationale'];
    if (typeof rationale !== 'string' || rationale.trim() === '') fail(`${where}: 'rationale' is required`);
    const g = o['grounds'];
    if (!Array.isArray(g) || g.length === 0 || !g.every((x) => typeof x === 'string')) fail(`${where}: 'grounds' must name at least one of the passages shown`);
    for (const x of g as string[]) if (!chosen.has(x)) fail(`${where}: ground '${x}' is not one of the passages shown`);
    const grounds = [...new Set(g as string[])];
    const entry: RelateEntry = { kind, title: title.trim(), rationale: rationale.trim().replace(/\n*$/, '\n'), grounds };
    if (kind === 'link' || kind === 'amendment') {
      const target = o['target'];
      if (typeof target !== 'string' || !principles.has(target)) fail(`${where}: target '${String(target)}' is not a principle of ${setLabel(setOf(snapshot, setSlug).fm)}`);
      if (kind === 'link' && grounds.every((x) => principles.get(target)!.fm.grounds.includes(x))) fail(`${where}: '${target}' already lists ${grounds.join(', ')} among its grounds`);
      entry.target = target;
    } else {
      if (o['target'] !== undefined) fail(`${where}: a principle proposal names no target`);
      if (held.has(entry.title.toLowerCase())) fail(`${where}: '${entry.title}' is a principle the set already holds`);
    }
    const key = `${kind}|${entry.target ?? ''}|${entry.title.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  });
  return out;
}
