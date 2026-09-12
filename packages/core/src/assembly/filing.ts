// Filing through the app — spec §8.5, schema §7.6 (Task C). The model gets
// the capture's text and note (never the attachment) plus the sets,
// principles, and source slugs it may target, and must answer with one
// strict JSON object: source metadata and proposals. The app validates the
// reply here, then buildFiling copies the passage itself.

import type { BrainFile, BrainSnapshot, InboxFm, PrincipleFm } from '../schema/types';
import { isSetSlug, isSourceSlug } from '../schema/identifiers';
import { setLabel } from '../index/index';
import type { SourceMeta } from '../filing/index';
import type { ProposalParams } from '../proposals/index';
import { estimateTokens } from './index';

export const FILING_PROMPT = `You are filing a capture into a Gnomon brain: a curator's collection of passages (sources) and the principles they wrote themselves. Your job is clerical, never editorial. You never retype the passage; the app copies it. You identify the source and suggest proposals for the curator to decide.

Answer with exactly one JSON object and nothing else: no prose, no code fences. Shape:

{
  "meta": {
    "title": "short curator-facing label for the capture",
    "author": "as printed, or \\"unknown\\"",
    "work": "optional: the book, essay, article, or talk it comes from",
    "year": 1976,
    "locator": "optional: page, section, timestamp, or URL fragment",
    "origin": "optional: URL, ISBN, DOI, or other retrieval handle",
    "tags": ["optional", "lowercase-hyphenated-slugs"]
  },
  "proposals": [
    { "kind": "principle", "title": "a principle this passage could support", "target_set": "ps-xxxx", "rationale": "why" },
    { "kind": "link", "title": "ground that principle in this passage", "target_set": "ps-xxxx", "target": "ps-xxxx/principle-slug", "rationale": "how this passage is evidence for that principle" },
    { "kind": "amendment", "title": "suggested rewording", "target_set": "ps-xxxx", "target": "ps-xxxx/principle-slug", "rationale": "why" },
    { "kind": "tag", "title": "tags to add", "rationale": "why" }
  ]
}

Rules:
- The curator's note, when there is one, is authoritative: whatever author, work, year, page, or origin it names goes into "meta" as written, before anything the passage itself suggests. The rest of the note is the curator's reason for keeping the passage; it is not part of the passage.
- Leave an optional field out rather than guess it. A URL you inferred is a passage that cannot be re-found. "unknown" is a fine author.
- Only use the set slugs, principle refs, and source slugs listed in the material. Never invent one.
- Proposals are suggestions. A "principle" proposal is a principle the curator might write; you do not write it. An empty proposals list is fine.
- A "link" proposal means one thing: add this passage to that principle's grounds, as evidence for it. Use it when the passage supports the principle or bears on it directly. If the passage complicates or contradicts the principle enough that its wording should change, propose an "amendment" instead. Nothing looser than a ground is proposed here.
- Keep titles to one line. Rationales may be any length.`;

export interface FilingPrompt { ok: true; system: string; context: string; tokensUsed: number; }
export type FilingPromptResult = FilingPrompt | { ok: false; error: 'CAPTURE_EXCEEDS_BUDGET'; neededTokens: number; budgetTokens: number };

/** The user-turn material for filing one capture: sets with principles, source slugs, then the capture. */
export function buildFilingPrompt(snapshot: BrainSnapshot, capture: BrainFile<InboxFm>, budgetTokens: number): FilingPromptResult {
  const chunks: string[] = ['## Principle sets you may target'];
  for (const set of snapshot.sets) {
    const slug = set.path.split('/')[1]!;
    chunks.push(`### ${setLabel(set.fm)} — set slug: ${slug}`);
    const principles = snapshot.principlesOf(slug);
    if (principles.length === 0) chunks.push('(no principles yet)');
    for (const p of principles as BrainFile<PrincipleFm>[]) {
      const body = p.body.replace(/\n+$/, '');
      chunks.push(`- ref \`${slug}/${p.path.split('/')[2]!.replace(/\.md$/, '')}\` — ${p.fm.title}${body ? `\n  ${body.split('\n').join('\n  ')}` : ''}`);
    }
  }
  const sources = snapshot.byType('source');
  chunks.push('## Existing sources (slugs you may cite in grounds)');
  chunks.push(sources.length ? sources.map((f) => `- \`${f.path.split('/')[1]}\` — ${f.fm.title}, ${f.fm.author}`).join('\n') : '(none yet)');
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
const PROPOSAL_KEYS = new Set(['kind', 'title', 'target_set', 'target', 'grounds', 'rationale']);
const KINDS = new Set(['principle', 'link', 'tag', 'amendment']);
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
 * Strict: unknown keys, wrong types, and missing conditional fields are
 * refused. With a snapshot, target sets, principles, and grounds must exist.
 */
export function parseFilingReply(text: string, snapshot?: BrainSnapshot): { meta: SourceMeta; proposals: ProposalParams[] } {
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
  const sets = snapshot ? new Set(snapshot.sets.map((s) => s.path.split('/')[1]!)) : null;
  const principles = snapshot ? new Set(snapshot.byType('principle').map((f) => f.path.slice('principles/'.length, -3))) : null;
  const sources = snapshot ? new Set(snapshot.byType('source').map((f) => f.path.split('/')[1]!)) : null;

  const proposals: ProposalParams[] = p.map((item, i) => {
    const where = `proposals[${i}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail(`${where}: must be an object`);
    const o = item as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!PROPOSAL_KEYS.has(k)) fail(`${where}: unknown key '${k}'`);
    const kind = str(o, 'kind', where, true)!;
    if (!KINDS.has(kind)) fail(`${where}: kind must be principle, link, tag, or amendment`);
    const out: ProposalParams = { kind: kind as ProposalParams['kind'], title: str(o, 'title', where, true)!, rationale: str(o, 'rationale', where, true)! };
    const targetSet = str(o, 'target_set', where);
    const target = str(o, 'target', where);
    if (kind === 'principle' || kind === 'amendment' || kind === 'link') {
      if (!targetSet) fail(`${where}: kind '${kind}' requires target_set`);
      if (!isSetSlug(targetSet)) fail(`${where}: target_set '${targetSet}' is not a set slug`);
      if (sets && !sets.has(targetSet)) fail(`${where}: target_set '${targetSet}' is not a set in this brain`);
      out.target_set = targetSet;
    }
    if (kind === 'amendment' || kind === 'link') {
      if (!target) fail(`${where}: kind '${kind}' requires target`);
      if (!/^ps-[^/]+\/[^/]+$/.test(target)) fail(`${where}: target '${target}' must be <set-slug>/<principle-slug>`);
      if (principles && !principles.has(target)) fail(`${where}: target '${target}' is not a principle in this brain`);
      if (!target.startsWith(`${targetSet}/`)) fail(`${where}: target '${target}' is not in target_set '${targetSet}'`);
      out.target = target;
    }
    if (kind === 'tag' && target !== undefined) {
      if (!isSourceSlug(target)) fail(`${where}: target '${target}' is not a source slug`);
      out.target = target;
    }
    if (o['grounds'] !== undefined && o['grounds'] !== null) {
      const g = o['grounds'];
      if (!Array.isArray(g) || !g.every((x) => typeof x === 'string')) fail(`${where}: grounds must be a list of source slugs`);
      for (const x of g as string[]) {
        if (!isSourceSlug(x)) fail(`${where}: grounds entry '${x}' is not a source slug`);
        if (sources && !sources.has(x)) fail(`${where}: grounds entry '${x}' is not a source in this brain`);
      }
      if (g.length) out.grounds = [...new Set(g as string[])];
    }
    return out;
  });
  return { meta, proposals };
}
