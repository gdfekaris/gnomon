import { describe, expect, it } from 'vitest';
import type { BrainFile, FileChange, InboxFm, NotesFm, SourceFm } from '../src/index';
import { applyBatch, buildFiling, buildRatify, filingSlug, filingState, isFilingCommit, parseFile, reviewFiling, serializeFile, validateBatch, validateSnapshot } from '../src/index';
import { FIXTURE, snapshotFromDisk } from './brains';

const s0 = snapshotFromDisk(FIXTURE, 'head0');
const NOW = '2026-09-07T12:00:00Z';
const LATER = '2026-09-07T13:00:00Z';

/** File the unfiled capture and describe the commit as compare would. */
function filed() {
  const capture = s0.files.get('inbox/20260906-070000-2bq.md') as BrainFile<InboxFm>;
  const batch = buildFiling(s0, capture, { title: 'Dance', author: 'Alan Watts', tags: ['change'] }, [{ kind: 'tag', title: 'Tag it', rationale: 'r\n' }], { now: NOW });
  const s1 = { ...applyBatch(s0, batch), head: 'head1' };
  const changes: FileChange[] = batch.writes.map((w) => (w.path.startsWith('inbox/') ? { path: w.path, status: 'modified' as const, patch: '@@ -1,7 +1,8 @@\n-status: unfiled\n+status: filed\n+filed_as: watts-dance\n' } : { path: w.path, status: 'added' as const }));
  return { s1, changes, batch };
}

describe('filing recognition (spec §9)', () => {
  it('filingSlug and isFilingCommit need the File: prefix and an added raw.md', () => {
    const { changes } = filed();
    expect(filingSlug(changes)).toBe('watts-dance');
    const info = { sha: 'x', message: 'File: watts-dance', date: NOW, parents: ['p'] };
    expect(isFilingCommit(info, changes)).toBe(true);
    expect(isFilingCommit({ ...info, message: 'Capture: x' }, changes)).toBe(false);
    expect(isFilingCommit(info, changes.filter((c) => !c.path.endsWith('raw.md')))).toBe(false);
    expect(filingSlug([{ path: 'sources/a-b/raw.md', status: 'modified' }])).toBeUndefined();
  });

  it('filingState follows the source through its life', () => {
    const { s1, changes } = filed();
    expect(filingState(s1, changes)).toBe('pending');
    const ratified = applyBatch(s1, buildRatify(s1, changes, LATER));
    expect(filingState(ratified, changes)).toBe('ratified');
    const rejected = applyBatch(s1, { message: 'x', expectedHead: 'head1', writes: [], deletes: ['sources/watts-dance/raw.md', 'sources/watts-dance/notes.md'] });
    expect(filingState(rejected, changes)).toBe('rejected');
    const raw = s1.files.get('sources/watts-dance/raw.md')!;
    const edited = applyBatch(s1, { message: 'x', expectedHead: 'head1', writes: [{ path: raw.path, text: serializeFile({ ...raw, fm: { ...raw.fm, curated: 'human' } as SourceFm }) }], deletes: [] });
    expect(filingState(edited, changes)).toBe('changed');
  });
});

describe('reviewFiling (proposal §9 decision 3)', () => {
  it('groups added files, attachments, and the capture\'s + lines', () => {
    const { s1, changes } = filed();
    const r = reviewFiling(s1, changes);
    expect(r.slug).toBe('watts-dance');
    expect(r.added.map((f) => f.path)).toEqual(['sources/watts-dance/raw.md', 'sources/watts-dance/notes.md', 'maps/proposals/P-20260907-001.md']);
    expect(r.attachments).toEqual([]);
    expect(r.capture).toEqual({ path: 'inbox/20260906-070000-2bq.md', addedLines: ['status: filed', 'filed_as: watts-dance'] });
    expect(() => reviewFiling(s1, [])).toThrow(/not a filing/);
  });
  it('lists an attachment by name and size', () => {
    const changes: FileChange[] = [{ path: 'sources/didion-why-i-write/raw.md', status: 'added' }, { path: 'sources/didion-why-i-write/original.pdf', status: 'added' }];
    const r = reviewFiling(s0, changes);
    expect(r.attachments).toEqual([{ path: 'sources/didion-why-i-write/original.pdf', size: s0.attachments.get('sources/didion-why-i-write/original.pdf')!.size }]);
  });
});

describe('buildRatify (spec §9, schema §5)', () => {
  it('flips curated on the source and notes only, refreshes updated, and carries the index', () => {
    const { s1, changes } = filed();
    const b = buildRatify(s1, changes, LATER);
    expect(b.message).toBe('Ratify: watts-dance');
    expect(b.expectedHead).toBe('head1');
    expect(b.deletes).toEqual([]);
    expect(b.writes.map((w) => w.path)).toEqual(['sources/watts-dance/raw.md', 'sources/watts-dance/notes.md', 'maps/_index.md']);
    const raw = parseFile('sources/watts-dance/raw.md', (b.writes[0] as { text: string }).text);
    const before = s1.files.get('sources/watts-dance/raw.md')!;
    expect(raw.fm).toEqual({ ...before.fm, curated: 'ratified', updated: LATER });
    expect(raw.body).toBe(before.body);
    expect(validateBatch(s1, b)).toEqual([]);
    const s2 = applyBatch(s1, b);
    expect(validateSnapshot(s2)).toEqual([]);
    expect((s2.files.get('sources/watts-dance/raw.md')!.fm as SourceFm).curated).toBe('ratified');
    expect((s2.files.get('sources/watts-dance/notes.md')!.fm as NotesFm).curated).toBe('ratified');
    // the proposal and the capture are exactly as the filing wrote them
    expect(s2.files.get('maps/proposals/P-20260907-001.md')!.fm).toEqual(s1.files.get('maps/proposals/P-20260907-001.md')!.fm);
    expect(s2.files.get('inbox/20260906-070000-2bq.md')!.fm).toEqual(s1.files.get('inbox/20260906-070000-2bq.md')!.fm);
    // the index no longer marks this source pending (the fixture's other pending source still is)
    expect((b.writes[2] as { text: string }).text).not.toMatch(/Dance.*agent-proposed/);
    expect((b.writes[2] as { text: string }).text).toMatch(/The work of a human being.*agent-proposed/);
  });

  it('refuses a non-filing, a ratified filing, and a rejected one', () => {
    const { s1, changes } = filed();
    expect(() => buildRatify(s1, [], LATER)).toThrow(/not a filing/);
    const s2 = applyBatch(s1, buildRatify(s1, changes, LATER));
    expect(() => buildRatify(s2, changes, LATER)).toThrow(/already ratified/);
    const gone = applyBatch(s1, { message: 'x', expectedHead: 'head1', writes: [], deletes: ['sources/watts-dance/raw.md', 'sources/watts-dance/notes.md', 'maps/proposals/P-20260907-001.md'] });
    expect(() => buildRatify(gone, changes, LATER)).toThrow(/rejected/);
  });

  it('ratifying the fixture\'s pending filing touches exactly two files', () => {
    const changes: FileChange[] = [
      { path: 'sources/aurelius-meditations-5-1/raw.md', status: 'added' },
      { path: 'sources/aurelius-meditations-5-1/notes.md', status: 'added' },
      { path: 'maps/proposals/P-20260905-001.md', status: 'added' },
      { path: 'maps/proposals/P-20260905-002.md', status: 'added' },
      { path: 'inbox/20260905-143012-x7q.md', status: 'modified' },
    ];
    const b = buildRatify(s0, changes, LATER);
    expect(b.writes.map((w) => w.path)).toEqual(['sources/aurelius-meditations-5-1/raw.md', 'sources/aurelius-meditations-5-1/notes.md', 'maps/_index.md']);
    expect(validateSnapshot(applyBatch(s0, b))).toEqual([]);
  });
});
