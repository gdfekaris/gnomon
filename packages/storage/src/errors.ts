// Typed driver errors (spec §14). Screens map each to a specific recovery.

export class StorageError extends Error {
  override name = 'StorageError';
}
export class AuthError extends StorageError { override name = 'AuthError'; }
export class HeadMovedError extends StorageError {
  override name = 'HeadMovedError';
  constructor(public readonly expected: string, public readonly actual: string) {
    super(`head moved: expected ${expected}, found ${actual}`);
  }
}
export class RevertConflictError extends StorageError {
  override name = 'RevertConflictError';
  constructor(public readonly paths: string[]) {
    super(`later commits touched: ${paths.join(', ')}`);
  }
}
export class RateLimitError extends StorageError { override name = 'RateLimitError'; }
export class NetworkError extends StorageError { override name = 'NetworkError'; }
export class AttachmentTooLargeError extends StorageError {
  override name = 'AttachmentTooLargeError';
  constructor(public readonly size: number, public readonly limit: number) {
    super(`attachment is ${size} bytes; the limit is ${limit}`);
  }
}
export class LockedError extends StorageError { override name = 'LockedError'; }

/** Attachments are capped before upload (spec §6.2). One constant, revisited with real usage (spec §20.7). */
export const ATTACHMENT_LIMIT_BYTES = 20 * 1024 * 1024;
