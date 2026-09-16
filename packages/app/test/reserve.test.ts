import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type PrincipleFm, validateSnapshot } from '@gnomon/core';
import { MemoryDriver } from '@gnomon/storage';
import { BrainService, type SnapshotState } from '../src/lib/services/brain';
import { createPrincipleIn } from '../src/lib/services/edit';
import { filterPrinciples, haystack, place, principleFilterActive, reserve, reserveCount, sortReserve } from '../src/lib/services/reserve';
import { tagCounts, topTags } from '../src/lib/services/browse';

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
const RESERVED = 'principles/_reserve/one-thing-at-a-time.md';
const clean = (brain: BrainService) => expect(validateSnapshot(brain.snapshot!).filter((i) => i.level === 'refusal')).toEqual([]);

describe('reserve and place: one tap, two commits each (schema §7.14)', () => {
  it('reserve copies into the reserve, deletes the original, renumbers the set, and reports what dangles', async () => {
    const { brain, driver } = await connected();
    const moved = await reserve(brain, 'principles/ps-g8xw/courage-before-comfort.md');
    expect(moved.path).toBe('principles/_reserve/courage-before-comfort.md');
    expect(moved.dangling.map((d) => `${d.path} → ${d.ref}`)).toEqual([
      'maps/proposals/P-20260905-002.md → ps-g8xw/courage-before-comfort',
      'principles/ps-7k2m/say-the-hard-thing-first.md → ps-g8xw/courage-before-comfort',
    ]);
    const s = brain.snapshot!;
    expect(s.files.has('principles/ps-g8xw/courage-before-comfort.md')).toBe(false);
    expect(s.reserve.map((p) => p.path)).toEqual([moved.path, RESERVED]); // newest first: the one just reserved
    expect(s.reserve[0]!.fm).toMatchObject({ set: '_reserve', grounds: ['aurelius-meditations-4-3'], related: ['ps-7k2m/say-the-hard-thing-first'], tags: ['stoicism'] });
    expect(s.reserve[0]!.fm.order).toBeUndefined();
    expect(s.principlesOf('ps-g8xw').map((p) => [p.fm.order, p.fm.title])).toEqual([[1, 'Attention is generosity']]);
    expect((await driver.history({ limit: 2 })).map((c) => c.message)).toEqual(['Delete principle: Courage before comfort', 'Reserve principle: Courage before comfort']);
    clean(brain);
  });
  it('place copies into the set at N+1 and removes the reserve copy', async () => {
    const { brain, driver } = await connected();
    const moved = await place(brain, RESERVED, 'ps-7k2m');
    expect(moved.path).toBe('principles/ps-7k2m/one-thing-at-a-time.md');
    expect(moved.dangling).toEqual([]);
    const s = brain.snapshot!;
    expect(s.reserve).toEqual([]);
    expect(s.principlesOf('ps-7k2m').map((p) => [p.fm.order, p.fm.title])).toEqual([[1, 'Say the hard thing first'], [2, 'Write to find out'], [3, 'One thing at a time']]);
    expect((await driver.history({ limit: 2 })).map((c) => c.message)).toEqual(['Delete principle: One thing at a time', 'Place principle: One thing at a time in Set 2 — Work']);
    clean(brain);
  });
  it('a new principle can be written straight into the reserve, and a round trip keeps its words', async () => {
    const { brain } = await connected();
    const path = await createPrincipleIn(brain, '_reserve', { title: 'Hold this', body: 'Later.\n', grounds: [], related: [], tags: ['later'] });
    expect(path).toBe('principles/_reserve/hold-this.md');
    expect(brain.snapshot!.reserve.map((p) => p.fm.title)).toEqual(['Hold this', 'One thing at a time']);
    const placed = await place(brain, path, 'ps-g8xw');
    const back = await reserve(brain, placed.path);
    const f = brain.snapshot!.files.get(back.path)!;
    expect(f.body).toBe('Later.\n');
    expect((f.fm as PrincipleFm).tags).toEqual(['later']);
    clean(brain);
  });
});

describe('search over every principle', () => {
  it('finds a principle by its title, a tag, its slug, or a ground\'s author or title, accent-insensitively', async () => {
    const { brain } = await connected();
    const s = brain.snapshot!;
    const all = s.byType('principle');
    const titles = (q: string) => filterPrinciples(all, { q, tags: [] }, s).map((p) => p.fm.title).sort();
    expect(haystack(s.reserve[0]!, s)).toEqual(['one thing at a time', 'one-thing-at-a-time', 'attention', 'attention as generosity', 'simone weil']);
    expect(titles('weil')).toEqual(['Attention is generosity', 'One thing at a time']);
    expect(titles('WEIL attention')).toEqual(['Attention is generosity', 'One thing at a time']);
    expect(titles('stoicism')).toEqual(['Courage before comfort']);
    expect(titles('didion')).toEqual(['Say the hard thing first']);
    expect(titles('write-to-find')).toEqual(['Write to find out']);
    expect(titles('nothing-like-this')).toEqual([]);
    expect(titles('   ')).toEqual(all.map((p) => p.fm.title).sort());
    expect(filterPrinciples(s.reserve, { q: '', tags: ['attention'] }, s).length).toBe(1);
    expect(filterPrinciples(s.reserve, { q: '', tags: ['attention', 'stoicism'] }, s).length).toBe(0);
    expect(principleFilterActive({ q: ' ', tags: [] })).toBe(false);
    expect(principleFilterActive({ q: '', tags: ['x'] })).toBe(true);
  });
  it('sorts the reserve newest first by default and A–Z on request; tags count over the reserve', async () => {
    const { brain } = await connected();
    await createPrincipleIn(brain, '_reserve', { title: 'zebra first', body: '', grounds: [], related: [], tags: ['attention', 'zoo'] });
    await createPrincipleIn(brain, '_reserve', { title: 'Apple second', body: '', grounds: [], related: [], tags: ['zoo'] });
    const r = brain.snapshot!.reserve;
    expect(sortReserve(r, 'newest').map((p) => p.fm.title)).toEqual(['Apple second', 'zebra first', 'One thing at a time']);
    expect(sortReserve(r, 'az').map((p) => p.fm.title)).toEqual(['Apple second', 'One thing at a time', 'zebra first']);
    const counts = tagCounts(r);
    expect([...counts]).toEqual([['attention', 2], ['zoo', 2]]);
    expect(topTags(counts, [], 1)).toEqual(['attention']);
    expect(reserveCount(1, 3, true)).toBe('1 of 3 in reserve');
    expect(reserveCount(3, 3, false)).toBe('3 in reserve');
  });
});
