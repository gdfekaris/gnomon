import { describe, expect, it } from 'vitest';
import { ATTACHMENT_LIMIT_BYTES, AttachmentTooLargeError, HeadMovedError, StorageError } from '../src/index';

describe('storage errors (spec §14)', () => {
  it('are distinguishable by name and instance', () => {
    const e = new HeadMovedError('abc', 'def');
    expect(e).toBeInstanceOf(StorageError);
    expect(e.name).toBe('HeadMovedError');
    expect(e.message).toContain('abc');
  });
  it('reports the attachment limit', () => {
    const e = new AttachmentTooLargeError(ATTACHMENT_LIMIT_BYTES + 1, ATTACHMENT_LIMIT_BYTES);
    expect(e.limit).toBe(20 * 1024 * 1024);
  });
});
