import { describe, expect, it } from 'vitest';
import type { BrainFile, PrincipleFm, SourceFm } from '../src/index';
import { emitScalar, parseFile, serializeFile, serializeFrontmatter } from '../src/index';

describe('emitScalar', () => {
  it('emits plain scalars when they read back identically', () => {
    for (const v of ['Retire into thyself', 'What Is "the Meta"?', 'Fekaris (curator)', 'Set 2 — Work', '2026-09-04', 'yes', '12:30', 'a,b', "it's"]) {
      expect(emitScalar(v)).toBe(v);
    }
    expect(emitScalar(180)).toBe('180');
  });
  it('double-quotes anything that would read back differently', () => {
    expect(emitScalar('')).toBe('""');
    expect(emitScalar('true')).toBe('"true"');
    expect(emitScalar('180')).toBe('"180"');
    expect(emitScalar('null')).toBe('"null"');
    expect(emitScalar('1e3')).toBe('"1e3"');
    expect(emitScalar('a: b')).toBe('"a: b"');
    expect(emitScalar('a #x')).toBe('"a #x"');
    expect(emitScalar('#x')).toBe('"#x"');
    expect(emitScalar(' lead')).toBe('" lead"');
    expect(emitScalar('trail ')).toBe('"trail "');
    expect(emitScalar('a\nb')).toBe('"a\\nb"');
    expect(emitScalar('- a')).toBe('"- a"');
    expect(emitScalar('[a]')).toBe('"[a]"');
    expect(emitScalar('*x')).toBe('"*x"');
    expect(emitScalar('!x')).toBe('"!x"');
  });
  it('quoted output always reads back through the parser', () => {
    for (const v of ['', 'true', 'a: b', 'a\nb', 'x "q" \\ é', '- a', '#x', 'trail ']) {
      const text = `---\ntype: source\ntitle: ${emitScalar(v)}\nauthor: a\ncurated: human\ncreated: 2026-09-05\nupdated: 2026-09-05\n---\n`;
      expect((parseFile('sources/a-b/raw.md', text).fm as SourceFm).title).toBe(v);
    }
  });
});

describe('serializeFrontmatter', () => {
  it('orders keys canonically, writes block lists, and empty lists inline', () => {
    const fm: PrincipleFm = {
      updated: '2026-09-05',
      created: '2026-09-05',
      curated: 'human',
      grounds: ['a-b', 'c-d'],
      order: 2,
      set: 'ps-g8xw',
      title: 'T',
      type: 'principle',
      related: [],
    };
    expect(serializeFrontmatter(fm)).toBe(
      '---\ntype: principle\ntitle: T\nset: ps-g8xw\norder: 2\ngrounds:\n  - a-b\n  - c-d\nrelated: []\ncurated: human\ncreated: 2026-09-05\nupdated: 2026-09-05\n---\n',
    );
  });
  it('keeps unknown keys after the known ones, sorted by codepoint', () => {
    const fm = { type: 'notes', source: 'a-b', zeta: 'z', alpha: 'a', curated: 'human', created: '2026-09-05', updated: '2026-09-05' };
    expect(serializeFrontmatter(fm as never)).toBe(
      '---\ntype: notes\nsource: a-b\ncurated: human\ncreated: 2026-09-05\nupdated: 2026-09-05\nalpha: a\nzeta: z\n---\n',
    );
  });
  it('refuses unsupported values', () => {
    expect(() => serializeFrontmatter({ type: 'notes', source: { a: 1 } } as never)).toThrow(TypeError);
  });
});

describe('serializeFile', () => {
  const base: BrainFile = {
    path: 'sources/a-b/notes.md',
    sha: '',
    fm: { type: 'notes', source: 'a-b', curated: 'human', created: '2026-09-05', updated: '2026-09-05' },
    body: 'Marginalia.',
    encrypted: false,
  };
  it('ends the body with exactly one newline, or nothing when empty', () => {
    expect(serializeFile(base)).toMatch(/---\nMarginalia\.\n$/);
    expect(serializeFile({ ...base, body: 'Marginalia.\n\n\n' })).toMatch(/---\nMarginalia\.\n$/);
    expect(serializeFile({ ...base, body: '' })).toMatch(/updated: 2026-09-05\n---\n$/);
    expect(serializeFile({ ...base, body: '\n\n' })).toMatch(/updated: 2026-09-05\n---\n$/);
  });
  it('refreshes updated only when content changed relative to prev', () => {
    const now = '2026-09-06T12:00:00Z';
    expect(serializeFile(base, { prev: base, now })).toContain('updated: 2026-09-05\n');
    expect(serializeFile({ ...base, body: 'Edited.' }, { prev: base, now })).toContain(`updated: ${now}\n`);
    const retagged = { ...base, fm: { ...base.fm, tags: ['x'] } } as BrainFile;
    expect(serializeFile(retagged, { prev: base, now })).toContain(`updated: ${now}\n`);
    // A differing `updated` alone is not a content change.
    const stamped = { ...base, fm: { ...base.fm, updated: '2026-01-01' } } as BrainFile;
    expect(serializeFile(stamped, { prev: base, now })).toContain('updated: 2026-01-01\n');
  });
});
