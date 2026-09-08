// Proposals — US-3, schema §4.7, §7.10. Group open proposals by target set,
// record decisions as one commit each, and derive what the editor should be
// pre-filled with when a principle or amendment proposal is accepted. The
// app never writes the principle itself; the curator does.

import { type BrainFile, type BrainSnapshot, type ProposalFm, backlinks, decideProposal, nowUtc, renderDualLink, setLabel } from '@gnomon/core';
import type { BrainService } from './brain';

export interface ProposalGroup { key: string; label: string; open: BrainFile<ProposalFm>[]; decided: BrainFile<ProposalFm>[]; }

export const proposalId = (path: string) => path.slice('maps/proposals/'.length, -3);

/** Proposals grouped by target set in set order; untargeted ones (tags on sources) last. */
export function groupProposals(s: BrainSnapshot): ProposalGroup[] {
  const groups = new Map<string, ProposalGroup>();
  for (const set of s.sets) groups.set(set.path.split('/')[1]!, { key: set.path.split('/')[1]!, label: setLabel(set.fm), open: [], decided: [] });
  const other: ProposalGroup = { key: 'sources', label: 'Sources', open: [], decided: [] };
  for (const p of s.byType('proposal').sort((a, b) => (a.path < b.path ? 1 : -1))) {
    const g = (p.fm.target_set && groups.get(p.fm.target_set)) || other;
    (p.fm.status === 'open' ? g.open : g.decided).push(p);
  }
  return [...groups.values(), other].filter((g) => g.open.length || g.decided.length);
}

/** Principles whose body links back to the proposal: what an accepted proposal became. */
export function writtenAs(s: BrainSnapshot, proposalPath: string): BrainFile[] {
  return (backlinks(s).get(proposalPath) ?? []).map((p) => s.files.get(p)).filter((f): f is BrainFile => !!f && f.fm.type === 'principle');
}

export async function decide(brain: BrainService, id: string, status: 'accepted' | 'declined'): Promise<void> {
  const s = brain.snapshot;
  if (!s) throw new Error('no brain is connected');
  await brain.commit(decideProposal(s, id, status, nowUtc()));
}

/** Where accepting a proposal takes the curator: the pre-filled editor, or nothing for a link proposal. */
export function acceptanceRoute(p: BrainFile<ProposalFm>): string | null {
  const id = proposalId(p.path);
  switch (p.fm.kind) {
    case 'principle':
      return `#/sets/${p.fm.target_set}/new-principle?from=${id}`;
    case 'amendment':
    case 'link':
      return `#/edit/principles/${p.fm.target}.md?from=${id}`;
    case 'tag':
      return p.fm.target ? `#/edit/sources/${p.fm.target}/raw.md?from=${id}` : null;
  }
}

export interface Prefill { id: string; kind: ProposalFm['kind']; title: string; rationale: string; grounds: string[]; body: string; }

/** The editor's starting point for a principle proposal: its title, its grounds, and a draft body that links back to it. */
export function prefillFrom(s: BrainSnapshot, id: string, setSlug: string): Prefill | null {
  const p = s.files.get(`maps/proposals/${id}.md`) as BrainFile<ProposalFm> | undefined;
  if (!p || p.fm.type !== 'proposal') return null;
  const fromPath = `principles/${setSlug}/new.md`;
  const grounds = p.fm.grounds ?? [];
  const links = grounds.map((g) => `- ${renderDualLink(fromPath, `sources/${g}/raw.md`, 'raw')}`);
  const body = [
    p.fm.kind === 'principle' ? `${p.fm.title}\n\n(Drafted from a proposal. Rewrite this in your own words before saving.)` : '',
    links.length ? `**Grounding passages:**\n\n${links.join('\n')}` : '',
    `Written from ${renderDualLink(fromPath, p.path, 'proposal')}.`,
  ].filter(Boolean).join('\n\n') + '\n';
  return { id, kind: p.fm.kind, title: p.fm.kind === 'principle' ? p.fm.title : '', rationale: p.body, grounds, body };
}
