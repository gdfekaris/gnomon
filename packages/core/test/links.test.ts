import { describe, expect, it } from 'vitest';
import type { BrainFile, PrincipleFm } from '../src/index';
import { backlinks, groundsDrift, linkedSourceSlugs, parseLinks, relativePath, renderDualLink, resolveRelative } from '../src/index';
import { FIXTURE, GEO_BRAIN, hasGeoBrain, snapshotFromDisk } from './brains';

describe('relative paths', () => {
  it('relativePath matches os.path.relpath for the index and principle cases', () => {
    expect(relativePath('principles/_index.md', 'principles/ps-g8xw/x.md')).toBe('ps-g8xw/x.md');
    expect(relativePath('maps/_index.md', 'principles/ps-g8xw/x.md')).toBe('../principles/ps-g8xw/x.md');
    expect(relativePath('maps/_index.md', 'maps/proposals/P-20260905-001.md')).toBe('proposals/P-20260905-001.md');
    expect(relativePath('principles/ps-g8xw/x.md', 'sources/a-b/raw.md')).toBe('../../sources/a-b/raw.md');
    expect(relativePath('sources/a-b/notes.md', 'sources/a-b/raw.md')).toBe('raw.md');
    expect(relativePath('sources/a-b/notes.md', 'sources/c-d/raw.md')).toBe('../c-d/raw.md');
    expect(relativePath('README.md', 'AGENTS.md')).toBe('AGENTS.md');
  });
  it('resolveRelative inverts it', () => {
    expect(resolveRelative('principles/ps-g8xw/x.md', '../../sources/a-b/raw.md')).toBe('sources/a-b/raw.md');
    expect(resolveRelative('sources/a-b/notes.md', 'raw.md')).toBe('sources/a-b/raw.md');
    expect(resolveRelative('sources/a-b/notes.md', './raw.md')).toBe('sources/a-b/raw.md');
    expect(resolveRelative('maps/_index.md', 'proposals/P.md')).toBe('maps/proposals/P.md');
  });
});

describe('parseLinks', () => {
  const from = 'principles/ps-g8xw/x.md';
  it('reads a dual link as one ref with label and span', () => {
    const body = 'See [[sources/a-b/raw]] ([raw](../../sources/a-b/raw.md)) here.';
    const refs = parseLinks(body, from);
    expect(refs).toEqual([{ path: 'sources/a-b/raw.md', form: 'dual', label: 'raw', start: 4, end: 57 }]);
    expect(body.slice(refs[0]!.start, refs[0]!.end)).toBe('[[sources/a-b/raw]] ([raw](../../sources/a-b/raw.md))');
  });
  it('reads lone wikilinks, aliases, and anchors', () => {
    expect(parseLinks('[[sources/a-b/raw#part-2]]', from)).toEqual([{ path: 'sources/a-b/raw.md', anchor: 'part-2', form: 'wiki', start: 0, end: 26 }]);
    expect(parseLinks('[[sources/a-b/raw|the passage]]', from)[0]!.path).toBe('sources/a-b/raw.md');
    expect(parseLinks('[[sources/a-b/raw.md]]', from)[0]!.path).toBe('sources/a-b/raw.md');
  });
  it('reads lone relative links to .md files and ignores everything else', () => {
    const body = '[notes](../../sources/a-b/notes.md#top) [site](https://example.com/x.md) [img](../img.png) [root](/abs.md)';
    expect(parseLinks(body, from)).toEqual([{ path: 'sources/a-b/notes.md', anchor: 'top', form: 'relative', label: 'notes', start: 0, end: 39 }]);
  });
  it('flags a dual link whose halves disagree', () => {
    const refs = parseLinks('[[sources/a-b/raw]] ([raw](../../sources/c-d/raw.md))', from);
    expect(refs[0]).toMatchObject({ path: 'sources/a-b/raw.md', form: 'dual', mismatch: 'sources/c-d/raw.md' });
  });
  it('resolves heading-anchored dual links written from a notes file (geo-brain-2 style)', () => {
    const body = '1. [[sources/x-y/raw#1-the-short-answer]] ([raw](raw.md#1-the-short-answer)) — the meta.';
    const refs = parseLinks(body, 'sources/x-y/notes.md');
    expect(refs).toEqual([{ path: 'sources/x-y/raw.md', anchor: '1-the-short-answer', form: 'dual', label: 'raw', start: 3, end: 76 }]);
  });
  it('returns every occurrence in order', () => {
    const body = '[[a/b]] then [c](../c.md) then [[a/b]]';
    expect(parseLinks(body, 'd/e.md').map((r) => [r.form, r.path])).toEqual([['wiki', 'a/b.md'], ['relative', 'c.md'], ['wiki', 'a/b.md']]);
  });
});

describe('renderDualLink', () => {
  it('reproduces the fixture and index forms byte for byte', () => {
    expect(renderDualLink('principles/ps-g8xw/courage-before-comfort.md', 'sources/aurelius-meditations-4-3/raw.md')).toBe(
      '[[sources/aurelius-meditations-4-3/raw]] ([raw](../../sources/aurelius-meditations-4-3/raw.md))',
    );
    expect(renderDualLink('principles/_index.md', 'principles/ps-g8xw/courage-before-comfort.md')).toBe(
      '[[principles/ps-g8xw/courage-before-comfort]] ([principle](ps-g8xw/courage-before-comfort.md))',
    );
    expect(renderDualLink('maps/_index.md', 'maps/proposals/P-20260905-001.md')).toBe(
      '[[maps/proposals/P-20260905-001]] ([proposal](proposals/P-20260905-001.md))',
    );
    expect(renderDualLink('maps/_index.md', 'principles/ps-g8xw/courage-before-comfort.md', 'file')).toBe(
      '[[principles/ps-g8xw/courage-before-comfort]] ([file](../principles/ps-g8xw/courage-before-comfort.md))',
    );
  });
  it('appends an anchor to both halves and round-trips through parseLinks', () => {
    const s = renderDualLink('sources/x-y/notes.md', 'sources/x-y/raw.md', 'raw', '1-the-short-answer');
    expect(s).toBe('[[sources/x-y/raw#1-the-short-answer]] ([raw](raw.md#1-the-short-answer))');
    expect(parseLinks(s, 'sources/x-y/notes.md')[0]).toMatchObject({ path: 'sources/x-y/raw.md', anchor: '1-the-short-answer', form: 'dual' });
  });
});

describe('groundsDrift and linkedSourceSlugs', () => {
  const snapshot = snapshotFromDisk(FIXTURE);
  it('is empty for every fixture principle', () => {
    for (const p of snapshot.byType('principle')) expect(groundsDrift(p), p.path).toEqual({ inBodyOnly: [], inGroundsOnly: [] });
  });
  it('reports both directions', () => {
    const p = snapshot.files.get('principles/ps-7k2m/say-the-hard-thing-first.md') as BrainFile<PrincipleFm>;
    const drifted = { ...p, fm: { ...p.fm, grounds: ['didion-why-i-write', 'weil-attention'] } };
    expect(groundsDrift(drifted)).toEqual({ inBodyOnly: ['aurelius-meditations-4-3'], inGroundsOnly: ['weil-attention'] });
  });
  it('linkedSourceSlugs dedupes and keeps first-reference order', () => {
    expect(linkedSourceSlugs('[[sources/b-b/raw]] [[sources/a-a/raw#x]] [[sources/b-b/raw]] [[principles/ps-g8xw/x]]')).toEqual(['b-b', 'a-a']);
  });
});

describe('backlinks', () => {
  const snapshot = snapshotFromDisk(FIXTURE);
  const bl = backlinks(snapshot);
  it('combines body links and frontmatter references, sorted', () => {
    expect(bl.get('sources/aurelius-meditations-5-1/raw.md')).toEqual([
      'maps/proposals/P-20260905-001.md',
      'maps/proposals/P-20260905-002.md',
      'sources/aurelius-meditations-4-3/notes.md',
    ]);
    expect(bl.get('principles/ps-g8xw/courage-before-comfort.md')).toEqual([
      'maps/proposals/P-20260905-002.md',
      'principles/ps-7k2m/say-the-hard-thing-first.md',
    ]);
    expect(bl.get('principles/ps-7k2m/_set.md')).toEqual(['maps/proposals/P-20260905-001.md', 'maps/proposals/P-20260905-003.md']);
    expect(bl.get('sources/didion-why-i-write/raw.md')).toEqual(['maps/proposals/P-20260903-001.md', 'principles/ps-7k2m/say-the-hard-thing-first.md']);
  });
  it('ignores generated index files and self-links', () => {
    for (const from of bl.values()) expect(from.some((p) => p.endsWith('_index.md'))).toBe(false);
    expect(bl.get('maps/proposals/P-20260905-001.md')).toBeUndefined();
  });
  it.skipIf(!hasGeoBrain)('geo-brain-2: notes back-reference their raw passages by anchor', () => {
    const g = backlinks(snapshotFromDisk(GEO_BRAIN));
    expect(g.get('sources/fekaris-2026-the-meta/raw.md')).toContain('sources/fekaris-2026-the-meta/notes.md');
  });
});
