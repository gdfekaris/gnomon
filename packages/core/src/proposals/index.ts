// proposals — spec §7.5, schema §3.5, §4.7, §7.10. One file per proposal,
// sequential ids within a UTC day, and a decision that rewrites `status`
// and `updated` only.

import type { BrainFile, BrainSnapshot, CommitBatch, FileWrite, PrincipleFm, ProposalFm } from '../schema/types';
import { RESERVE_SLUG } from '../schema/paths';
import { slugify } from '../sets/index';
import { ValidationError } from '../schema/issues';
import { tryParseFile } from '../schema/parse';
import { serializeFile } from '../schema/serialize';
import { setLabel, withIndexWrites } from '../index/index';

/** What a filer (model or agent) proposes; the filing fills in the rest (spec §8.5). */
export interface ProposalParams {
  kind: ProposalFm['kind'];
  title: string;
  target_set?: string;
  target?: string;
  grounds?: string[];
  rationale: string;
}

export interface BuildProposalParams extends ProposalParams {
  id: string;
  from_source?: string;
  curated: 'human' | 'agent-proposed';
  tags?: string[];
  now: string;
}

/** `P-<YYYYMMDD>-<nnn>`: one past the day's highest existing number. `taken` covers ids drawn earlier in the same batch. */
export function nextProposalId(s: BrainSnapshot, nowUtc: string, taken: Iterable<string> = []): string {
  const day = nowUtc.slice(0, 10).replace(/-/g, '');
  const prefix = `P-${day}-`;
  let max = 0;
  const consider = (id: string) => {
    if (id.startsWith(prefix)) max = Math.max(max, Number(id.slice(prefix.length)));
  };
  for (const f of s.byType('proposal')) consider(f.path.slice('maps/proposals/'.length, -3));
  for (const id of taken) consider(id);
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

/** A schema §4.7 file. Throws ValidationError if the kind's conditional fields are missing. */
export function buildProposal(p: BuildProposalParams): FileWrite {
  const fm: Record<string, unknown> = {
    type: 'proposal', kind: p.kind, title: p.title, target_set: p.target_set, target: p.target, from_source: p.from_source,
    grounds: p.grounds, status: 'open', tags: p.tags, curated: p.curated, created: p.now, updated: p.now,
  };
  for (const k of Object.keys(fm)) if (fm[k] === undefined) delete fm[k];
  const path = `maps/proposals/${p.id}.md`;
  const text = serializeFile({ path, sha: '', fm: fm as unknown as ProposalFm, body: p.rationale, encrypted: false });
  const parsed = tryParseFile(path, text);
  if (!parsed.ok) throw new ValidationError(parsed.issues);
  return { path, text };
}

/** What a derive reply yields, one per principle (Task E); the sources it rests on, at least one. */
export interface DeriveParams { title: string; rationale: string; grounds: string[] }

/**
 * Schema §7.12: one proposal file per derived principle, kind `principle`, `curated: agent-proposed`,
 * `grounds` as given and no `from_source` (several sources may stand behind one principle), ids
 * sequential within the day, indexes riding along. Message `Derive: {n} proposals for {set label}`.
 */
export function buildDerive(s: BrainSnapshot, targetSet: string, entries: DeriveParams[], opts: { now: string }): CommitBatch {
  const set = s.sets.find((f) => f.path === `principles/${targetSet}/_set.md`);
  if (!set) throw new Error(`no set '${targetSet}'`);
  if (entries.length === 0) throw new Error('nothing to derive');
  const drawn: string[] = [];
  const writes: FileWrite[] = entries.map((e) => {
    const id = nextProposalId(s, opts.now, drawn);
    drawn.push(id);
    return buildProposal({ id, kind: 'principle', title: e.title, target_set: targetSet, grounds: [...new Set(e.grounds)], rationale: e.rationale, curated: 'agent-proposed', now: opts.now });
  });
  const n = entries.length;
  return withIndexWrites(s, { message: `Derive: ${n} proposal${n === 1 ? '' : 's'} for ${setLabel(set.fm)}`, expectedHead: s.head, writes, deletes: [] });
}

export interface RelateParams { kind: 'link' | 'amendment' | 'principle'; title: string; rationale: string; target?: string; grounds: string[] }

/**
 * Schema §7.15 (Task F): one proposal file per entry for the set, a link or
 * amendment with its `target`, a principle with `target_set`; every entry
 * carries `target_set` and `grounds` (the chosen sources) and no
 * `from_source`; ids sequential within the day, indexes riding along.
 * Message `Relate: {n} proposals for {set label}`.
 */
export function buildRelate(s: BrainSnapshot, setSlug: string, entries: RelateParams[], opts: { now: string }): CommitBatch {
  const set = s.sets.find((f) => f.path === `principles/${setSlug}/_set.md`);
  if (!set) throw new Error(`no set '${setSlug}'`);
  if (entries.length === 0) throw new Error('nothing to propose');
  const drawn: string[] = [];
  const writes: FileWrite[] = entries.map((e) => {
    const id = nextProposalId(s, opts.now, drawn);
    drawn.push(id);
    return buildProposal({ id, kind: e.kind, title: e.title, target_set: setSlug, ...(e.target !== undefined ? { target: e.target } : {}), grounds: [...new Set(e.grounds)], rationale: e.rationale, curated: 'agent-proposed', now: opts.now });
  });
  const n = entries.length;
  return withIndexWrites(s, { message: `Relate: ${n} proposal${n === 1 ? '' : 's'} for ${setLabel(set.fm)}`, expectedHead: s.head, writes, deletes: [] });
}

export interface KeepEntry { id: string; title: string; body: string; grounds: string[] }

/**
 * Schema §7.16: several reserve proposals kept in one commit. Each is flipped
 * to `accepted` and its principle written into the reserve at a unique slug,
 * from the draft the app supplies (the same pre-fill a single accept shows).
 * Message `Keep: {n} proposals in reserve`.
 */
export function keepInReserve(s: BrainSnapshot, entries: KeepEntry[], now: string): CommitBatch {
  if (entries.length === 0) throw new Error('nothing to keep');
  const writes: FileWrite[] = [];
  const taken = new Set(s.principlesOf(RESERVE_SLUG).map((f) => f.path));
  for (const e of entries) {
    const prev = proposalAt(s, e.id);
    if (prev.fm.kind !== 'principle' || prev.fm.target_set !== RESERVE_SLUG) throw new Error(`${e.id} is not a principle proposal for the reserve`);
    if (prev.fm.status !== 'open') throw new Error(`${e.id} is already ${prev.fm.status}`);
    writes.push({ path: prev.path, text: serializeFile({ ...prev, fm: { ...prev.fm, status: 'accepted', updated: now } }) });
    let slug = slugify(e.title);
    for (let n = 2; taken.has(`principles/${RESERVE_SLUG}/${slug}.md`); n++) slug = `${slugify(e.title).slice(0, 60 - `-${n}`.length).replace(/-+$/, '')}-${n}`;
    const path = `principles/${RESERVE_SLUG}/${slug}.md`;
    taken.add(path);
    const fm: PrincipleFm = { type: 'principle', title: e.title, set: RESERVE_SLUG, grounds: e.grounds, curated: 'human', created: now, updated: now };
    writes.push({ path, text: serializeFile({ path, sha: '', fm, body: e.body, encrypted: false }) });
  }
  const n = entries.length;
  return withIndexWrites(s, { message: `Keep: ${n} proposal${n === 1 ? '' : 's'} in reserve`, expectedHead: s.head, writes, deletes: [] });
}

/** Schema §7.16: several proposals declined (or accepted) in one commit, `status` and `updated` only. Message `Decline: {n} proposals`. */
export function decideProposals(s: BrainSnapshot, ids: string[], status: 'accepted' | 'declined', now: string): CommitBatch {
  if (ids.length === 0) throw new Error('nothing to decide');
  const writes: FileWrite[] = [...new Set(ids)].map((id) => {
    const prev = proposalAt(s, id);
    return { path: prev.path, text: serializeFile({ ...prev, fm: { ...prev.fm, status, updated: now } }) };
  });
  const n = writes.length;
  const verb = status === 'declined' ? 'Decline' : 'Accept';
  return withIndexWrites(s, { message: `${verb}: ${n} proposal${n === 1 ? '' : 's'}`, expectedHead: s.head, writes, deletes: [] });
}

export function proposalAt(s: BrainSnapshot, id: string): BrainFile<ProposalFm> {
  const f = s.files.get(`maps/proposals/${id}.md`);
  if (!f || f.fm.type !== 'proposal') throw new Error(`no proposal '${id}'`);
  return f as BrainFile<ProposalFm>;
}

/** Schema §7.10: rewrite `status` and `updated` only, message `Decide: {id}`, plus the index files that change. */
export function decideProposal(s: BrainSnapshot, id: string, status: 'accepted' | 'declined', now: string): CommitBatch {
  const prev = proposalAt(s, id);
  const next: BrainFile<ProposalFm> = { ...prev, fm: { ...prev.fm, status, updated: now } };
  const batch: CommitBatch = { message: `Decide: ${id}`, expectedHead: s.head, writes: [{ path: prev.path, text: serializeFile(next) }], deletes: [] };
  return withIndexWrites(s, batch);
}
