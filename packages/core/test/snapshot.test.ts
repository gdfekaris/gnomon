import { describe, expect, it } from 'vitest';
import { type TreeEntry, buildSnapshot } from '../src/index';
import { FIXTURE, GEO_BRAIN, TEMPLATE, hasGeoBrain, readBrain, snapshotFromDisk } from './brains';

describe('buildSnapshot (spec §5)', () => {
  const fixture = snapshotFromDisk(FIXTURE, 'abc123');

  it('parses every frontmatter file in the fixture with no issues', () => {
    expect(fixture.head).toBe('abc123');
    expect(fixture.issues).toEqual([]);
    expect(fixture.files.size).toBe(24);
  });
  it('byType covers every type', () => {
    expect(fixture.byType('source').length).toBe(4);
    expect(fixture.byType('notes').length).toBe(4);
    expect(fixture.byType('principle').length).toBe(4);
    expect(fixture.byType('principle-set').length).toBe(2);
    expect(fixture.byType('inbox').length).toBe(4);
    expect(fixture.byType('proposal').length).toBe(4);
    expect(fixture.byType('index').length).toBe(2);
    expect(fixture.byType('source').every((f) => f.fm.type === 'source')).toBe(true);
  });
  it('sets are sorted by order', () => {
    expect(fixture.sets.map((s) => [s.fm.order, s.path])).toEqual([
      [1, 'principles/ps-g8xw/_set.md'],
      [2, 'principles/ps-7k2m/_set.md'],
    ]);
  });
  it('principlesOf is sorted by order and empty for unknown sets', () => {
    expect(fixture.principlesOf('ps-7k2m').map((p) => [p.fm.order, p.fm.title])).toEqual([
      [1, 'Say the hard thing first'],
      [2, 'Write to find out'],
    ]);
    expect(fixture.principlesOf('ps-g8xw').map((p) => p.fm.order)).toEqual([1, 2]);
    expect(fixture.principlesOf('ps-zzzz')).toEqual([]);
  });
  it('collects attachments and ignores dot files, keepers, and exempt markdown', () => {
    expect([...fixture.attachments.keys()]).toEqual(['inbox/20260902-190433-p9r.pdf', 'sources/didion-why-i-write/original.pdf']);
    expect(fixture.attachments.get('sources/didion-why-i-write/original.pdf')!.size).toBeGreaterThan(0);
    expect(fixture.files.has('README.md')).toBe(false);
    expect(fixture.files.has('templates/raw.md')).toBe(false);
  });
  it('the template has Set 1 and nothing in it', () => {
    const t = snapshotFromDisk(TEMPLATE);
    expect(t.issues).toEqual([]);
    expect(t.sets.map((s) => s.fm.order)).toEqual([1]);
    expect(t.principlesOf('ps-g8xw')).toEqual([]);
    expect(t.attachments.size).toBe(0);
    expect(t.files.size).toBe(3);
  });
  it.skipIf(!hasGeoBrain)('geo-brain-2 builds clean', () => {
    const g = snapshotFromDisk(GEO_BRAIN);
    expect(g.issues).toEqual([]);
    expect(g.sets.length).toBe(1);
    expect(g.principlesOf('ps-g8xw').length).toBe(1);
  });
  it('reports unparseable and unread files as issues and leaves them out', () => {
    const all = readBrain(FIXTURE);
    const tree: TreeEntry[] = [...all.keys()].map((path) => ({ path, sha: '', size: 1 }));
    tree.push({ path: 'principles/ps-g8xw/broken.md', sha: '', size: 1 }, { path: 'inbox/20260906-080000-abc.md', sha: '', size: 1 });
    const texts = new Map([...all].filter(([p]) => p.endsWith('.md')).map(([p, text]) => [p, { text, sha: '' }]));
    texts.set('principles/ps-g8xw/broken.md', { text: '---\ntype: principle\n---\n', sha: '' });
    const s = buildSnapshot({ head: 'h', tree, texts });
    expect(s.files.size).toBe(24);
    expect(s.issues.filter((i) => i.path === 'inbox/20260906-080000-abc.md').map((i) => i.rule)).toEqual(['file.unreadable']);
    const broken = s.issues.filter((i) => i.path === 'principles/ps-g8xw/broken.md');
    expect(broken.length).toBe(7); // curated, created, updated, title, set, order, grounds
    expect(broken.every((i) => i.rule === 'field.required' && i.level === 'refusal')).toBe(true);
    expect(s.issues.length).toBe(8);
  });
  it('orders deterministically when two files share an order', () => {
    const set = (slug: string, order: number) => [
      `principles/${slug}/_set.md`,
      `---\ntype: principle-set\norder: ${order}\ncurated: human\ncreated: 2026-09-05\nupdated: 2026-09-05\n---\n`,
    ] as const;
    const entries = [set('ps-g8xw', 1), set('ps-7k2m', 1), set('ps-2222', 2)];
    const s = buildSnapshot({
      head: 'h',
      tree: entries.map(([path]) => ({ path, sha: '', size: 1 })),
      texts: new Map(entries.map(([path, text]) => [path, { text, sha: '' }])),
    });
    expect(s.sets.map((x) => x.path)).toEqual(['principles/ps-7k2m/_set.md', 'principles/ps-g8xw/_set.md', 'principles/ps-2222/_set.md']);
  });
  it('passes sha and the encrypted flag through', () => {
    const path = 'principles/ps-g8xw/_set.md';
    const text = '---\ntype: principle-set\norder: 1\ncurated: human\ncreated: 2026-09-05\nupdated: 2026-09-05\n---\n';
    const s = buildSnapshot({ head: 'h', tree: [{ path, sha: 'deadbeef', size: 1 }], texts: new Map([[path, { text, sha: 'deadbeef' }]]), encrypted: true });
    expect(s.files.get(path)!.sha).toBe('deadbeef');
    expect(s.files.get(path)!.encrypted).toBe(true);
  });
});
