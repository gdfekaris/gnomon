import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type BrainFile, type ProposalFm, validateSnapshot } from '@gnomon/core';
import { MOCK_MODEL, MockProvider } from '@gnomon/providers';
import { MemoryDriver } from '@gnomon/storage';
import { BrainService, type SnapshotState } from '../src/lib/services/brain';
import { relateInto } from '../src/lib/services/relate';

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

describe('relateInto (Task F, schema §7.15)', () => {
  it('relates a source to a set: one completion, one commit of a link, an amendment, and a principle for the set', async () => {
    const { brain, driver } = await connected();
    const provider = new MockProvider();
    const r = await relateInto(brain, provider, MOCK_MODEL, ['weil-attention'], 'ps-g8xw', 19_200);
    expect(r).toMatchObject({ set: 'ps-g8xw', n: 3, kinds: ['link', 'amendment', 'principle'] });
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]!.system.startsWith('You are relating passages')).toBe(true);
    expect(provider.requests[0]!.messages[0]!.content).toContain('- ref `ps-g8xw/courage-before-comfort`');
    expect((await driver.history({ limit: 1 }))[0]!.message).toBe('Relate: 3 proposals for Set 1');
    const s = brain.snapshot!;
    const fms = r.ids.map((id) => (s.files.get(`maps/proposals/${id}.md`) as BrainFile<ProposalFm>).fm);
    expect(fms[0]).toMatchObject({ kind: 'link', target_set: 'ps-g8xw', target: 'ps-g8xw/courage-before-comfort', grounds: ['weil-attention'], status: 'open' });
    expect(fms[1]).toMatchObject({ kind: 'amendment', target_set: 'ps-g8xw', target: 'ps-g8xw/attention-is-generosity', grounds: ['weil-attention'] });
    expect(fms[2]).toMatchObject({ kind: 'principle', target_set: 'ps-g8xw', grounds: ['weil-attention'] });
    expect(fms.every((f) => f.from_source === undefined)).toBe(true);
    expect(validateSnapshot(s).filter((i) => i.level === 'refusal')).toEqual([]);
  });
  it('an empty reply commits nothing; a refused reply and a budget too small write nothing either', async () => {
    const { brain, driver } = await connected();
    const head = await driver.head();
    expect(await relateInto(brain, new MockProvider({ script: () => '{"proposals": []}' }), MOCK_MODEL, ['weil-attention'], 'ps-g8xw', 19_200)).toEqual({ set: 'ps-g8xw', n: 0, ids: [], kinds: [] });
    expect(await driver.head()).toBe(head);
    // the demo links every passage to the first principle; aurelius-meditations-4-3 already grounds it
    await expect(relateInto(brain, new MockProvider(), MOCK_MODEL, ['aurelius-meditations-4-3'], 'ps-g8xw', 19_200)).rejects.toThrow(/already lists aurelius-meditations-4-3/);
    await expect(relateInto(brain, new MockProvider({ script: () => 'no' }), MOCK_MODEL, ['weil-attention'], 'ps-g8xw', 19_200)).rejects.toThrow(/no JSON object/);
    await expect(relateInto(brain, new MockProvider(), MOCK_MODEL, ['weil-attention'], 'ps-g8xw', 100)).rejects.toThrow(/Passages are never truncated/);
    await expect(relateInto(brain, new MockProvider(), MOCK_MODEL, [], 'ps-g8xw', 19_200)).rejects.toThrow(/at least one source/);
    expect(await driver.head()).toBe(head);
  });
});
