import { describe, expect, it } from 'vitest';
import type { BrainFile, SourceFm } from '@gnomon/core';
import { browseHash, byMonth, filterSources, matches, monthOf, moreLabel, normalize, pageGroups, parseTags, shelfGroups, shelves, sortSources, tagCounts, terms, topTags } from '../src/lib/services/browse';

const src = (slug: string, fm: Partial<SourceFm> & { title: string; author: string; created: string }): BrainFile<SourceFm> => ({
  path: `sources/${slug}/raw.md`, sha: '', encrypted: false, body: '',
  fm: { type: 'source', curated: 'ratified', updated: fm.created, ...fm } as SourceFm,
});
const aurelius = src('aurelius-4-3', { title: 'Retire into thyself', author: 'Marcus Aurelius', work: 'Meditations', year: 180, tags: ['stoicism', 'solitude'], created: '2026-09-03T10:02:11Z' });
const aurelius2 = src('aurelius-5-1', { title: 'The work of a human being', author: 'Marcus Aurelius', work: 'Meditations', year: 180, tags: ['stoicism', 'work'], created: '2026-09-05T16:00:00Z' });
const didion = src('didion-why-i-write', { title: "To find out what I'm thinking", author: 'Joan Didion', work: 'Why I Write', year: 1976, tags: ['writing', 'thinking'], created: '2026-08-03T10:02:40Z' });
const zola = src('zola-j-accuse', { title: 'J’accuse', author: 'Émile Zola', year: 1898, tags: ['writing'], created: '2026-07-14T09:00:00Z' });
const weil = src('weil-attention', { title: 'Attention as generosity', author: 'Simone Weil', tags: ['attention'], created: '2026-09-04T21:30:00Z' });
const all = [aurelius, aurelius2, didion, zola, weil];

describe('search over frontmatter', () => {
  it('normalizes case, diacritics, and whitespace', () => {
    expect(normalize('  Émile   ZOLA ')).toBe('emile zola');
    expect(terms('Émile  zola')).toEqual(['emile', 'zola']);
  });
  it('every term must match title, author, work, a tag, the slug, or (all digits) the year', () => {
    expect(matches(zola, terms('emile'))).toBe(true);
    expect(matches(zola, terms('1898'))).toBe(true);
    expect(matches(zola, terms('189'))).toBe(false); // a year matches whole, not as a substring
    expect(matches(aurelius, terms('medit stoic'))).toBe(true);
    expect(matches(aurelius, terms('medit writing'))).toBe(false);
    expect(matches(didion, terms('why-i-write'))).toBe(true); // the slug
    expect(matches(weil, terms(''))).toBe(true);
  });
  it('stacks on the tag filter, tags combining with AND', () => {
    expect(filterSources(all, { q: '', tags: ['stoicism'] }).map((f) => f.path)).toEqual([aurelius.path, aurelius2.path]);
    expect(filterSources(all, { q: '', tags: ['stoicism', 'work'] }).map((f) => f.path)).toEqual([aurelius2.path]);
    expect(filterSources(all, { q: 'writing', tags: [] })).toHaveLength(2);
    expect(filterSources(all, { q: 'writing', tags: ['thinking'] })).toEqual([didion]);
  });
});

describe('tags', () => {
  it('counts sources per tag, alphabetical', () => {
    expect([...tagCounts(all)]).toEqual([['attention', 1], ['solitude', 1], ['stoicism', 2], ['thinking', 1], ['work', 1], ['writing', 2]]);
  });
  it('keeps the most-used few plus any selected tag', () => {
    const counts = tagCounts(all);
    expect(topTags(counts, [], 2)).toEqual(['stoicism', 'writing']);
    expect(topTags(counts, ['work'], 2)).toEqual(['stoicism', 'writing', 'work']);
    expect(topTags(counts, ['nope'], 2)).toEqual(['stoicism', 'writing']);
  });
  it('reads and writes the hash', () => {
    expect(parseTags(null)).toEqual([]);
    expect(parseTags('stoicism, work,')).toEqual(['stoicism', 'work']);
    expect(browseHash('', [])).toBe('#/browse');
    expect(browseHash(' émile ', ['stoicism', 'work'])).toBe('#/browse?q=%C3%A9mile&tag=stoicism%2Cwork');
  });
});

describe('shelves, months, and pages', () => {
  it('sorts newest, oldest, or by author then work then title', () => {
    expect(sortSources(all, 'newest').map((f) => f.fm.title)[0]).toBe('The work of a human being');
    expect(sortSources(all, 'oldest').map((f) => f.fm.title)[0]).toBe('J’accuse');
    expect(sortSources(all, 'author').map((f) => f.fm.author)).toEqual(['Joan Didion', 'Marcus Aurelius', 'Marcus Aurelius', 'Simone Weil', 'Émile Zola']);
  });
  it('groups an author shelf by work, no work first', () => {
    const s = shelves(sortSources([...all, src('aurelius-x', { title: 'A letter', author: 'Marcus Aurelius', created: '2026-09-06T00:00:00Z' })], 'author'));
    const ma = s.find((x) => x.author === 'Marcus Aurelius')!;
    expect(ma.count).toBe(3);
    expect(ma.works.map((w) => [w.work, w.label, w.sources.length])).toEqual([[null, '', 1], ['Meditations', 'Meditations (180)', 2]]);
  });
  it('renders collapsed shelves as headings only, open ones with work sub-headings when an author has several sources', () => {
    const sorted = sortSources(all, 'author');
    const closed = shelfGroups(sorted, () => false);
    expect(closed.map((g) => [g.author?.name, g.author?.count, g.rows.length])).toEqual([['Joan Didion', 1, 0], ['Marcus Aurelius', 2, 0], ['Simone Weil', 1, 0], ['Émile Zola', 1, 0]]);
    const open = shelfGroups(sorted, (a) => a === 'Marcus Aurelius' || a === 'Joan Didion');
    expect(open.find((g) => g.author?.name === 'Marcus Aurelius')?.work).toEqual({ label: 'Meditations (180)', count: 2 });
    expect(open.find((g) => g.author?.name === 'Joan Didion')?.work).toBeUndefined(); // one source: no sub-heading
    expect(open.find((g) => g.author?.name === 'Joan Didion')?.rows).toHaveLength(1);
  });
  it('names months from the UTC date, locale-independent', () => {
    expect(monthOf('2026-09-03T10:02:11Z')).toBe('September 2026');
    expect(monthOf('2025-12-31T23:59:59Z')).toBe('December 2025');
    expect(byMonth(sortSources(all, 'newest')).map((m) => [m.month, m.sources.length])).toEqual([['September 2026', 3], ['August 2026', 1], ['July 2026', 1]]);
  });
  it('pages rows across groups, keeps shelf headings, and labels the rest', () => {
    const groups = shelfGroups(sortSources(all, 'author'), () => true);
    const p = pageGroups(groups, 3);
    expect(p.total).toBe(5);
    expect(p.left).toBe(2);
    expect(p.groups.map((g) => [g.author?.name, g.rows.length])).toEqual([['Joan Didion', 1], ['Marcus Aurelius', 2], ['Simone Weil', 0], ['Émile Zola', 0]]);
    const months = pageGroups(monthGroupsOf(), 3);
    expect(months.groups.map((g) => [g.month, g.rows.length])).toEqual([['September 2026', 3]]);
    expect(moreLabel(190)).toBe('Show 50 more (140 left)');
    expect(moreLabel(12)).toBe('Show the last 12');
  });
});
function monthGroupsOf() { return byMonth(sortSources(all, 'newest')).map((m) => ({ month: m.month, rows: m.sources })); }
