// Filing through the app — spec §8.5, schema §7.6 (Task C). The model gets
// the capture's text and note (never the attachment) plus the brain's tag
// vocabulary, and must answer with one strict JSON object: source metadata
// and, at most four, principles the passage alone supports, which land as
// proposals for the reserve (schema §7.14). Nothing about the sets is sent:
// relating a source to a set is Task F (relate.ts), a deliberate act. The app
// validates the reply here, then buildFiling copies the passage itself.

import type { BrainFile, BrainSnapshot, InboxFm } from '../schema/types';
import { isSourceSlug } from '../schema/identifiers';
import { RESERVE_SLUG } from '../schema/paths';
import type { SourceMeta } from '../filing/index';
import type { ProposalParams } from '../proposals/index';
import { estimateTokens } from './index';

/** The most principles one filing may propose (schema §7.6). Zero is the common case for a short passage. */
export const FILING_MAX = 4;

export const FILING_PROMPT = `You are filing a capture into a Gnomon brain: a curator's collection of passages (sources) and the principles they wrote themselves. Your job is clerical, never editorial. You never retype the passage; the app copies it. You identify the source, tag it, and name any principle the passage alone supports, for the curator to decide.

Answer with exactly one JSON object and nothing else: no prose, no code fences. Shape:

{
  "meta": {
    "title": "short curator-facing label for the capture",
    "author": "as printed, or \\"unknown\\"",
    "work": "optional: the book, essay, article, or talk it comes from",
    "year": 1976,
    "locator": "optional: page, section, timestamp, or URL fragment",
    "origin": "optional: URL, ISBN, DOI, or other retrieval handle",
    "tags": ["lowercase-hyphenated-slugs"]
  },
  "proposals": [
    { "title": "a principle this passage supports, one line", "rationale": "what in the passage supports it" }
  ]
}

Rules:
- The curator's note, when there is one, is authoritative: whatever author, work, year, page, or origin it names goes into "meta" as written, before anything the passage itself suggests. The rest of the note is the curator's reason for keeping the passage; it is not part of the passage.
- Leave an optional field out rather than guess it. A URL you inferred is a passage that cannot be re-found. "unknown" is a fine author.
- Tags: prefer the brain's existing tags, listed in the material, so that captures on one subject gather under one word; add a new tag only when none of them fits. Two or three tags; none is fine.
- Proposals are principles the passage alone supports: only what this passage says, nothing imported and nothing generalized past it. Each is one line in the curator's voice, a commitment stated plainly, never a quotation. A sentence-long capture usually supports none or one; a rich passage may support up to ${FILING_MAX}. Never more than ${FILING_MAX}, and an empty list is the right answer more often than not. They go to the curator's reserve, not into any set; the curator places them.
- Keep titles to one line. Rationales may be any length.`;

export interface FilingPrompt { ok: true; system: string; context: string; tokensUsed: number; }
export type FilingPromptResult = FilingPrompt | { ok: false; error: 'CAPTURE_EXCEEDS_BUDGET'; neededTokens: number; budgetTokens: number };

/** The brain's tags with how many files carry each, most used first, then by name. */
export function tagVocabulary(snapshot: BrainSnapshot): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const f of snapshot.files.values()) {
    if (f.fm.type === 'index') continue;
    for (const t of new Set(f.fm.tags ?? [])) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts].sort(([a, ca], [b, cb]) => cb - ca || (a < b ? -1 : a > b ? 1 : 0));
}

/** The user-turn material for filing one capture: the tag vocabulary, then the capture with its note. No set is sent. */
export function buildFilingPrompt(snapshot: BrainSnapshot, capture: BrainFile<InboxFm>, budgetTokens: number): FilingPromptResult {
  const chunks: string[] = ['## Tags in use'];
  const tags = tagVocabulary(snapshot);
  chunks.push(tags.length ? tags.map(([t, n]) => `- ${t} (${n})`).join('\n') : '(none yet)');
  chunks.push('## The capture');
  if (capture.fm.note) chunks.push(`Curator's note: ${capture.fm.note}`);
  if (capture.fm.attachment) chunks.push(`An attachment (${capture.fm.attachment}) is kept beside the capture; it is not shown to you.`);
  chunks.push(capture.body.replace(/\n+$/, ''));
  const context = chunks.join('\n\n');
  const tokensUsed = estimateTokens(FILING_PROMPT) + estimateTokens(context);
  if (tokensUsed > budgetTokens) return { ok: false, error: 'CAPTURE_EXCEEDS_BUDGET', neededTokens: tokensUsed, budgetTokens };
  return { ok: true, system: FILING_PROMPT, context, tokensUsed };
}

export class FilingReplyError extends Error {
  override name = 'FilingReplyError';
}

const META_KEYS = new Set(['title', 'author', 'work', 'year', 'locator', 'origin', 'tags', 'slug']);
const PROPOSAL_KEYS = new Set(['kind', 'title', 'rationale']);
const TAG = /^[a-z0-9][a-z0-9-]*$/;

function fail(msg: string): never {
  throw new FilingReplyError(msg);
}
function str(o: Record<string, unknown>, key: string, where: string, required = false): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) {
    if (required) fail(`${where}: '${key}' is required`);
    return undefined;
  }
  if (typeof v !== 'string' || v.trim() === '') fail(`${where}: '${key}' must be a non-empty string`);
  return v.trim();
}

/** The JSON object in a reply, tolerating code fences or stray prose around it. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) fail('reply contains no JSON object');
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (e) {
    fail(`reply is not valid JSON: ${(e as Error).message}`);
  }
}

/**
 * Validate a model's filing reply into SourceMeta and ProposalParams.
 * Strict: unknown keys, wrong types, and a bad tag or slug are refused;
 * proposals are principles only, at most FILING_MAX, each a one-line title
 * with a rationale, and every one targets the reserve. buildFiling adds the
 * new source as its ground.
 */
export function parseFilingReply(text: string): { meta: SourceMeta; proposals: ProposalParams[] } {
  const root = extractJson(text);
  if (!root || typeof root !== 'object' || Array.isArray(root)) fail('reply must be a JSON object');
  const r = root as Record<string, unknown>;
  for (const k of Object.keys(r)) if (k !== 'meta' && k !== 'proposals') fail(`unknown top-level key '${k}'`);
  const m = r['meta'];
  if (!m || typeof m !== 'object' || Array.isArray(m)) fail("'meta' must be an object");
  const mo = m as Record<string, unknown>;
  for (const k of Object.keys(mo)) if (!META_KEYS.has(k)) fail(`meta: unknown key '${k}'`);

  const meta: SourceMeta = { title: str(mo, 'title', 'meta', true)!, author: str(mo, 'author', 'meta', true)! };
  for (const k of ['work', 'locator', 'origin'] as const) {
    const v = str(mo, k, 'meta');
    if (v !== undefined) meta[k] = v;
  }
  if (mo['year'] !== undefined && mo['year'] !== null) {
    const y = mo['year'];
    if (typeof y !== 'number' || !Number.isInteger(y)) fail("meta: 'year' must be an integer");
    meta.year = y;
  }
  if (mo['tags'] !== undefined && mo['tags'] !== null) {
    const t = mo['tags'];
    if (!Array.isArray(t) || !t.every((x) => typeof x === 'string')) fail("meta: 'tags' must be a list of strings");
    const tags = (t as string[]).map((x) => x.trim().toLowerCase()).filter(Boolean);
    for (const x of tags) if (!TAG.test(x)) fail(`meta: tag '${x}' is not a lowercase hyphenated slug`);
    if (tags.length) meta.tags = [...new Set(tags)];
  }
  const slug = str(mo, 'slug', 'meta');
  if (slug !== undefined) {
    if (!isSourceSlug(slug)) fail(`meta: slug '${slug}' is malformed`);
    meta.slug = slug;
  }

  const p = r['proposals'] ?? [];
  if (!Array.isArray(p)) fail("'proposals' must be a list");
  if (p.length > FILING_MAX) fail(`the reply proposes ${p.length} principles; a filing proposes at most ${FILING_MAX}`);
  const seen = new Set<string>();
  const proposals: ProposalParams[] = [];
  p.forEach((item, i) => {
    const where = `proposals[${i}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail(`${where}: must be an object`);
    const o = item as Record<string, unknown>;
    const kind = str(o, 'kind', where);
    if (kind !== undefined && kind !== 'principle') fail(`${where}: kind '${kind}' is not proposed at filing; only principles for the reserve are`);
    for (const k of Object.keys(o)) if (!PROPOSAL_KEYS.has(k)) fail(`${where}: unknown key '${k}'; a filing proposes principles for the reserve and nothing else`);
    const title = str(o, 'title', where, true)!;
    if (/[\r\n]/.test(title)) fail(`${where}: 'title' must be one line`);
    const rationale = str(o, 'rationale', where, true)!;
    const key = title.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    proposals.push({ kind: 'principle', title, target_set: RESERVE_SLUG, rationale });
  });
  return { meta, proposals };
}
