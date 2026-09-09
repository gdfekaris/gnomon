// The brain's status and the one-line "what next" nudge (proposal §8 Phase
// 3, US-14), mirroring the CLI's `gnomon status` line for the loop: refusals,
// then unfiled captures, then filings awaiting review, then open proposals,
// then stale indexes, else all clear. Framework-free.

import { type BrainSnapshot, indexWrites, validateSnapshot } from '@gnomon/core';

export interface BrainStatus {
  unfiled: number;
  /** sources still `agent-proposed`: filings awaiting ratification */
  awaitingReview: number;
  openProposals: number;
  staleIndexes: boolean;
  refusals: number;
  principles: number;
}

export function brainStatus(s: BrainSnapshot): BrainStatus {
  return {
    unfiled: s.byType('inbox').filter((f) => f.fm.status === 'unfiled').length,
    awaitingReview: s.byType('source').filter((f) => f.fm.curated === 'agent-proposed').length,
    openProposals: s.byType('proposal').filter((f) => f.fm.status === 'open').length,
    staleIndexes: indexWrites(s).length > 0,
    refusals: validateSnapshot(s).filter((i) => i.level === 'refusal').length,
    principles: s.byType('principle').length,
  };
}

export type NudgeKind = 'refusals' | 'file' | 'review' | 'decide' | 'index' | 'clear';

export interface Nudge {
  kind: NudgeKind;
  text: string;
  /** where to go to act on it */
  href: string;
  label: string;
}

const n = (count: number, one: string, many: string) => (count === 1 ? `1 ${one}` : `${count} ${many}`);

export function nudge(st: BrainStatus): Nudge {
  if (st.refusals) return { kind: 'refusals', text: `The brain has ${n(st.refusals, 'problem the app refuses to work around', 'problems the app refuses to work around')}.`, href: '#/settings', label: 'See them in Settings' };
  if (st.unfiled) return { kind: 'file', text: `${n(st.unfiled, 'capture awaits', 'captures await')} filing.`, href: '#/inbox', label: 'File in Inbox' };
  if (st.awaitingReview) return { kind: 'review', text: `${n(st.awaitingReview, 'filing awaits', 'filings await')} your review.`, href: '#/inbox', label: 'Review in Inbox' };
  if (st.openProposals) return { kind: 'decide', text: `${n(st.openProposals, 'open proposal awaits', 'open proposals await')} a decision.`, href: '#/proposals', label: 'Decide in Proposals' };
  if (st.staleIndexes) return { kind: 'index', text: 'The index files are behind the brain.', href: '#/settings', label: 'Regenerate in Settings' };
  return { kind: 'clear', text: 'All clear. Capture something.', href: '#/capture', label: 'Capture' };
}
