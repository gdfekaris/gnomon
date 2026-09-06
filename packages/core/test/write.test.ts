import { describe, expect, it } from 'vitest';
import type { BrainFile, CommitBatch, Issue, SourceFm } from '../src/index';
import { applyBatch, parseFile, serializeFile, validateBatch, validateSnapshot, validateWrite } from '../src/index';
import { FIXTURE, readBrain, snapshotFromDisk } from './brains';

const fixture = readBrain(FIXTURE);
const snapshot = snapshotFromDisk(FIXTURE, 'head1');
const rules = (issues: Issue[]) => issues.map((i) => i.rule).sort();

function file(path: string, mutate: (text: string) => string = (t) => t): BrainFile {
  const text = fixture.get(path);
  if (text === undefined) throw new Error(path);
  return parseFile(path, mutate(text));
}
const RAW = 'sources/aurelius-meditations-4-3/raw.md';
const NOTES = 'sources/aurelius-meditations-4-3/notes.md';
const INBOX = 'inbox/20260902-190433-p9r.md';
const PRINCIPLE = 'principles/ps-g8xw/courage-before-comfort.md';

describe('validateWrite (spec §7.4)', () => {
  it('a new file has no per-write rules', () => {
    expect(validateWrite(undefined, file(RAW))).toEqual([]);
  });
  it('an unchanged rewrite passes', () => {
    expect(validateWrite(file(RAW), file(RAW))).toEqual([]);
  });
  it('write.path-mismatch / write.type-change', () => {
    expect(rules(validateWrite(file(NOTES), file(RAW)))).toEqual(['write.path-mismatch']);
    const asNotes = { ...file(RAW), fm: { ...file(NOTES).fm } } as BrainFile;
    expect(rules(validateWrite(file(RAW), asNotes))).toEqual(['write.type-change']);
  });
  it('raw.immutable in every curation state', () => {
    for (const state of ['ratified', 'human', 'agent-proposed']) {
      const prev = file(RAW, (t) => t.replace('curated: ratified', `curated: ${state}`));
      const next = { ...prev, body: prev.body + 'An added line.\n' };
      expect(rules(validateWrite(prev, next)), state).toEqual(['raw.immutable']);
    }
  });
  it('raw.md frontmatter may change: tags, metadata, and ratification', () => {
    const prev = file(RAW, (t) => t.replace('curated: ratified', 'curated: agent-proposed'));
    const next = file(RAW, (t) => t.replace('  - solitude', '  - solitude\n  - retreat').replace('title: Retire into thyself', 'title: Retreat into thyself'));
    expect(validateWrite(prev, next)).toEqual([]);
  });
  it('attachment.immutable on a source when the field is added, removed, or renamed', () => {
    const src = 'sources/didion-why-i-write/raw.md';
    expect(rules(validateWrite(file(src), file(src, (t) => t.replace('attachment: original.pdf', 'attachment: original.png'))))).toEqual(['attachment.immutable']);
    expect(rules(validateWrite(file(src), file(src, (t) => t.replace('attachment: original.pdf\n', ''))))).toEqual(['attachment.immutable']);
    expect(rules(validateWrite(file(RAW), file(RAW, (t) => t.replace('inbox_ref:', 'attachment: original.pdf\ninbox_ref:'))))).toEqual(['attachment.immutable']);
  });
  it('created.immutable on any file', () => {
    expect(rules(validateWrite(file(PRINCIPLE), file(PRINCIPLE, (t) => t.replace('created: 2026-09-04T09:30:00Z', 'created: 2026-09-04T09:31:00Z'))))).toEqual(['created.immutable']);
  });
  it('curated.transition allows only the schema §5 moves', () => {
    const at = (state: string) => file(NOTES, (t) => t.replace('curated: human', `curated: ${state}`));
    const ok = [['agent-proposed', 'ratified'], ['agent-proposed', 'human'], ['ratified', 'human']];
    const bad = [['human', 'ratified'], ['human', 'agent-proposed'], ['ratified', 'agent-proposed']];
    for (const [a, b] of ok) expect(validateWrite(at(a!), at(b!)), `${a}->${b}`).toEqual([]);
    for (const [a, b] of bad) expect(rules(validateWrite(at(a!), at(b!))), `${a}->${b}`).toEqual(['curated.transition']);
  });
  it('inbox.immutable protects body, note, and attachment; status and filed_as may change', () => {
    const prev = file(INBOX);
    expect(rules(validateWrite(prev, { ...prev, body: 'Retyped.\n' }))).toEqual(['inbox.immutable']);
    expect(rules(validateWrite(prev, file(INBOX, (t) => t.replace('note: From the 1976 essay. Attached the scan.', 'note: Changed'))))).toEqual(['inbox.immutable']);
    expect(rules(validateWrite(prev, file(INBOX, (t) => t.replace('attachment: 20260902-190433-p9r.pdf\n', ''))))).toEqual(['inbox.immutable']);
    const unfiled = file(INBOX, (t) => t.replace('status: filed\nfiled_as: didion-why-i-write\n', 'status: unfiled\n'));
    expect(validateWrite(unfiled, prev)).toEqual([]);
  });
  it('notes and principle bodies are free to change', () => {
    expect(validateWrite(file(NOTES), { ...file(NOTES), body: 'Rewritten.\n' })).toEqual([]);
    expect(validateWrite(file(PRINCIPLE), { ...file(PRINCIPLE), body: 'Rewritten.\n' })).toEqual([]);
  });
});

describe('validateBatch', () => {
  const batch = (writes: CommitBatch['writes'], deletes: string[] = []): CommitBatch => ({ message: 'x', expectedHead: 'head1', writes, deletes });
  const capture = '---\ntype: inbox\nstatus: unfiled\ncurated: human\ncreated: 2026-09-06T09:00:00Z\nupdated: 2026-09-06T09:00:00Z\n---\nNew.\n';

  it('a capture with an attachment passes', () => {
    expect(validateBatch(snapshot, batch([
      { path: 'inbox/20260906-090000-q2w.md', text: capture.replace('status:', 'attachment: 20260906-090000-q2w.png\nstatus:') },
      { path: 'inbox/20260906-090000-q2w.png', bytes: new Uint8Array([1, 2, 3]) },
    ]))).toEqual([]);
  });
  it('attachment.immutable for any write to an existing attachment path', () => {
    expect(rules(validateBatch(snapshot, batch([{ path: 'sources/didion-why-i-write/original.pdf', bytes: new Uint8Array([0]) }])))).toEqual(['attachment.immutable']);
    expect(rules(validateBatch(snapshot, batch([{ path: 'inbox/20260902-190433-p9r.pdf', text: 'x' }])))).toEqual(['attachment.immutable']);
  });
  it('write.kind, write.duplicate, write.delete-source', () => {
    expect(rules(validateBatch(snapshot, batch([{ path: 'inbox/20260906-090000-q2w.md', bytes: new Uint8Array([0]) }])))).toEqual(['write.kind']);
    expect(rules(validateBatch(snapshot, batch([{ path: 'inbox/20260906-090000-q2w.md', text: capture }, { path: 'inbox/20260906-090000-q2w.md', text: capture }])))).toEqual(['write.duplicate']);
    expect(rules(validateBatch(snapshot, batch([{ path: PRINCIPLE, text: fixture.get(PRINCIPLE)! }], [PRINCIPLE])))).toEqual(['write.duplicate']);
    expect(rules(validateBatch(snapshot, batch([], [RAW, NOTES])))).toEqual(['write.delete-source', 'write.delete-source']);
  });
  it('runs parse rules and per-write rules on text writes', () => {
    expect(rules(validateBatch(snapshot, batch([{ path: 'inbox/20260906-090000-q2w.md', text: 'no frontmatter' }])))).toEqual(['frontmatter.missing']);
    const edited = serializeFile({ ...snapshot.files.get(RAW)!, body: 'Tampered.\n' });
    expect(rules(validateBatch(snapshot, batch([{ path: RAW, text: edited }])))).toEqual(['raw.immutable']);
  });
});

describe('applyBatch', () => {
  it('produces the post-commit snapshot, which validateSnapshot can check', () => {
    const next = applyBatch(snapshot, {
      message: 'x', expectedHead: 'head1',
      writes: [
        { path: 'inbox/20260906-090000-q2w.md', text: '---\ntype: inbox\nattachment: 20260906-090000-q2w.png\nstatus: unfiled\ncurated: human\ncreated: 2026-09-06T09:00:00Z\nupdated: 2026-09-06T09:00:00Z\n---\nNew.\n' },
        { path: 'inbox/20260906-090000-q2w.png', bytes: new Uint8Array([1, 2, 3]) },
      ],
      deletes: ['principles/ps-7k2m/write-to-find-out.md', 'inbox/20260902-190433-p9r.pdf'],
    });
    expect(next.head).toBe('head1');
    expect(next.byType('inbox').length).toBe(5);
    expect(next.attachments.get('inbox/20260906-090000-q2w.png')!.size).toBe(3);
    expect(next.principlesOf('ps-7k2m').length).toBe(1);
    expect(validateSnapshot(next).map((i) => i.rule)).toEqual(['attachment.missing']);
    // the original snapshot is untouched
    expect(snapshot.byType('inbox').length).toBe(4);
    expect((snapshot.files.get(RAW)!.fm as SourceFm).title).toBe('Retire into thyself');
  });
});
