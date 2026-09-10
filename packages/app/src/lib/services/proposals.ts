// Proposals — US-3, schema §4.7, §7.10. Group open proposals by target set,
// record decisions as one commit each, and derive what the editor should be
// pre-filled with when a principle or amendment proposal is accepted. The
// app never writes the principle itself; the curator does.

import { type BrainFile, type BrainSnapshot, type Citation, type ProposalFm, backlinks, buildProposal, decideProposal, nextProposalId, nowUtc, renderDualLink, setLabel, withIndexWrites } from '@gnomon/core';
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

// ---------------------------------------------------------------- save as proposal (Phase 3 block 5)

/** What a Relate answer's Proposal section yields, pre-filled into the form; every field stays editable. */
export interface ProposalDraft {
  kind: 'principle' | 'amendment';
  title: string;
  target_set: string;
  /** `<set-slug>/<principle-slug>`, for an amendment */
  target?: string;
  rationale: string;
  /** source slugs the answer cited */
  grounds: string[];
}

const SET_SLUG = /ps-[a-z0-9]{4}\b/;
const PRINCIPLE_REF = /ps-[a-z0-9]{4}\/[a-z0-9-]+/;
const HEADING = /^\s*(?:#{1,6}\s*|\*\*)?(?:4[.)]\s*)?Proposal\b.*$/im;
const NEXT_SECTION = /^\s*(?:#{1,6}\s*)?\d[.)]\s|^\(This is the demo model/m;

function labeled(section: string, label: string): string | undefined {
  const re = new RegExp(`^\\s*(?:[-*]\\s*)?\\**${label}\\**\\s*[:\u2014-]\\**\\s*(.+)$`, 'im');
  return re.exec(section)?.[1]?.trim().replace(/^["\u201c]|["\u201d.]+$/g, '').trim() || undefined;
}

/**
 * The Proposal section of a relate answer (prompts §relate), read leniently:
 * labeled lines when the model gave them, otherwise the first line as the
 * wording and the rest as rationale. Null when there is no section or it
 * says none. `selectedSets[0]` stands in when no set slug is named.
 */
export function extractProposal(text: string, selectedSets: string[], citations: Citation[] = []): ProposalDraft | null {
  const h = HEADING.exec(text);
  if (!h) return null;
  let section = text.slice(h.index + h[0].length);
  const next = NEXT_SECTION.exec(section);
  if (next) section = section.slice(0, next.index);
  section = section.trim();
  if (!section || /^(?:\*\*)?none\b/i.test(section)) return null;

  const kind: ProposalDraft['kind'] = /amend/i.test(labeled(section, 'Kind') ?? '') ? 'amendment' : 'principle';
  const targetSet = SET_SLUG.exec(labeled(section, 'Target set') ?? '')?.[0] ?? SET_SLUG.exec(section)?.[0] ?? selectedSets[0] ?? '';
  const target = PRINCIPLE_REF.exec(labeled(section, 'Target') ?? '')?.[0] ?? PRINCIPLE_REF.exec(section)?.[0];
  const labels = /^\s*(?:[-*]\s*)?\**(?:Kind|Target set|Target|Wording|Title|Suggested wording|Rationale)\**\s*[:\u2014-]\**/i;
  const plain = section.split('\n').filter((l) => l.trim() && !labels.test(l));
  const title = labeled(section, 'Wording') ?? labeled(section, 'Suggested wording') ?? labeled(section, 'Title') ?? (plain[0] ?? '').replace(/^[-*]\s*/, '').trim().slice(0, 160);
  const rationaleAt = section.search(/^\s*(?:[-*]\s*)?\**Rationale\**\s*[:\u2014-]\**/im);
  const rationale = (rationaleAt >= 0 ? section.slice(rationaleAt).replace(/^\s*(?:[-*]\s*)?\**Rationale\**\s*[:\u2014-]\**\s*/i, '') : plain.slice(title === plain[0] ? 1 : 0).join('\n')).trim();
  if (!title) return null;
  const grounds = [...new Set(citations.filter((c) => c.resolved && c.path.startsWith('sources/')).map((c) => c.path.split('/')[1]!))];
  const draft: ProposalDraft = { kind, title, target_set: targetSet, rationale, grounds };
  if (target) draft.target = target;
  return draft;
}

/** One `Add proposal:` commit writing a `curated: human` proposal (schema §4.7) plus the index files that change. Returns the id. */
export async function saveProposal(brain: BrainService, draft: ProposalDraft): Promise<string> {
  const s = brain.snapshot;
  if (!s) throw new Error('no brain is connected');
  const now = nowUtc();
  const id = nextProposalId(s, now);
  const write = buildProposal({
    id, kind: draft.kind, title: draft.title.trim(), target_set: draft.target_set, rationale: draft.rationale.trim(), curated: 'human', now,
    ...(draft.kind === 'amendment' && draft.target ? { target: draft.target } : {}),
    ...(draft.grounds.length ? { grounds: draft.grounds } : {}),
  });
  await brain.commit(withIndexWrites(s, { message: `Add proposal: ${id}`, expectedHead: s.head, writes: [write], deletes: [] }));
  return id;
}
