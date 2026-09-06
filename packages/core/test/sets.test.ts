import { describe, expect, it } from 'vitest';
import type { BrainFile, CommitBatch, Frontmatter, Issue, PrincipleFm, SetFm } from '../src/index';
import {
  applyBatch, createPrinciple, createSet, deletePrinciple, deleteSet, isSetSlug, newSetSlug, parseFile,
  reorderPrinciples, reorderSets, slugify, uniquePrincipleSlug, updatePrinciple, updateSet, validateBatch, validateSnapshot,
} from '../src/index';
import { FIXTURE, snapshotFromDisk } from './brains';

const s = snapshotFromDisk(FIXTURE, 'head1');
const NOW = '2026-09-06T12:00:00Z';
const paths = (b: CommitBatch) => b.writes.map((w) => w.path);
const refusals = (issues: Issue[]) => issues.filter((i) => i.level === 'refusal');
function fileIn<F extends Frontmatter = SetFm | PrincipleFm>(b: CommitBatch, path: string): BrainFile<F> {
  const w = b.writes.find((x) => x.path === path);
  if (!w || !('text' in w)) throw new Error(`no text write for ${path}`);
  return parseFile(path, w.text) as BrainFile<F>;
}
/** The batch must be valid against the snapshot and leave the brain with no refusals. */
function expectClean(b: CommitBatch) {
  expect(validateBatch(s, b)).toEqual([]);
  expect(refusals(validateSnapshot(applyBatch(s, b)))).toEqual([]);
  expect(b.expectedHead).toBe('head1');
}

describe('newSetSlug (schema §3.2)', () => {
  it('draws well-formed slugs from the 31-character alphabet', () => {
    for (let i = 0; i < 50; i++) expect(isSetSlug(newSetSlug(new Set()))).toBe(true);
  });
  it('re-draws on collision and skips bytes outside the uniform range', () => {
    const draws = [new Uint8Array([255, 0, 0, 0, 0, 0, 0, 0]), new Uint8Array([1, 1, 1, 1, 0, 0, 0, 0])];
    const random = () => draws.shift() ?? new Uint8Array(8);
    // first draw is 'ps-2222' (byte 255 rejected, then four zeros); it collides, so the second draw wins
    expect(newSetSlug(new Set(['ps-2222']), random)).toBe('ps-3333');
  });
});

describe('sets (schema §7.1–§7.4)', () => {
  it('createSet appends Set N+1 with the canonical descriptor and both indexes', () => {
    const { batch, slug } = createSet(s, { name: 'Parenting', body: 'Read as a parent.\n', now: NOW, slug: 'ps-abcd' });
    expect(slug).toBe('ps-abcd');
    expect(batch.message).toBe('Create principle set: Set 3 — Parenting');
    expect(paths(batch)).toEqual(['principles/ps-abcd/_set.md', 'principles/_index.md', 'maps/_index.md']);
    const w = batch.writes[0]!;
    expect('text' in w && w.text).toBe('---\ntype: principle-set\norder: 3\nname: Parenting\ncurated: human\ncreated: 2026-09-06T12:00:00Z\nupdated: 2026-09-06T12:00:00Z\n---\nRead as a parent.\n');
    expectClean(batch);
    expect(applyBatch(s, batch).sets.map((f) => f.fm.order)).toEqual([1, 2, 3]);
  });
  it('createSet without a name draws a slug and labels it Set N', () => {
    const { batch, slug } = createSet(s, { now: NOW });
    expect(isSetSlug(slug)).toBe(true);
    expect(batch.message).toBe('Create principle set: Set 3');
    expect(() => createSet(s, { now: NOW, slug: 'ps-g8xw' })).toThrow(/taken/);
  });
  it('updateSet renames, describes, removes a name, and refreshes updated', () => {
    const renamed = updateSet(s, 'ps-g8xw', { name: 'Life', now: NOW });
    expect(renamed.message).toBe('Update principle set: Set 1 — Life');
    expect(paths(renamed)).toEqual(['principles/ps-g8xw/_set.md', 'principles/_index.md', 'maps/_index.md']);
    expect(fileIn(renamed, 'principles/ps-g8xw/_set.md').fm).toMatchObject({ order: 1, name: 'Life', updated: NOW });
    expectClean(renamed);

    const unnamed = updateSet(s, 'ps-7k2m', { name: null, now: NOW });
    expect((fileIn(unnamed, 'principles/ps-7k2m/_set.md').fm as SetFm).name).toBeUndefined();

    const described = updateSet(s, 'ps-7k2m', { body: 'New framing.\n', now: NOW });
    expect(paths(described)).toEqual(['principles/ps-7k2m/_set.md']); // indexes do not show the body
    expect(fileIn(described, 'principles/ps-7k2m/_set.md').body).toBe('New framing.\n');

    const noop = updateSet(s, 'ps-7k2m', { name: 'Work', now: NOW });
    expect(fileIn(noop, 'principles/ps-7k2m/_set.md').fm.updated).toBe('2026-09-04T20:00:00Z');
  });
  it('reorderSets rewrites only sets whose order changed', () => {
    const swapped = reorderSets(s, ['ps-7k2m', 'ps-g8xw'], NOW);
    expect(swapped.message).toBe('Reorder principle sets');
    expect(paths(swapped)).toEqual(['principles/ps-7k2m/_set.md', 'principles/ps-g8xw/_set.md', 'principles/_index.md', 'maps/_index.md']);
    expect(fileIn(swapped, 'principles/ps-7k2m/_set.md').fm).toMatchObject({ order: 1, name: 'Work' });
    expect(fileIn(swapped, 'principles/ps-g8xw/_set.md').fm).toMatchObject({ order: 2 });
    expectClean(swapped);

    const three = applyBatch(s, createSet(s, { now: NOW, slug: 'ps-abcd' }).batch);
    const tail = reorderSets(three, ['ps-g8xw', 'ps-abcd', 'ps-7k2m'], NOW);
    expect(paths(tail)).toEqual(['principles/ps-abcd/_set.md', 'principles/ps-7k2m/_set.md', 'principles/_index.md', 'maps/_index.md']);

    expect(reorderSets(s, ['ps-g8xw', 'ps-7k2m'], NOW).writes).toEqual([]);
    expect(() => reorderSets(s, ['ps-g8xw'], NOW)).toThrow(/permutation/);
  });
  it('deleteSet removes the folder, renumbers, and reports dangling references', () => {
    const { batch, dangling } = deleteSet(s, 'ps-g8xw', NOW);
    expect(batch.message).toBe('Delete principle set: Set 1');
    expect(batch.deletes).toEqual(['principles/ps-g8xw/_set.md', 'principles/ps-g8xw/courage-before-comfort.md', 'principles/ps-g8xw/attention-is-generosity.md']);
    expect(paths(batch)).toEqual(['principles/ps-7k2m/_set.md', 'principles/_index.md', 'maps/_index.md']);
    expect(fileIn(batch, 'principles/ps-7k2m/_set.md').fm).toMatchObject({ order: 1, name: 'Work' });
    expect(dangling).toEqual([
      { path: 'maps/proposals/P-20260905-002.md', ref: 'ps-g8xw' },
      { path: 'maps/proposals/P-20260905-002.md', ref: 'ps-g8xw/courage-before-comfort' },
      { path: 'principles/ps-7k2m/say-the-hard-thing-first.md', ref: 'ps-g8xw/courage-before-comfort' },
    ]);
    expect(validateBatch(s, batch)).toEqual([]);
    const after = applyBatch(s, batch);
    expect(refusals(validateSnapshot(after))).toEqual([]);
    expect(validateSnapshot(after).map((i) => i.rule).sort()).toEqual(['related.dangling', 'target-set.dangling', 'target.dangling']);
    expect(after.sets.map((f) => [f.fm.order, f.fm.name])).toEqual([[1, 'Work']]);
  });
  it('the last set cannot be deleted', () => {
    const one = applyBatch(s, deleteSet(s, 'ps-g8xw', NOW).batch);
    expect(() => deleteSet(one, 'ps-7k2m', NOW)).toThrow(/last remaining/);
  });
});

describe('slugify and uniquePrincipleSlug (schema §3.3)', () => {
  it('derives slugs from titles', () => {
    expect(slugify('Courage before comfort')).toBe('courage-before-comfort');
    expect(slugify('  Élan — "vital"!  ')).toBe('elan-vital');
    expect(slugify('Attention: is — generosity?')).toBe('attention-is-generosity');
    expect(slugify('Go')).toBe('go-principle');
    expect(slugify('???')).toBe('principle');
    expect(slugify('x'.repeat(60) + '-yyyy')).toBe('x'.repeat(60));
    expect(slugify('x'.repeat(59) + '-yyyy')).toBe('x'.repeat(59)); // the cut lands on a hyphen, which is trimmed
  });
  it('appends -2, -3 on collision within the set only', () => {
    expect(uniquePrincipleSlug(s, 'ps-7k2m', 'write-to-find-out')).toBe('write-to-find-out-2');
    expect(uniquePrincipleSlug(s, 'ps-g8xw', 'write-to-find-out')).toBe('write-to-find-out');
    const two = applyBatch(s, createPrinciple(s, { setSlug: 'ps-7k2m', title: 'Write to find out', body: 'x\n', grounds: [], now: NOW }).batch);
    expect(uniquePrincipleSlug(two, 'ps-7k2m', 'write-to-find-out')).toBe('write-to-find-out-3');
  });
});

describe('principles (schema §7.9)', () => {
  it('createPrinciple appends at order N+1 with grounds and the canonical file', () => {
    const { batch, path } = createPrinciple(s, {
      setSlug: 'ps-7k2m', title: 'Rise to the work', grounds: ['aurelius-meditations-5-1'], tags: ['stoicism'],
      body: 'Get up.\n\n**Grounding passages:**\n\n- [[sources/aurelius-meditations-5-1/raw]] ([raw](../../sources/aurelius-meditations-5-1/raw.md))\n', now: NOW,
    });
    expect(path).toBe('principles/ps-7k2m/rise-to-the-work.md');
    expect(batch.message).toBe('Add principle: Rise to the work');
    expect(paths(batch)).toEqual([path, 'principles/_index.md', 'maps/_index.md']);
    const w = batch.writes[0]!;
    expect('text' in w && w.text.split('\n---\n')[0]).toBe(
      '---\ntype: principle\ntitle: Rise to the work\nset: ps-7k2m\norder: 3\ngrounds:\n  - aurelius-meditations-5-1\ntags:\n  - stoicism\ncurated: human\ncreated: 2026-09-06T12:00:00Z\nupdated: 2026-09-06T12:00:00Z',
    );
    expectClean(batch);
    expect(validateSnapshot(applyBatch(s, batch))).toEqual([]);
    expect(() => createPrinciple(s, { setSlug: 'ps-zzzz', title: 'x', body: '', grounds: [], now: NOW })).toThrow(/no principle set/);
  });
  it('updatePrinciple edits in place and never moves the file', () => {
    const p = 'principles/ps-g8xw/courage-before-comfort.md';
    const b = updatePrinciple(s, p, { title: 'Courage first', related: null, grounds: [], body: 'Rewritten.\n', now: NOW });
    expect(b.message).toBe('Edit principle: Courage first');
    expect(paths(b)).toEqual([p, 'principles/_index.md', 'maps/_index.md']);
    const f = fileIn(b, p);
    expect(f.fm).toMatchObject({ title: 'Courage first', set: 'ps-g8xw', order: 1, grounds: [], updated: NOW });
    expect((f.fm as PrincipleFm).related).toBeUndefined();
    expect(f.body).toBe('Rewritten.\n');
    expectClean(b);
    const bodyOnly = updatePrinciple(s, p, { body: 'Only the body.\n', now: NOW });
    expect(paths(bodyOnly)).toEqual([p]);
  });
  it('reorderPrinciples rewrites only moved files', () => {
    const b = reorderPrinciples(s, 'ps-7k2m', ['write-to-find-out', 'say-the-hard-thing-first'], NOW);
    expect(b.message).toBe('Reorder principles: Set 2 — Work');
    expect(paths(b)).toEqual(['principles/ps-7k2m/write-to-find-out.md', 'principles/ps-7k2m/say-the-hard-thing-first.md', 'principles/_index.md', 'maps/_index.md']);
    expect(fileIn(b, 'principles/ps-7k2m/write-to-find-out.md').fm.order).toBe(1);
    expect(fileIn(b, 'principles/ps-7k2m/say-the-hard-thing-first.md').fm.order).toBe(2);
    expectClean(b);

    const three = applyBatch(s, createPrinciple(s, { setSlug: 'ps-7k2m', title: 'Third', body: 'x\n', grounds: [], now: NOW }).batch);
    const tail = reorderPrinciples(three, 'ps-7k2m', ['say-the-hard-thing-first', 'third', 'write-to-find-out'], NOW);
    expect(paths(tail)).toEqual(['principles/ps-7k2m/third.md', 'principles/ps-7k2m/write-to-find-out.md', 'principles/_index.md', 'maps/_index.md']);
    expect(reorderPrinciples(s, 'ps-7k2m', ['say-the-hard-thing-first', 'write-to-find-out'], NOW).writes).toEqual([]);
    expect(() => reorderPrinciples(s, 'ps-7k2m', ['write-to-find-out'], NOW)).toThrow(/permutation/);
  });
  it('deletePrinciple closes the order gap and reports dangling references', () => {
    const p = 'principles/ps-g8xw/courage-before-comfort.md';
    const { batch, dangling } = deletePrinciple(s, p, NOW);
    expect(batch.message).toBe('Delete principle: Courage before comfort');
    expect(batch.deletes).toEqual([p]);
    expect(paths(batch)).toEqual(['principles/ps-g8xw/attention-is-generosity.md', 'principles/_index.md', 'maps/_index.md']);
    expect(fileIn(batch, 'principles/ps-g8xw/attention-is-generosity.md').fm.order).toBe(1);
    expect(dangling).toEqual([
      { path: 'maps/proposals/P-20260905-002.md', ref: 'ps-g8xw/courage-before-comfort' },
      { path: 'principles/ps-7k2m/say-the-hard-thing-first.md', ref: 'ps-g8xw/courage-before-comfort' },
    ]);
    expect(validateBatch(s, batch)).toEqual([]);
    expect(refusals(validateSnapshot(applyBatch(s, batch)))).toEqual([]);

    const last = deletePrinciple(s, 'principles/ps-7k2m/write-to-find-out.md', NOW);
    expect(paths(last.batch)).toEqual(['principles/_index.md', 'maps/_index.md']);
    expect(last.dangling).toEqual([{ path: 'maps/proposals/P-20260905-001.md', ref: 'principles/ps-7k2m/write-to-find-out' }]);
  });
});
