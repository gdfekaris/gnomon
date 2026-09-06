import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateSnapshot } from '@gnomon/core';
import { MemoryDriver } from '@gnomon/storage';
import { BrainService, type SnapshotState } from '../src/lib/services/brain';
import { applyOffer, inspectBrain } from '../src/lib/services/connect';

const here = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE = join(here, '..', '..', 'core', 'fixtures', 'brain');
const TEMPLATE = join(here, '..', '..', '..', 'template');
function read(root: string): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(relative(root, full).split('\\').join('/'), new Uint8Array(readFileSync(full)));
    }
  };
  walk(root);
  return out;
}
const scaffold = new Map([...read(TEMPLATE)].filter(([p]) => p.endsWith('.md') && !p.startsWith('.')).map(([p, b]) => [p, new TextDecoder().decode(b)]));
const NOW = '2026-09-06T16:00:00Z';

async function connected(omit: string[]) {
  const seed = read(FIXTURE);
  for (const p of omit) seed.delete(p);
  const state: SnapshotState = { current: null, stale: false, loading: false, error: null };
  const brain = new BrainService(state);
  const driver = await MemoryDriver.create(seed);
  await brain.connect(driver);
  return { brain, driver, state };
}

describe('connect-existing (schema §7.8, spec §12 step 4)', () => {
  it('a valid brain reports nothing to do', async () => {
    const { brain, driver } = await connected([]);
    const r = await inspectBrain(brain, driver, scaffold, NOW);
    expect(r).toEqual({ refusals: [], warnings: [], offers: [], indexes: null });
  });

  it('offers each missing scaffold item as one commit and lists what it cannot fix', async () => {
    const { brain, driver } = await connected(['AGENTS.md', 'templates/raw.md', 'sources/weil-attention/raw.md', 'maps/_index.md']);
    const r = await inspectBrain(brain, driver, scaffold, NOW);
    expect(r.refusals.map((i) => [i.path, i.rule])).toEqual([
      ['AGENTS.md', 'layout.missing'],
      ['templates/raw.md', 'layout.missing'],
      ['sources/weil-attention/notes.md', 'source.missing-raw'],
    ]);
    expect(r.warnings.map((i) => i.rule)).toEqual(['grounds.dangling']);
    expect(r.offers.map((o) => [o.path, o.label, o.batch.message])).toEqual([
      ['AGENTS.md', 'Add AGENTS.md', 'Scaffold: AGENTS.md'],
      ['templates/raw.md', 'Add templates/raw.md', 'Scaffold: templates/raw.md'],
    ]);
    const agents = r.offers[0]!.batch.writes[0] as { path: string; text: string };
    expect(agents.text).toBe(scaffold.get('AGENTS.md'));
    expect(r.indexes).toMatchObject({ message: 'Index' });
    expect(r.indexes!.writes.map((w) => w.path)).toEqual(['maps/_index.md']);

    let next = await applyOffer(brain, driver, scaffold, r.offers[0]!.batch);
    expect(next.refusals.map((i) => i.path)).toEqual(['templates/raw.md', 'sources/weil-attention/notes.md']);
    expect(next.offers.map((o) => o.path)).toEqual(['templates/raw.md']);
    expect(next.offers[0]!.batch.expectedHead).toBe(await driver.head());
    next = await applyOffer(brain, driver, scaffold, next.offers[0]!.batch);
    next = await applyOffer(brain, driver, scaffold, next.indexes!);
    expect(next.offers).toEqual([]);
    expect(next.indexes).toBeNull();
    expect(next.refusals.map((i) => i.rule)).toEqual(['source.missing-raw']);
    expect((await driver.history({ limit: 3 })).map((c) => c.message)).toEqual(['Index', 'Scaffold: templates/raw.md', 'Scaffold: AGENTS.md']);
    expect((await driver.readMany(['AGENTS.md'])).get('AGENTS.md')!.text).toBe(scaffold.get('AGENTS.md'));
  });

  it('adds a missing folder as its keeper and Set 1 when there are no sets', async () => {
    const seedOmit = [...read(FIXTURE).keys()].filter((p) => p.startsWith('principles/') || p.startsWith('inbox/'));
    const { brain, driver } = await connected(seedOmit);
    const r = await inspectBrain(brain, driver, scaffold, NOW);
    expect(r.refusals.map((i) => i.rule)).toContain('sets.none');
    // both folders are gone; Set 1 recreates principles/ by itself
    expect(r.offers.map((o) => o.label)).toEqual(['Add the inbox/ folder', 'Add the principles/ folder', 'Add Set 1']);
    const folder = r.offers[0]!.batch;
    expect(folder.writes).toEqual([{ path: 'inbox/.gitkeep', text: '' }]);
    const set1 = r.offers[2]!.batch;
    expect(set1.message).toBe('Create principle set: Set 1');
    expect((set1.writes[0] as { text: string }).text).toContain('order: 1');

    let next = await applyOffer(brain, driver, scaffold, set1);
    expect(next.offers.map((o) => o.label)).toEqual(['Add the inbox/ folder']);
    next = await applyOffer(brain, driver, scaffold, next.offers[0]!.batch);
    expect(next.refusals.filter((i) => i.rule === 'sets.none' || i.rule === 'layout.missing')).toEqual([]);
    expect(validateSnapshot(brain.snapshot!).filter((i) => i.level === 'refusal').map((i) => i.rule)).toEqual([]);
  });
});
