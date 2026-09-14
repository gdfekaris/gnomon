// Derive principles from sources — Task E (tracker, 2026-09-14). The model
// gets the target set's description and existing principles, then the
// chosen passages in full, and answers with strict JSON: candidate
// principles, one line each, with a rationale and the sources each rests
// on. The app writes them as proposals; the curator decides each one.

import type { BrainFile, BrainSnapshot, PrincipleFm, SourceFm } from '../schema/types';
import { setLabel } from '../index/index';
import { estimateTokens } from './index';
import { extractJson } from './filing';

export const DERIVE_MAX = 20;

export const DERIVE_PROMPT = `You are deriving principles from passages in a Gnomon brain: a curator's collection of passages (sources) and the principles they hold. You propose; the curator decides. Nothing you write becomes a principle until the curator accepts it.

You are shown the target set, with its description and the principles it already holds, and then one or more passages in full. Derive principles from the passages.

Rules:
- Derive only what the passages support. Do not import your own views, and do not generalize past what a passage says.
- Write each principle in the curator's voice, as a commitment stated plainly in one line: "Take the right choice now, not the comfortable one later." No hedging, no "one should consider", no quotation as a principle.
- Give three to ten principles for one passage, by its length and richness; up to ${DERIVE_MAX} for several. Fewer, well-grounded, beats more.
- Every principle names the passages it rests on by slug, at least one, from the passages shown.
- Do not restate a principle the set already holds. Propose only what the set lacks.
- The rationale is two or three sentences: which passage, what in it, and why it yields this principle.

Answer with exactly one JSON object and nothing else: no prose, no code fences. Shape:

{
  "principles": [
    { "title": "the principle, one line", "rationale": "which passage and why", "grounds": ["source-slug"] }
  ]
}`;

export interface DerivePrompt { ok: true; system: string; context: string; tokensUsed: number; passages: number; principlesOmitted: number; }
export type DerivePromptResult = DerivePrompt | { ok: false; error: 'SOURCES_EXCEED_BUDGET'; neededTokens: number; budgetTokens: number };

const passageChunk = (f: BrainFile<SourceFm>): string => {
  const slug = f.path.split('/')[1]!;
  const where = [f.fm.work, f.fm.year].filter((x) => x !== undefined && x !== '').join(', ');
  return `### Passage: ${f.fm.title} — ${f.fm.author}${where ? ` (${where})` : ''}\nslug: \`${slug}\`\n\n${f.body.replace(/\n+$/, '')}`;
};

/** The user-turn material: the target set and what it holds, then the chosen passages in full. Passages must fit; principles trim first. `null` is a new, empty set. */
export function buildDerivePrompt(snapshot: BrainSnapshot, sourceSlugs: string[], targetSet: string | null, budgetTokens: number): DerivePromptResult {
  const set = targetSet === null ? null : snapshot.sets.find((s) => s.path === `principles/${targetSet}/_set.md`);
  if (targetSet !== null && !set) throw new Error(`no set '${targetSet}'`);
  const sources = sourceSlugs.map((slug) => {
    const f = snapshot.files.get(`sources/${slug}/raw.md`) as BrainFile<SourceFm> | undefined;
    if (!f || f.fm.type !== 'source') throw new Error(`no source '${slug}'`);
    return f;
  });
  const systemTokens = estimateTokens(DERIVE_PROMPT);
  const passages = ['## The passages', ...sources.map(passageChunk)].join('\n\n');
  const head = set ? [`## The target set: ${setLabel(set.fm)}`, set.body.replace(/\n+$/, '') || '(no description)'].join('\n\n') : '## The target set: a new set, empty\n\n(no description yet)';
  const fixed = systemTokens + estimateTokens(head) + estimateTokens(passages) + estimateTokens('\n\n## Principles the set already holds\n\n(none)');
  if (fixed > budgetTokens) return { ok: false, error: 'SOURCES_EXCEED_BUDGET', neededTokens: fixed, budgetTokens };

  const principles = targetSet === null ? [] : (snapshot.principlesOf(targetSet) as BrainFile<PrincipleFm>[]);
  const lines = principles.map((p) => `- ${p.fm.title}${p.body.trim() ? `\n  ${p.body.replace(/\n+$/, '').split('\n').join('\n  ')}` : ''}`);
  let kept = lines.length;
  let used = fixed + lines.reduce((n, l) => n + estimateTokens(l), 0);
  while (kept > 0 && used > budgetTokens) { kept--; used -= estimateTokens(lines[kept]!); }
  const omitted = lines.length - kept;
  const held = lines.length === 0 ? '(none)' : [...lines.slice(0, kept), ...(omitted ? [`(${omitted} more not shown, for room)`] : [])].join('\n');
  const context = [head, `## Principles the set already holds\n\n${held}`, passages].join('\n\n');
  return { ok: true, system: DERIVE_PROMPT, context, tokensUsed: systemTokens + estimateTokens(context), passages: sources.length, principlesOmitted: omitted };
}

export interface DeriveEntry { title: string; rationale: string; grounds: string[] }

export class DeriveReplyError extends Error {
  override name = 'DeriveReplyError';
}
function fail(msg: string): never {
  throw new DeriveReplyError(msg);
}

/**
 * Validate a model's derive reply. Strict: one to twenty entries; a one-line
 * title; a rationale; grounds only among the chosen sources; nothing the
 * target set already holds; duplicate titles within the reply dropped.
 */
export function parseDeriveReply(text: string, snapshot: BrainSnapshot, sourceSlugs: string[], targetSet: string | null): DeriveEntry[] {
  let root: unknown;
  try {
    root = extractJson(text);
  } catch (e) {
    fail((e as Error).message);
  }
  if (!root || typeof root !== 'object' || Array.isArray(root)) fail('reply must be a JSON object');
  const r = root as Record<string, unknown>;
  for (const k of Object.keys(r)) if (k !== 'principles') fail(`unknown top-level key '${k}'`);
  const list = r['principles'];
  if (!Array.isArray(list)) fail("'principles' must be a list");
  if (list.length === 0) fail('the reply proposes no principles');
  if (list.length > DERIVE_MAX) fail(`the reply proposes ${list.length} principles; at most ${DERIVE_MAX}`);
  const chosen = new Set(sourceSlugs);
  const held = new Set(targetSet === null ? [] : (snapshot.principlesOf(targetSet) as BrainFile<PrincipleFm>[]).map((p) => p.fm.title.trim().toLowerCase()));
  const seen = new Set<string>();
  const out: DeriveEntry[] = [];
  list.forEach((item, i) => {
    const where = `principles[${i}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail(`${where}: must be an object`);
    const o = item as Record<string, unknown>;
    for (const k of Object.keys(o)) if (k !== 'title' && k !== 'rationale' && k !== 'grounds') fail(`${where}: unknown key '${k}'`);
    const title = o['title'];
    if (typeof title !== 'string' || title.trim() === '') fail(`${where}: 'title' is required`);
    if (/[\r\n]/.test(title.trim())) fail(`${where}: 'title' must be one line`);
    const rationale = o['rationale'];
    if (typeof rationale !== 'string' || rationale.trim() === '') fail(`${where}: 'rationale' is required`);
    const g = o['grounds'];
    if (!Array.isArray(g) || g.length === 0 || !g.every((x) => typeof x === 'string')) fail(`${where}: 'grounds' must name at least one of the passages shown`);
    for (const x of g as string[]) if (!chosen.has(x)) fail(`${where}: ground '${x}' is not one of the passages shown`);
    const key = title.trim().toLowerCase();
    if (held.has(key)) fail(`${where}: '${title.trim()}' is a principle the set already holds`);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ title: title.trim(), rationale: rationale.trim().replace(/\n*$/, '\n'), grounds: [...new Set(g as string[])] });
  });
  return out;
}
