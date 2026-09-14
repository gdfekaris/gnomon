import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type BrainFile, type ProposalFm, validateSnapshot } from '@gnomon/core';
import { MemoryDriver } from '@gnomon/storage';
import { MOCK_MODEL, MockProvider } from '@gnomon/providers';
import { BrainService, type SnapshotState } from '../src/lib/services/brain';
import { deriveInto } from '../src/lib/services/derive';

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
  const driver = await MemoryDriver.create(seed());
  await brain.connect(driver);
  return { brain, driver };
}

describe('deriveInto (Task E)', () => {
  it('derives into an existing set: one completion, one commit of principle proposals with grounds', async () => {
    const { brain, driver } = await connected();
    const provider = new MockProvider();
    const r = await deriveInto(brain, provider, MOCK_MODEL, ['weil-attention', 'aurelius-meditations-4-3'], { slug: 'ps-g8xw' }, 19_200);
    expect(r.created).toBe(false);
    expect(r.set).toBe('ps-g8xw');
    expect(r.n).toBeGreaterThanOrEqual(2);
    expect(r.ids).toHaveLength(r.n);
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]!.system.startsWith('You are deriving principles')).toBe(true);
    expect(provider.requests[0]!.messages[0]!.content).toContain('slug: `weil-attention`');
    const history = await driver.history({ limit: 1 });
    expect(history[0]!.message).toBe(`Derive: ${r.n} proposals for Set 1`);
    const s = brain.snapshot!;
    for (const id of r.ids) {
      const p = s.files.get(`maps/proposals/${id}.md`) as BrainFile<ProposalFm>;
      expect(p.fm).toMatchObject({ kind: 'principle', target_set: 'ps-g8xw', status: 'open', curated: 'agent-proposed' });
      expect(p.fm.grounds!.length).toBeGreaterThan(0);
      expect(p.fm.from_source).toBeUndefined();
    }
    expect(validateSnapshot(s).filter((i) => i.level === 'refusal')).toEqual([]);
  });
  it('derives into a new set, created only once the reply has parsed', async () => {
    const { brain, driver } = await connected();
    const r = await deriveInto(brain, new MockProvider(), MOCK_MODEL, ['weil-attention'], { newName: 'Attention' }, 19_200);
    expect(r.created).toBe(true);
    expect(r.set).toMatch(/^ps-[23456789abcdefghjkmnpqrstuvwxyz]{4}$/);
    const messages = (await driver.history({ limit: 2 })).map((c) => c.message);
    expect(messages[1]).toBe('Create principle set: Set 3 — Attention');
    expect(messages[0]).toBe(`Derive: ${r.n} proposal${r.n === 1 ? '' : 's'} for Set 3 — Attention`);
  });
  it('a bad reply creates nothing, not even the set; a budget too small refuses before sending', async () => {
    const { brain, driver } = await connected();
    const head = brain.snapshot!.head;
    const bad = new MockProvider({ script: () => JSON.stringify({ principles: [{ title: 'X', rationale: 'r', grounds: ['didion-why-i-write'] }] }) });
    await expect(deriveInto(brain, bad, MOCK_MODEL, ['weil-attention'], { newName: 'Never' }, 19_200)).rejects.toThrow(/not one of the passages shown/);
    expect(brain.snapshot!.head).toBe(head);
    expect((await driver.history({ limit: 1 }))[0]!.message).not.toMatch(/Create principle set/);
    const counting = new MockProvider();
    await expect(deriveInto(brain, counting, MOCK_MODEL, ['weil-attention'], { slug: 'ps-g8xw' }, 100)).rejects.toThrow(/budget is 100/);
    expect(counting.requests).toHaveLength(0);
    await expect(deriveInto(brain, counting, MOCK_MODEL, [], { slug: 'ps-g8xw' }, 19_200)).rejects.toThrow(/at least one source/);
  });
});
