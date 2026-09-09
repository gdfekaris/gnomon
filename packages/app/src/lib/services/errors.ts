// One sentence per failure (spec §14, US-14). Every screen and service routes
// a caught error through here, so a non-technical user reads what happened
// and what to do, never a stack of internals. Framework-free.

import { DecryptError, FilingReplyError, ValidationError } from '@gnomon/core';
import { ProviderAuthError, ProviderError, ProviderNetworkError, ProviderRateLimitError, ProviderUnavailableError } from '@gnomon/providers';
import { AttachmentTooLargeError, AuthError, HeadMovedError, LockedError, NetworkError, NotFoundError, RateLimitError, RevertConflictError } from '@gnomon/storage';

const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);

export function describeError(e: unknown): string {
  // the brain
  if (e instanceof ValidationError) return `The change was refused: ${e.issues.map((i) => i.message).join('; ')}.`;
  if (e instanceof HeadMovedError) return 'Your repository changed since this screen loaded. Refresh and try again.';
  if (e instanceof RevertConflictError) return `Later changes touched ${e.paths.join(', ')}, so this cannot be undone automatically.`;
  if (e instanceof AttachmentTooLargeError) return `That file is ${mb(e.size)} MB; the limit is ${mb(e.limit)} MB. Remove or replace the file.`;
  if (e instanceof LockedError) return 'This brain is encrypted and locked on this device. Unlock it in Settings.';
  if (e instanceof DecryptError) return 'That passphrase does not unlock this brain.';
  // GitHub
  if (e instanceof AuthError) return 'GitHub rejected the token. Check it in Settings: it must be a fine-grained token with Contents read and write on this repository, and not expired.';
  if (e instanceof NotFoundError) return `GitHub has nothing at ${e.path}. The repository may have moved, or the token cannot see it.`;
  if (e instanceof RateLimitError) return 'GitHub rate limit reached. Try again in a while.';
  if (e instanceof NetworkError) return 'Could not reach GitHub. Check the connection.';
  // the AI provider
  if (e instanceof ProviderAuthError) return 'The AI provider rejected the API key. Check it in Settings.';
  if (e instanceof ProviderRateLimitError) return `The AI provider asked us to slow down. Try again in ${e.retryAfterSeconds ? `${e.retryAfterSeconds} seconds` : 'a moment'}.`;
  if (e instanceof ProviderUnavailableError) return 'The AI provider is having trouble right now. Try again in a minute.';
  if (e instanceof ProviderNetworkError) return 'Could not reach the AI provider. Check the connection.';
  if (e instanceof ProviderError) return `The AI provider returned an error: ${e.message}`;
  if (e instanceof FilingReplyError) return `The model's reply could not be used: ${e.message}. Try again, or pick another model.`;
  // the rest
  if ((e as Error)?.name === 'AbortError') return 'Stopped.';
  const message = (e as Error)?.message;
  return message ? message : 'Something went wrong. Try again.';
}
