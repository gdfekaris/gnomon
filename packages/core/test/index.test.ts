import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INDEX_PATHS, cmpCodepoint, generateIndexes, indexWrites, parseFile, serializeFile, validateSnapshot } from '../src/index';
import { FIXTURE, GEO_BRAIN, TEMPLATE, hasGeoBrain, readBrain, snapshotFromDisk, snapshotOf } from './brains';

const CHECKER = join(FIXTURE, '..', '..', '..', '..', 'tools', 'gnomon-check.py');
let pythonOk = false;
try {
  execFileSync('python3', ['-c', 'import yaml'], { stdio: 'ignore' });
  pythonOk = true;
} catch {
  pythonOk = false;
}

describe('generateIndexes matches the golden brains byte for byte (spec §7.2)', () => {
  for (const [name, root] of [['template', TEMPLATE], ['fixture', FIXTURE]] as const) {
    it(name, () => {
      const files = readBrain(root);
      const out = generateIndexes(snapshotFromDisk(root));
      for (const p of INDEX_PATHS) expect(out[p], p).toBe(files.get(p));
      expect(indexWrites(snapshotFromDisk(root))).toEqual([]);
    });
  }
  it.skipIf(!hasGeoBrain)('geo-brain-2', () => {
    const files = readBrain(GEO_BRAIN);
    const out = generateIndexes(snapshotFromDisk(GEO_BRAIN));
    for (const p of INDEX_PATHS) expect(out[p], p).toBe(files.get(p));
    expect(indexWrites(snapshotFromDisk(GEO_BRAIN))).toEqual([]);
  });
  it('output is canonical: parse then serialize is the identity, and it validates', () => {
    const out = generateIndexes(snapshotFromDisk(FIXTURE));
    for (const p of INDEX_PATHS) expect(serializeFile(parseFile(p, out[p]))).toBe(out[p]);
  });
});

describe('indexWrites', () => {
  const fixture = readBrain(FIXTURE);
  it('writes only the index that changed', () => {
    const notes = 'sources/weil-attention/notes.md';
    const tagged = snapshotOf(fixture, { [notes]: fixture.get(notes)!.replace('curated: human', 'tags:\n  - margin\ncurated: human') });
    expect(indexWrites(tagged).map((w) => w.path)).toEqual(['maps/_index.md']);
    const p = 'principles/ps-g8xw/courage-before-comfort.md';
    const retitled = snapshotOf(fixture, { [p]: fixture.get(p)!.replace('title: Courage before comfort', 'title: Courage first') });
    expect(indexWrites(retitled).map((w) => w.path)).toEqual(['principles/_index.md', 'maps/_index.md']);
  });
  it('writes both when they are missing', () => {
    const missing = snapshotOf(fixture, { 'maps/_index.md': null, 'principles/_index.md': null });
    expect(indexWrites(missing).map((w) => w.path)).toEqual(['principles/_index.md', 'maps/_index.md']);
  });
});

describe('cmpCodepoint', () => {
  it('orders by codepoint, uppercase before lowercase, astral after BMP', () => {
    expect(['b', 'B', 'a', 'A', 'é', 'z', '𝔘', 'ﬀ'].sort(cmpCodepoint)).toEqual(['A', 'B', 'a', 'b', 'z', 'é', 'ﬀ', '𝔘']);
  });
});

/** Variants of the fixture that exercise generator branches the golden brains do not. */
const VARIANTS: Record<string, Record<string, string | null>> = {
  'named set 1, a third empty set, unicode and punctuation in labels and titles': {
    'principles/ps-g8xw/_set.md': '---\ntype: principle-set\norder: 1\nname: Élan — "vital"\ncurated: human\ncreated: 2026-09-05\nupdated: 2026-09-05\n---\n',
    'principles/ps-2222/_set.md': '---\ntype: principle-set\norder: 3\ncurated: human\ncreated: 2026-09-05\nupdated: 2026-09-05\n---\n',
    'principles/ps-g8xw/courage-before-comfort.md': null,
    'principles/ps-g8xw/attention-is-generosity.md': '---\ntype: principle\ntitle: "Attention: is — generosity?"\nset: ps-g8xw\norder: 1\ngrounds:\n  - weil-attention\n  - weil-attention\ncurated: human\ncreated: 2026-09-05\nupdated: 2026-09-05\n---\nx\n',
  },
  'sources: year without work, work without year, lowercase author sorts after uppercase, same author and work': {
    'sources/aurelius-meditations-4-3/raw.md': '---\ntype: source\ntitle: Retire\nauthor: aurelius\nyear: 180\ncurated: human\ncreated: 2026-09-05\nupdated: 2026-09-05\n---\nx\n',
    'sources/weil-attention/raw.md': '---\ntype: source\ntitle: Attention\nauthor: Weil, Simone\nwork: Letters\ncurated: agent-proposed\ncreated: 2026-09-05\nupdated: 2026-09-05\n---\nx\n',
    'sources/zz-top/raw.md': '---\ntype: source\ntitle: A\nauthor: Marcus Aurelius\nwork: Meditations\ncurated: ratified\ncreated: 2026-09-05\nupdated: 2026-09-05\n---\nx\n',
    'sources/zz-top/notes.md': '---\ntype: notes\nsource: zz-top\ncurated: human\ncreated: 2026-09-05\nupdated: 2026-09-05\n---\n',
  },
  'tags on inbox, notes, set, and proposal files; digits in tags; open proposal without target_set': {
    'inbox/20260906-070000-2bq.md': '---\ntype: inbox\nstatus: unfiled\ntags:\n  - "2026"\n  - stoicism\ncurated: human\ncreated: 2026-09-06\nupdated: 2026-09-06\n---\nx\n',
    'sources/weil-attention/notes.md': '---\ntype: notes\nsource: weil-attention\ntags:\n  - attention\ncurated: human\ncreated: 2026-09-05\nupdated: 2026-09-05\n---\n',
    'principles/ps-7k2m/_set.md': '---\ntype: principle-set\norder: 2\nname: Work\ntags:\n  - work\ncurated: human\ncreated: 2026-09-05\nupdated: 2026-09-05\n---\n',
    'maps/proposals/P-20260903-001.md': '---\ntype: proposal\nkind: tag\ntitle: Tag it\ntarget: didion-why-i-write\ntags:\n  - work\nstatus: open\ncurated: agent-proposed\ncreated: 2026-09-03\nupdated: 2026-09-03\n---\nx\n',
  },
  'empty brain with one principle and no sources, proposals, or tags': {
    ...Object.fromEntries([...readBrain(FIXTURE).keys()].filter((p) => /^(sources|inbox|maps\/proposals)\//.test(p) && !p.endsWith('.gitkeep')).map((p) => [p, null])),
    'principles/ps-7k2m/_set.md': null,
    'principles/ps-7k2m/say-the-hard-thing-first.md': null,
    'principles/ps-7k2m/write-to-find-out.md': null,
    'principles/ps-g8xw/attention-is-generosity.md': null,
    'principles/ps-g8xw/courage-before-comfort.md': '---\ntype: principle\ntitle: Alone\nset: ps-g8xw\norder: 1\ngrounds: []\ncurated: human\ncreated: 2026-09-05\nupdated: 2026-09-05\n---\nx\n',
  },
};

describe.skipIf(!pythonOk)('generateIndexes agrees with tools/gnomon-check.py on fixture variants', () => {
  const fixture = readBrain(FIXTURE);
  for (const [name, edits] of Object.entries(VARIANTS)) {
    it(name, () => {
      const files = new Map(fixture);
      for (const [p, v] of Object.entries(edits)) v === null ? files.delete(p) : files.set(p, v);
      const dir = mkdtempSync(join(tmpdir(), 'gnomon-index-'));
      try {
        for (const [p, text] of files) {
          mkdirSync(dirname(join(dir, p)), { recursive: true });
          writeFileSync(join(dir, p), text);
        }
        execFileSync('python3', [CHECKER, dir, '--write'], { stdio: ['ignore', 'pipe', 'pipe'] });
        const snapshot = snapshotOf(fixture, edits);
        const ours = generateIndexes(snapshot);
        for (const p of INDEX_PATHS) expect(ours[p], p).toBe(readFileSync(join(dir, p), 'utf8'));
        // the variants are meant to be valid brains, so the comparison is on real cases
        expect(validateSnapshot(snapshot).filter((i) => i.level === 'refusal')).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
