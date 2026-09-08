import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type BrainFile, type ProposalFm, validateSnapshot } from '@gnomon/core';
import { MemoryDriver } from '@gnomon/storage';
import { BrainService, type SnapshotState } from '../src/lib/services/brain';
import { createPrincipleIn } from '../src/lib/services/edit';
import { acceptanceRoute, decide, groupProposals, prefillFrom, proposalId, writtenAs } from '../src/lib/services/proposals';

const here = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE = join(here, '..', '..', 'core', 'fixtures', 'brain');
function seed(): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(relative(FIXTURE, full).split('\\').join('/'), new Uint8Array(readFileSync(full)));
    }
  };
  walk(FIXTURE);
  return out;
}
async function connected() {
  const state: SnapshotState = { current: null, stale: false, loading: false, error: null };
  const brain = new BrainService(state);
  await brain.connect(await MemoryDriver.create(seed()));
  return brain;
}

describe('proposals service (US-3, schema §4.7, §7.10)', () => {
  it('groups by target set in set order with untargeted proposals last, newest first', async () => {
    const brain = await connected();
    const groups = groupProposals(brain.snapshot!);
    expect(groups.map((g) => [g.label, g.open.map((p) => proposalId(p.path)), g.decided.map((p) => proposalId(p.path))])).toEqual([
      ['Set 1', [], ['P-20260905-002']],
      ['Set 2 — Work', ['P-20260905-003', 'P-20260905-001'], []],
      ['Sources', [], ['P-20260903-001']],
    ]);
  });

  it('acceptance routes and pre-fill', async () => {
    const brain = await connected();
    const s = brain.snapshot!;
    const at = (id: string) => s.files.get(`maps/proposals/${id}.md`) as BrainFile<ProposalFm>;
    expect(acceptanceRoute(at('P-20260905-001'))).toBe('#/sets/ps-7k2m/new-principle?from=P-20260905-001');
    expect(acceptanceRoute(at('P-20260905-003'))).toBe('#/edit/principles/ps-7k2m/say-the-hard-thing-first.md?from=P-20260905-003');
    expect(acceptanceRoute(at('P-20260905-002'))).toBe('#/edit/principles/ps-g8xw/courage-before-comfort.md?from=P-20260905-002');
    expect(acceptanceRoute(at('P-20260903-001'))).toBe('#/edit/sources/didion-why-i-write/raw.md?from=P-20260903-001');
    const pre = prefillFrom(s, 'P-20260905-001', 'ps-7k2m')!;
    expect(pre.title).toBe('Rise to the work');
    expect(pre.grounds).toEqual(['aurelius-meditations-5-1']);
    expect(pre.body).toBe('Rise to the work\n\n(Drafted from a proposal. Rewrite this in your own words before saving.)\n\n**Grounding passages:**\n\n- [[sources/aurelius-meditations-5-1/raw]] ([raw](../../sources/aurelius-meditations-5-1/raw.md))\n\nWritten from [[maps/proposals/P-20260905-001]] ([proposal](../../maps/proposals/P-20260905-001.md)).\n');
    expect(prefillFrom(s, 'P-20260905-003', 'ps-7k2m')!.title).toBe('');
    expect(prefillFrom(s, 'P-19990101-001', 'ps-7k2m')).toBeNull();
  });

  it('decide commits one Decide: per proposal, and a principle written from it shows as what it became', async () => {
    const brain = await connected();
    await decide(brain, 'P-20260905-001', 'accepted');
    await decide(brain, 'P-20260905-003', 'declined');
    const s = brain.snapshot!;
    expect((s.files.get('maps/proposals/P-20260905-001.md')!.fm as ProposalFm).status).toBe('accepted');
    expect((s.files.get('maps/proposals/P-20260905-003.md')!.fm as ProposalFm).status).toBe('declined');
    expect(groupProposals(s).find((g) => g.key === 'ps-7k2m')!.open).toEqual([]);
    const pre = prefillFrom(s, 'P-20260905-001', 'ps-7k2m')!;
    const path = await createPrincipleIn(brain, 'ps-7k2m', { title: pre.title, body: 'Get up; the work is what you are for.\n\n' + pre.body.split('**Grounding passages:**')[1]!.replace(/^\n+/, '**Grounding passages:**\n'), grounds: pre.grounds, related: [], tags: [] });
    expect(writtenAs(brain.snapshot!, 'maps/proposals/P-20260905-001.md').map((f) => f.path)).toEqual([path]);
    expect(validateSnapshot(brain.snapshot!)).toEqual([]);
  });
});
