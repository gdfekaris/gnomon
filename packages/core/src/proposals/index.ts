// proposals — spec §7.5, schema §3.5, §4.7, §7.10. One file per proposal,
// sequential ids within a UTC day, and a decision that rewrites `status`
// and `updated` only.

import type { BrainFile, BrainSnapshot, CommitBatch, FileWrite, ProposalFm } from '../schema/types';
import { ValidationError } from '../schema/issues';
import { tryParseFile } from '../schema/parse';
import { serializeFile } from '../schema/serialize';
import { withIndexWrites } from '../index/index';

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
