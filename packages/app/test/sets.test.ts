import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { setLabel, validateSnapshot } from '@gnomon/core';
import { MemoryDriver } from '@gnomon/storage';
import { BrainService, type SnapshotState } from '../src/lib/services/brain';
import { describeSet, movePrinciple, moveSet, newSet, placeSet, planDeleteSet, renameSet } from '../src/lib/services/sets';

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
const labels = (brain: BrainService) => brain.snapshot!.sets.map((f) => setLabel(f.fm));

describe('sets service (US-18, US-20)', () => {
  it('creates, renames, describes, reorders, and deletes with a dangling report, each as one commit', async () => {
    const { brain, driver } = await connected();
    const slug = await newSet(brain, { name: 'Parenting' });
    expect(labels(brain)).toEqual(['Set 1', 'Set 2 — Work', 'Set 3 — Parenting']);
    await renameSet(brain, slug, 'Kids');
    await describeSet(brain, slug, 'As a parent.  \n\n');
    expect(brain.snapshot!.files.get(`principles/${slug}/_set.md`)!.body).toBe('As a parent.\n');
    await moveSet(brain, slug, -1);
    expect(labels(brain)).toEqual(['Set 1', 'Set 2 — Kids', 'Set 3 — Work']);
    await placeSet(brain, slug, 0);
    expect(labels(brain)).toEqual(['Set 1 — Kids', 'Set 2', 'Set 3 — Work']);
    await movePrinciple(brain, 'ps-7k2m', 'write-to-find-out', -1);
    expect(brain.snapshot!.principlesOf('ps-7k2m').map((p) => p.fm.title)).toEqual(['Write to find out', 'Say the hard thing first']);

    const plan = planDeleteSet(brain, 'ps-g8xw');
    expect(plan.label).toBe('Set 2');
    expect(plan.principleCount).toBe(2);
    expect(plan.dangling.map((d) => d.ref)).toEqual(['ps-g8xw', 'ps-g8xw/courage-before-comfort', 'ps-g8xw/courage-before-comfort']);
    await plan.commit();
    expect(labels(brain)).toEqual(['Set 1 — Kids', 'Set 2 — Work']);
    expect(validateSnapshot(brain.snapshot!).filter((i) => i.level === 'refusal')).toEqual([]);
    expect((await driver.history({ limit: 7 })).map((c) => c.message)).toEqual([
      'Delete principle set: Set 2', 'Reorder principles: Set 3 — Work', 'Reorder principle sets', 'Reorder principle sets',
      'Update principle set: Set 3 — Kids', 'Update principle set: Set 3 — Kids', 'Create principle set: Set 3 — Parenting',
    ]);
  });
  it('moving past the ends is a no-op', async () => {
    const { brain, driver } = await connected();
    const head = await driver.head();
    await moveSet(brain, 'ps-g8xw', -1);
    await movePrinciple(brain, 'ps-7k2m', 'write-to-find-out', 1);
    expect(await driver.head()).toBe(head);
  });
});
