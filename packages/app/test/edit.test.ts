import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type NotesFm, type PrincipleFm, type SourceFm, ValidationError, validateSnapshot } from '@gnomon/core';
import { MemoryDriver } from '@gnomon/storage';
import { BrainService, type SnapshotState } from '../src/lib/services/brain';
import { appendGroundingLink, createPrincipleIn, driftOf, parseList, saveNotes, savePrinciple, saveSourceMeta, tagList } from '../src/lib/services/edit';

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

describe('edit helpers', () => {
  it('appendGroundingLink adds the heading once and one dual link per call', () => {
    const p = 'principles/ps-7k2m/x.md';
    const one = appendGroundingLink('Body.\n', p, 'weil-attention');
    expect(one).toBe('Body.\n\n**Grounding passages:**\n\n- [[sources/weil-attention/raw]] ([raw](../../sources/weil-attention/raw.md))\n');
    const two = appendGroundingLink(one, p, 'didion-why-i-write');
    expect(two.endsWith('- [[sources/weil-attention/raw]] ([raw](../../sources/weil-attention/raw.md))\n- [[sources/didion-why-i-write/raw]] ([raw](../../sources/didion-why-i-write/raw.md))\n')).toBe(true);
    expect(two.match(/Grounding passages/g)!.length).toBe(1);
    expect(driftOf(p, two, ['weil-attention'])).toEqual({ inBodyOnly: ['didion-why-i-write'], inGroundsOnly: [] });
    expect(driftOf(p, 'no links', ['weil-attention'])).toEqual({ inBodyOnly: [], inGroundsOnly: ['weil-attention'] });
    expect(parseList(' a, b ,, a\nc ')).toEqual(['a', 'b', 'c']);
    expect(tagList('Stoic Calm, work, ---')).toEqual(['stoic-calm', 'work']);
  });
});

describe('editors (US-4, US-6, US-7)', () => {
  it('creates and edits a principle through the write rules', async () => {
    const { brain, driver } = await connected();
    const path = await createPrincipleIn(brain, 'ps-7k2m', { title: 'Rise to the work', body: appendGroundingLink('Get up.\n', 'principles/ps-7k2m/rise-to-the-work.md', 'aurelius-meditations-5-1'), grounds: ['aurelius-meditations-5-1'], related: ['ps-g8xw/courage-before-comfort'], tags: ['stoicism'] });
    expect(path).toBe('principles/ps-7k2m/rise-to-the-work.md');
    const fm = brain.snapshot!.files.get(path)!.fm as PrincipleFm;
    expect(fm).toMatchObject({ order: 3, grounds: ['aurelius-meditations-5-1'], related: ['ps-g8xw/courage-before-comfort'], tags: ['stoicism'], curated: 'human' });
    expect(validateSnapshot(brain.snapshot!)).toEqual([]);
    await savePrinciple(brain, path, { title: 'Rise', body: 'Changed.\n', grounds: [], related: [], tags: [] });
    const after = brain.snapshot!.files.get(path)!;
    expect(after.fm).toMatchObject({ title: 'Rise', order: 3, grounds: [] });
    expect((after.fm as PrincipleFm).related).toBeUndefined();
    expect(after.body).toBe('Changed.\n');
    expect((await driver.history({ limit: 2 })).map((c) => c.message)).toEqual(['Edit principle: Rise', 'Add principle: Rise to the work']);
  });

  it('editing notes makes them human, whatever they were', async () => {
    const { brain } = await connected();
    for (const [path, before] of [['sources/aurelius-meditations-5-1/notes.md', 'agent-proposed'], ['sources/didion-why-i-write/notes.md', 'ratified'], ['sources/weil-attention/notes.md', 'human']] as const) {
      expect((brain.snapshot!.files.get(path)!.fm as NotesFm).curated).toBe(before);
      await saveNotes(brain, path, 'My note.\n');
      const f = brain.snapshot!.files.get(path)!;
      expect((f.fm as NotesFm).curated).toBe('human');
      expect(f.body).toBe('My note.\n');
    }
    expect(validateSnapshot(brain.snapshot!)).toEqual([]);
  });

  it('source metadata edits keep the body byte for byte and make the file human', async () => {
    const { brain, driver } = await connected();
    const path = 'sources/didion-why-i-write/raw.md';
    const before = brain.snapshot!.files.get(path)!;
    await saveSourceMeta(brain, path, { title: 'Why I write', author: '', work: '', year: '1976', locator: 'p. 2', origin: '', tags: ['Writing'] });
    const after = brain.snapshot!.files.get(path)!;
    expect(after.body).toBe(before.body);
    // blanked optional fields are removed; the rest is rewritten; inbox_ref and attachment are untouched
    const { work: _w, origin: _o, ...kept } = before.fm as SourceFm;
    expect(after.fm).toEqual({ ...kept, title: 'Why I write', author: 'unknown', year: 1976, locator: 'p. 2', tags: ['Writing'], curated: 'human', updated: (after.fm as SourceFm).updated });
    expect((after.fm as SourceFm).work).toBeUndefined();
    expect((after.fm as SourceFm).attachment).toBe('original.pdf');
    expect(validateSnapshot(brain.snapshot!)).toEqual([]);
    expect((await driver.history({ limit: 1 }))[0]!.message).toBe('Edit source: didion-why-i-write');
    await expect(saveSourceMeta(brain, path, { title: 'x', author: 'a', work: '', year: 'soon', locator: '', origin: '', tags: [] })).rejects.toThrow(/whole number/);
  });

  it('the write rules still refuse a raw body change even if a caller tries', async () => {
    const { brain } = await connected();
    const path = 'sources/weil-attention/raw.md';
    const f = brain.snapshot!.files.get(path)!;
    const tampered = `${(await import('@gnomon/core')).serializeFile({ ...f, body: 'Retyped.\n' })}`;
    await expect(brain.commit({ message: 'x', expectedHead: brain.head!, writes: [{ path, text: tampered }], deletes: [] })).rejects.toBeInstanceOf(ValidationError);
  });
});
