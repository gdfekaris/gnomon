import { describe, expect, it } from 'vitest';
import { MemoryDriver, loadSnapshot } from '@gnomon/storage';
import { readBrainBytes } from '../../storage/test/fixture';
import { brainStatus, nudge } from '../src/lib/services/status';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEMPLATE = join(here, '..', '..', '..', 'template');
const load = async (seed: Map<string, Uint8Array>) => loadSnapshot(await MemoryDriver.create(seed));

describe('brainStatus and the nudge (proposal §8, mirrors gnomon status)', () => {
  it('reads the fixture the way the CLI does', async () => {
    const st = brainStatus(await load(readBrainBytes()));
    expect(st).toEqual({ unfiled: 1, awaitingReview: 1, openProposals: 2, staleIndexes: false, refusals: 0, principles: 4 });
    expect(nudge(st)).toEqual({ kind: 'file', text: '1 capture awaits filing.', href: '#/inbox', label: 'File in Inbox' });
  });

  it('a fresh template brain is all clear', async () => {
    const st = brainStatus(await load(readBrainBytes(TEMPLATE)));
    expect(st).toEqual({ unfiled: 0, awaitingReview: 0, openProposals: 0, staleIndexes: false, refusals: 0, principles: 0 });
    expect(nudge(st).kind).toBe('clear');
  });

  it('follows the loop in the CLI order and pluralises', () => {
    const base = { unfiled: 0, awaitingReview: 0, openProposals: 0, staleIndexes: false, refusals: 0, principles: 1 };
    expect(nudge({ ...base, refusals: 2, unfiled: 3 }).kind).toBe('refusals');
    expect(nudge({ ...base, unfiled: 3, awaitingReview: 1 })).toMatchObject({ kind: 'file', text: '3 captures await filing.' });
    expect(nudge({ ...base, awaitingReview: 1, openProposals: 4 })).toMatchObject({ kind: 'review', text: '1 filing awaits your review.', href: '#/inbox' });
    expect(nudge({ ...base, openProposals: 4, staleIndexes: true })).toMatchObject({ kind: 'decide', text: '4 open proposals await a decision.', href: '#/proposals' });
    expect(nudge({ ...base, staleIndexes: true })).toMatchObject({ kind: 'index', href: '#/settings' });
    expect(nudge(base)).toMatchObject({ kind: 'clear', href: '#/capture' });
  });

  it('a missing raw.md is a refusal and a stale index is noticed', async () => {
    const seed = readBrainBytes();
    seed.delete('sources/weil-attention/raw.md');
    const st = brainStatus(await load(seed));
    expect(st.refusals).toBe(1);
    expect(st.staleIndexes).toBe(true);
    expect(nudge(st).kind).toBe('refusals');
  });
});
