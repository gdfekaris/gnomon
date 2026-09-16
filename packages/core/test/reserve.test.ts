import { describe, expect, it } from 'vitest';
import type { BrainFile, CommitBatch, Issue, PrincipleFm } from '../src/index';
import {
  RESERVE_SLUG, applyBatch, createPrinciple, deletePrinciple, generateIndexes, parseFile, placePrinciple, reservePrinciple, tryParseFile,
  validateBatch, validateSnapshot,
} from '../src/index';
import { FIXTURE, readBrain, snapshotFromDisk, snapshotOf } from './brains';

// The reserve (schema §4.5, §4.8, §7.14): principles held but not in force. A folder, never a set;
// no order there; two commits to move in or out, since files never move.

const fixture = readBrain(FIXTURE);
const s = snapshotFromDisk(FIXTURE, 'head1');
const NOW = '2026-09-16T12:00:00Z';
const RESERVED = 'principles/_reserve/one-thing-at-a-time.md';
const HELD = '---\ntype: principle\ntitle: Held\nset: _reserve\ngrounds: []\ncurated: human\ncreated: 2026-09-05\nupdated: 2026-09-05\n---\nx\n';
const rulesOf = (path: string, text: string) => { const r = tryParseFile(path, text); return r.ok ? [] : r.issues.map((i) => i.rule); };
const refusals = (issues: Issue[]) => issues.filter((i) => i.level === 'refusal');
function fileIn(b: CommitBatch, path: string): BrainFile<PrincipleFm> {
  const w = b.writes.find((x) => x.path === path);
  if (!w || !('text' in w)) throw new Error(`no text write for ${path}`);
  return parseFile(path, w.text) as BrainFile<PrincipleFm>;
}

describe('parse: order is precedence, so the reserve has none (schema §4.5)', () => {
  it('a reserve principle parses without order and is refused with one', () => {
    expect(RESERVE_SLUG).toBe('_reserve');
    expect(rulesOf('principles/_reserve/held.md', HELD)).toEqual([]);
    expect(rulesOf('principles/_reserve/held.md', HELD.replace('grounds: []', 'order: 1\ngrounds: []'))).toEqual(['reserve.order']);
  });
  it('a principle in a set still needs order, and set must match the folder either way', () => {
    expect(rulesOf('principles/ps-g8xw/held.md', HELD.replace('set: _reserve', 'set: ps-g8xw'))).toEqual(['field.required']);
    expect(rulesOf('principles/ps-g8xw/held.md', HELD.replace('set: _reserve', 'set: ps-g8xw').replace('grounds: []', 'order: 3\ngrounds: []'))).toEqual([]);
    expect(rulesOf('principles/_reserve/held.md', HELD.replace('set: _reserve', 'set: ps-g8xw'))).toEqual(['path.set-mismatch']);
  });
  it('the reserve is never a set', () => {
    expect(rulesOf('principles/_reserve/_set.md', '---\ntype: principle-set\norder: 1\ncurated: human\ncreated: 2026-09-05\nupdated: 2026-09-05\n---\n')).toEqual(['id.format']);
  });
});

describe('snapshot and validation (schema §4.8, §9)', () => {
  it('the fixture holds one reserve principle, and it needs no _set.md', () => {
    expect(s.reserve.map((f) => f.path)).toEqual([RESERVED]);
    expect(s.reserve[0]!.fm.order).toBeUndefined();
    expect(s.principlesOf(RESERVE_SLUG).map((f) => f.path)).toEqual([RESERVED]);
    expect(validateSnapshot(s)).toEqual([]);
    const noSets = validateSnapshot(snapshotOf(fixture, { 'principles/ps-g8xw/_set.md': null, 'principles/ps-7k2m/_set.md': null }));
    expect(noSets.filter((i) => i.rule === 'principle.no-set').map((i) => i.path)).not.toContain(RESERVED);
  });
  it('the reserve is newest first, ties broken by path, and contiguity is checked in sets only', () => {
    const t = snapshotOf(fixture, {
      'principles/_reserve/zz-newer.md': HELD.replace('created: 2026-09-05\nupdated: 2026-09-05', 'created: 2026-09-06\nupdated: 2026-09-06'),
      'principles/_reserve/aaa-tie.md': HELD.replace('created: 2026-09-05\nupdated: 2026-09-05', 'created: 2026-09-05T18:00:00Z\nupdated: 2026-09-05T18:00:00Z'),
    });
    expect(t.reserve.map((f) => f.path)).toEqual(['principles/_reserve/zz-newer.md', 'principles/_reserve/aaa-tie.md', RESERVED]);
    expect(validateSnapshot(t)).toEqual([]);
  });
  it('a reserve principle carrying order is a refusal that names the rule', () => {
    const bad = snapshotOf(fixture, { [RESERVED]: fixture.get(RESERVED)!.replace('set: _reserve\n', 'set: _reserve\norder: 1\n') });
    expect(validateSnapshot(bad).map((i) => [i.level, i.rule])).toEqual([['refusal', 'reserve.order']]);
  });
});

describe('index: "In reserve" only when something is in it (schema §4.8)', () => {
  it('lists the fixture reserve after the sets in both files', () => {
    const idx = generateIndexes(s);
    expect(idx['principles/_index.md']).toContain('\n## In reserve\n\n- [[principles/_reserve/one-thing-at-a-time]] ([principle](_reserve/one-thing-at-a-time.md)) — One thing at a time — grounds: 1\n');
    expect(idx['maps/_index.md']).toContain('\n### In reserve\n\n- [[principles/_reserve/one-thing-at-a-time]] ([principle](../principles/_reserve/one-thing-at-a-time.md)) — One thing at a time — grounds: 1\n\n## Sources\n');
    expect(idx['principles/_index.md']).toBe(fixture.get('principles/_index.md'));
    expect(idx['maps/_index.md']).toBe(fixture.get('maps/_index.md'));
  });
  it('writes no section for an empty reserve', () => {
    const idx = generateIndexes(snapshotOf(fixture, { [RESERVED]: null }));
    expect(idx['principles/_index.md']).not.toContain('In reserve');
    expect(idx['maps/_index.md']).not.toContain('In reserve');
  });
});

describe('sets: reserve and place, each the copy half of two commits (schema §7.14)', () => {
  it('createPrinciple with _reserve writes into the reserve with no order', () => {
    const { batch, path } = createPrinciple(s, { setSlug: RESERVE_SLUG, title: 'Hold this', body: 'x\n', grounds: [], tags: ['later'], now: NOW });
    expect(path).toBe('principles/_reserve/hold-this.md');
    expect(batch.message).toBe('Add principle: Hold this');
    expect(fileIn(batch, path).fm).toEqual({ type: 'principle', title: 'Hold this', set: '_reserve', grounds: [], tags: ['later'], curated: 'human', created: NOW, updated: NOW });
    expect(validateBatch(s, batch)).toEqual([]);
    const after = applyBatch(s, batch);
    expect(refusals(validateSnapshot(after))).toEqual([]);
    expect(after.reserve.map((f) => f.path)).toEqual([path, RESERVED]);
  });
  it('reservePrinciple copies a set principle into the reserve; deletePrinciple then closes the gap', () => {
    const original = 'principles/ps-g8xw/courage-before-comfort.md';
    const { batch, path } = reservePrinciple(s, original, NOW);
    expect(path).toBe('principles/_reserve/courage-before-comfort.md');
    expect(batch.message).toBe('Reserve principle: Courage before comfort');
    expect(batch.deletes).toEqual([]);
    expect(batch.writes.map((w) => w.path)).toEqual([path, 'principles/_index.md', 'maps/_index.md']);
    const copy = fileIn(batch, path);
    const source = s.files.get(original) as BrainFile<PrincipleFm>;
    expect(copy.fm).toEqual({ type: 'principle', title: source.fm.title, set: '_reserve', grounds: source.fm.grounds, related: source.fm.related, tags: source.fm.tags, curated: 'human', created: NOW, updated: NOW });
    expect(copy.body).toBe(source.body);
    expect(validateBatch(s, batch)).toEqual([]);

    const between = applyBatch(s, batch);
    expect(refusals(validateSnapshot(between))).toEqual([]);
    expect(between.reserve.map((f) => f.path)).toEqual([path, RESERVED]);
    const second = deletePrinciple(between, original, NOW);
    expect(second.batch.message).toBe('Delete principle: Courage before comfort');
    expect(second.batch.deletes).toEqual([original]);
    expect(fileIn(second.batch, 'principles/ps-g8xw/attention-is-generosity.md').fm.order).toBe(1);
    expect(second.dangling.map((d) => d.path)).toEqual(['maps/proposals/P-20260905-002.md', 'principles/ps-7k2m/say-the-hard-thing-first.md']);
    const after = applyBatch(between, second.batch);
    expect(refusals(validateSnapshot(after))).toEqual([]);
    expect(after.principlesOf('ps-g8xw').map((f) => f.fm.order)).toEqual([1]);
  });
  it('a slug already in the reserve gets -2, and a reserve principle cannot be reserved again', () => {
    const made = createPrinciple(s, { setSlug: 'ps-7k2m', title: 'One thing at a time', body: 'x\n', grounds: [], now: NOW });
    const t = applyBatch(s, made.batch);
    expect(reservePrinciple(t, made.path, NOW).path).toBe('principles/_reserve/one-thing-at-a-time-2.md');
    expect(() => reservePrinciple(s, RESERVED, NOW)).toThrow(/already in the reserve/);
  });
  it('placePrinciple copies into a set at N+1; deletePrinciple on the reserve copy renumbers nothing', () => {
    const { batch, path } = placePrinciple(s, RESERVED, 'ps-7k2m', NOW);
    expect(path).toBe('principles/ps-7k2m/one-thing-at-a-time.md');
    expect(batch.message).toBe('Place principle: One thing at a time in Set 2 — Work');
    const copy = fileIn(batch, path);
    expect(copy.fm).toMatchObject({ set: 'ps-7k2m', order: 3, grounds: ['weil-attention'], related: ['ps-g8xw/attention-is-generosity'], tags: ['attention'], created: NOW });
    expect(copy.body).toBe(s.files.get(RESERVED)!.body);
    expect(validateBatch(s, batch)).toEqual([]);

    const between = applyBatch(s, batch);
    expect(refusals(validateSnapshot(between))).toEqual([]);
    const second = deletePrinciple(between, RESERVED, NOW);
    expect(second.batch.deletes).toEqual([RESERVED]);
    expect(second.batch.writes.map((w) => w.path)).toEqual(['principles/_index.md', 'maps/_index.md']);
    expect(second.dangling).toEqual([]);
    const after = applyBatch(between, second.batch);
    expect(refusals(validateSnapshot(after))).toEqual([]);
    expect(after.reserve).toEqual([]);
    expect(after.principlesOf('ps-7k2m').map((f) => [f.fm.order, f.fm.title])).toEqual([[1, 'Say the hard thing first'], [2, 'Write to find out'], [3, 'One thing at a time']]);
    expect(generateIndexes(after)['principles/_index.md']).not.toContain('In reserve');
  });
  it('placePrinciple refuses an unknown set and the set the principle is already in', () => {
    expect(() => placePrinciple(s, RESERVED, 'ps-zzzz', NOW)).toThrow(/no principle set/);
    expect(() => placePrinciple(s, 'principles/ps-7k2m/write-to-find-out.md', 'ps-7k2m', NOW)).toThrow(/already in Set 2/);
  });
});
