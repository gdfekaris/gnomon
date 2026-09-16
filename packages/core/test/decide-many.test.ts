import { describe, expect, it } from 'vitest';
import type { PrincipleFm, ProposalFm } from '../src/index';
import { applyBatch, decideProposals, keepInReserve, validateBatch, validateSnapshot } from '../src/index';
import { FIXTURE, readBrain, snapshotOf } from './brains';

// Schema §7.16: several proposals decided in one commit, since one tap is one act.
const fixture = readBrain(FIXTURE);
const NOW = '2026-09-16T15:00:00Z';
const reserveProposal = (title: string, n: string) => `---\ntype: proposal\nkind: principle\ntitle: ${title}\ntarget_set: _reserve\nfrom_source: weil-attention\ngrounds:\n  - weil-attention\nstatus: open\ncurated: agent-proposed\ncreated: 2026-09-16T10:00:${n}Z\nupdated: 2026-09-16T10:00:${n}Z\n---\nBecause.\n`;
const s = snapshotOf(fixture, {
  'maps/proposals/P-20260916-001.md': reserveProposal('Give attention freely', '00'),
  'maps/proposals/P-20260916-002.md': reserveProposal('One thing at a time', '01'),
});
const entry = (id: string, title: string) => ({ id, title, body: `${title}\n\n**Grounding passages:**\n\n- [[sources/weil-attention/raw]] ([raw](../../sources/weil-attention/raw.md))\n\nWritten from [[maps/proposals/${id}]] ([proposal](../../maps/proposals/${id}.md)).\n`, grounds: ['weil-attention'] });

describe('keepInReserve', () => {
  it('flips each proposal to accepted and writes its principle into the reserve, one commit, slugs de-collided', () => {
    const batch = keepInReserve(s, [entry('P-20260916-001', 'Give attention freely'), entry('P-20260916-002', 'One thing at a time')], NOW);
    expect(batch.message).toBe('Keep: 2 proposals in reserve');
    expect(batch.writes.map((w) => w.path)).toEqual([
      'maps/proposals/P-20260916-001.md', 'principles/_reserve/give-attention-freely.md',
      'maps/proposals/P-20260916-002.md', 'principles/_reserve/one-thing-at-a-time-2.md', // the fixture already reserves that slug
      'principles/_index.md', 'maps/_index.md',
    ]);
    expect(validateBatch(s, batch)).toEqual([]);
    const after = applyBatch(s, batch);
    expect(validateSnapshot(after).filter((i) => i.level === 'refusal')).toEqual([]);
    expect(after.reserve.map((p) => p.path)).toEqual(['principles/_reserve/give-attention-freely.md', 'principles/_reserve/one-thing-at-a-time-2.md', 'principles/_reserve/one-thing-at-a-time.md']);
    const p = after.files.get('principles/_reserve/give-attention-freely.md')!;
    expect(p.fm as PrincipleFm).toEqual({ type: 'principle', title: 'Give attention freely', set: '_reserve', grounds: ['weil-attention'], curated: 'human', created: NOW, updated: NOW });
    expect(p.body).toContain('Written from [[maps/proposals/P-20260916-001]]');
    expect((after.files.get('maps/proposals/P-20260916-001.md')!.fm as ProposalFm)).toMatchObject({ status: 'accepted', updated: NOW, title: 'Give attention freely' });
    expect(keepInReserve(s, [entry('P-20260916-001', 'Give attention freely')], NOW).message).toBe('Keep: 1 proposal in reserve');
  });
  it('refuses a proposal that is not a reserve principle, one already decided, and an empty list', () => {
    expect(() => keepInReserve(s, [entry('P-20260905-001', 'Rise to the work')], NOW)).toThrow(/not a principle proposal for the reserve/);
    expect(() => keepInReserve(s, [entry('P-20260905-003', 'x')], NOW)).toThrow(/not a principle proposal/);
    const decided = applyBatch(s, decideProposals(s, ['P-20260916-001'], 'declined', NOW));
    expect(() => keepInReserve(decided, [entry('P-20260916-001', 'Give attention freely')], NOW)).toThrow(/already declined/);
    expect(() => keepInReserve(s, [], NOW)).toThrow(/nothing to keep/);
    expect(() => keepInReserve(s, [entry('P-20260916-009', 'x')], NOW)).toThrow(/no proposal/);
  });
});

describe('decideProposals', () => {
  it('rewrites status and updated on each, nothing else, in one commit', () => {
    const batch = decideProposals(s, ['P-20260916-001', 'P-20260905-003', 'P-20260916-001'], 'declined', NOW);
    expect(batch.message).toBe('Decline: 2 proposals');
    expect(batch.writes.map((w) => w.path)).toEqual(['maps/proposals/P-20260916-001.md', 'maps/proposals/P-20260905-003.md', 'maps/_index.md']);
    expect(validateBatch(s, batch)).toEqual([]);
    const after = applyBatch(s, batch);
    expect(validateSnapshot(after).filter((i) => i.level === 'refusal')).toEqual([]);
    for (const id of ['P-20260916-001', 'P-20260905-003']) {
      const before = s.files.get(`maps/proposals/${id}.md`)!;
      const now = after.files.get(`maps/proposals/${id}.md`)!;
      expect(now.fm).toEqual({ ...before.fm, status: 'declined', updated: NOW });
      expect(now.body).toBe(before.body);
    }
    expect(decideProposals(s, ['P-20260916-002'], 'accepted', NOW).message).toBe('Accept: 1 proposal');
    expect(() => decideProposals(s, [], 'declined', NOW)).toThrow(/nothing to decide/);
    expect(() => decideProposals(s, ['P-20260916-009'], 'declined', NOW)).toThrow(/no proposal/);
  });
});
