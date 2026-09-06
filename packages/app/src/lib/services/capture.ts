// The capture path (spec §10.4, US-1): build the capture, refuse an
// oversized attachment before any upload, commit once, and on a moved head
// refresh and retry once. A capture cannot conflict with anything.

import { buildCapture, nowUtc } from '@gnomon/core';
import { ATTACHMENT_LIMIT_BYTES, AttachmentTooLargeError, HeadMovedError } from '@gnomon/storage';
import type { BrainService } from './brain';

export interface CaptureInput {
  text: string;
  note?: string;
  attachment?: { filename: string; bytes: Uint8Array };
  /** injectable clock and randomness for tests */
  now?: () => string;
  random?: (n: number) => Uint8Array;
}

export interface CaptureResult { stem: string; path: string; sha: string; attachment?: string; }

export async function captureToInbox(brain: BrainService, input: CaptureInput): Promise<CaptureResult> {
  if (input.attachment && input.attachment.bytes.length > ATTACHMENT_LIMIT_BYTES) {
    throw new AttachmentTooLargeError(input.attachment.bytes.length, ATTACHMENT_LIMIT_BYTES);
  }
  if (!brain.connected) throw new Error('no brain is connected');
  if (brain.head === null) await brain.refresh();

  const attempt = () => {
    const snapshot = brain.snapshot!;
    const params = {
      body: input.text,
      now: (input.now ?? nowUtc)(),
      expectedHead: snapshot.head,
      existingStems: snapshot.byType('inbox').map((f) => f.path.slice('inbox/'.length, -3)),
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.attachment ? { attachment: input.attachment } : {}),
      ...(input.random ? { random: input.random } : {}),
    };
    return buildCapture(params);
  };

  let built = attempt();
  let sha: string;
  try {
    ({ sha } = await brain.commit(built.batch));
  } catch (e) {
    if (!(e instanceof HeadMovedError)) throw e;
    await brain.refresh();
    built = attempt();
    ({ sha } = await brain.commit(built.batch));
  }
  const attachmentPath = built.batch.writes.find((w) => 'bytes' in w)?.path;
  return { stem: built.stem, path: built.path, sha, ...(attachmentPath ? { attachment: attachmentPath } : {}) };
}
