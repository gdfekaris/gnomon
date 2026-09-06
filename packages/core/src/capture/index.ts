// capture — schema §3.4, §4.6, §7.5. One capture is one commit: the pasted
// text as `inbox/<stem>.md`, an optional note, and an optional attached
// file beside it. Captures never touch the index files.

import type { CommitBatch, FileWrite, InboxFm } from '../schema/types';
import { randomAlphabet } from '../schema/identifiers';
import { serializeFile } from '../schema/serialize';

/** `<YYYYMMDD>-<HHMMSS>-<3 alphabet chars>`, UTC, redrawn while it collides with `existing`. */
export function newInboxStem(nowUtc: string, existing: Iterable<string> = [], random?: (n: number) => Uint8Array): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(nowUtc);
  if (!m) throw new Error(`newInboxStem needs an ISO 8601 UTC datetime, not '${nowUtc}'`);
  const prefix = `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}${m[6]}-`;
  const taken = new Set(existing);
  for (;;) {
    const stem = prefix + randomAlphabet(3, random);
    if (!taken.has(stem)) return stem;
  }
}

/** The lowercase extension for an attachment filename; `bin` when it has none. */
export function attachmentExtension(filename: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(filename);
  return m ? m[1]!.toLowerCase() : 'bin';
}

export interface CaptureParams {
  /** the pasted text, exactly as pasted */
  body: string;
  note?: string;
  attachment?: { filename: string; bytes: Uint8Array };
  /** ISO 8601 UTC datetime; also the capture's created/updated */
  now: string;
  expectedHead: string;
  /** stems already in the inbox, so the new one cannot collide */
  existingStems?: Iterable<string>;
  random?: (n: number) => Uint8Array;
}

/** Schema §7.5: one `Capture: <stem>` commit. Refuses an empty capture. */
export function buildCapture(p: CaptureParams): { batch: CommitBatch; stem: string; path: string } {
  if (p.body.trim() === '') throw new Error('a capture needs some text');
  const stem = newInboxStem(p.now, p.existingStems ?? [], p.random);
  const path = `inbox/${stem}.md`;
  const fm: InboxFm = { type: 'inbox', status: 'unfiled', curated: 'human', created: p.now, updated: p.now };
  if (p.note !== undefined && p.note.trim() !== '') fm.note = p.note.trim();
  const writes: FileWrite[] = [];
  if (p.attachment) {
    fm.attachment = `${stem}.${attachmentExtension(p.attachment.filename)}`;
    writes.push({ path: `inbox/${fm.attachment}`, bytes: p.attachment.bytes });
  }
  writes.unshift({ path, text: serializeFile({ path, sha: '', fm, body: p.body, encrypted: false }) });
  return { batch: { message: `Capture: ${stem}`, expectedHead: p.expectedHead, writes, deletes: [] }, stem, path };
}
