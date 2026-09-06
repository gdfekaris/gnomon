import { describe, expect, it } from 'vitest';
import type { InboxFm } from '../src/index';
import { applyBatch, attachmentExtension, buildCapture, isInboxStem, newInboxStem, parseFile, validateBatch, validateSnapshot } from '../src/index';
import { FIXTURE, snapshotFromDisk } from './brains';

const s = snapshotFromDisk(FIXTURE, 'head1');
const NOW = '2026-09-06T14:30:12Z';
const fixed = (n: number) => new Uint8Array(n).fill(0); // always draws '2'

describe('newInboxStem (schema §3.4)', () => {
  it('is the UTC timestamp plus three alphabet characters', () => {
    const stem = newInboxStem(NOW);
    expect(stem.startsWith('20260906-143012-')).toBe(true);
    expect(isInboxStem(stem)).toBe(true);
    expect(newInboxStem('2026-09-06T14:30:12.123Z', [], fixed)).toBe('20260906-143012-222');
  });
  it('redraws on collision and rejects a non-datetime', () => {
    let calls = 0;
    const random = (n: number) => new Uint8Array(n).fill(calls++ === 0 ? 0 : 1);
    expect(newInboxStem(NOW, ['20260906-143012-222'], random)).toBe('20260906-143012-333');
    expect(() => newInboxStem('2026-09-06')).toThrow(/datetime/);
  });
  it('attachmentExtension lowercases and falls back to bin', () => {
    expect(attachmentExtension('Scan.PDF')).toBe('pdf');
    expect(attachmentExtension('photo.jpeg')).toBe('jpeg');
    expect(attachmentExtension('archive.tar.gz')).toBe('gz');
    expect(attachmentExtension('noext')).toBe('bin');
  });
});

describe('buildCapture (schema §7.5)', () => {
  it('writes the capture file only, with the note trimmed and nothing else', () => {
    const { batch, stem, path } = buildCapture({ body: 'Pasted text.\n', note: '  from the train  ', now: NOW, expectedHead: 'head1', random: fixed });
    expect(stem).toBe('20260906-143012-222');
    expect(path).toBe('inbox/20260906-143012-222.md');
    expect(batch.message).toBe('Capture: 20260906-143012-222');
    expect(batch.expectedHead).toBe('head1');
    expect(batch.deletes).toEqual([]);
    expect(batch.writes).toEqual([{ path, text: '---\ntype: inbox\nnote: from the train\nstatus: unfiled\ncurated: human\ncreated: 2026-09-06T14:30:12Z\nupdated: 2026-09-06T14:30:12Z\n---\nPasted text.\n' }]);
    expect(validateBatch(s, batch)).toEqual([]);
    expect(validateSnapshot(applyBatch(s, batch))).toEqual([]);
  });
  it('carries an attachment beside the capture and declares it', () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const { batch, path } = buildCapture({ body: 'With a scan.', attachment: { filename: 'Scan.PDF', bytes }, now: NOW, expectedHead: 'head1', random: fixed });
    expect(batch.writes.map((w) => w.path)).toEqual([path, 'inbox/20260906-143012-222.pdf']);
    const w = batch.writes[1]!;
    expect('bytes' in w && w.bytes).toBe(bytes);
    const fm = parseFile(path, (batch.writes[0] as { text: string }).text).fm as InboxFm;
    expect(fm.attachment).toBe('20260906-143012-222.pdf');
    expect(fm.note).toBeUndefined();
    expect(validateBatch(s, batch)).toEqual([]);
    const after = applyBatch(s, batch);
    expect(validateSnapshot(after)).toEqual([]);
    expect(after.attachments.get('inbox/20260906-143012-222.pdf')!.size).toBe(4);
  });
  it('avoids existing stems, keeps the body verbatim, and refuses empty text', () => {
    const existing = s.byType('inbox').map((f) => f.path.slice(6, -3));
    let calls = 0;
    const random = (n: number) => new Uint8Array(n).fill(calls++ === 0 ? 0 : 1);
    const { stem } = buildCapture({ body: 'x', now: '2026-09-06T07:00:00Z', expectedHead: 'h', existingStems: [...existing, '20260906-070000-222'], random });
    expect(stem).toBe('20260906-070000-333');
    const body = '  leading spaces\n\nand "quotes"\n\n\n';
    const { batch, path } = buildCapture({ body, now: NOW, expectedHead: 'h' });
    expect(parseFile(path, (batch.writes[0] as { text: string }).text).body).toBe('  leading spaces\n\nand "quotes"\n');
    expect(() => buildCapture({ body: '   \n', now: NOW, expectedHead: 'h' })).toThrow(/needs some text/);
  });
});
