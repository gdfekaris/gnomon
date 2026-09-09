import { describe, expect, it } from 'vitest';
import { FilingReplyError, ValidationError, refusal } from '@gnomon/core';
import { ProviderAuthError, ProviderError, ProviderNetworkError, ProviderRateLimitError, ProviderUnavailableError } from '@gnomon/providers';
import { AttachmentTooLargeError, AuthError, HeadMovedError, LockedError, NetworkError, NotFoundError, RateLimitError, RevertConflictError } from '@gnomon/storage';
import { describeError } from '../src/lib/services/errors';

describe('describeError (spec §14): one plain sentence per failure', () => {
  const cases: Array<[unknown, RegExp]> = [
    [new ValidationError([refusal('inbox/a.md', 'field.required', "field 'created' is required")]), /^The change was refused: field 'created' is required\.$/],
    [new HeadMovedError('a', 'b'), /changed since this screen loaded\. Refresh/],
    [new RevertConflictError(['sources/x/raw.md']), /touched sources\/x\/raw\.md/],
    [new AttachmentTooLargeError(25 * 1024 * 1024, 20 * 1024 * 1024), /25\.0 MB; the limit is 20\.0 MB/],
    [new LockedError('locked'), /encrypted and locked/],
    [new AuthError('401'), /GitHub rejected the token.*Contents read and write/],
    [new NotFoundError('/repos/o/n'), /nothing at \/repos\/o\/n/],
    [new RateLimitError('x'), /GitHub rate limit/],
    [new NetworkError('x'), /Could not reach GitHub/],
    [new ProviderAuthError('401', 401), /rejected the API key/],
    [new ProviderRateLimitError('429', 30), /Try again in 30 seconds/],
    [new ProviderRateLimitError('429'), /Try again in a moment/],
    [new ProviderUnavailableError('529', 529), /having trouble/],
    [new ProviderNetworkError('fetch failed'), /Could not reach the AI provider/],
    [new ProviderError('bad request', 400), /returned an error: bad request/],
    [new FilingReplyError('no title'), /reply could not be used: no title\./],
    [Object.assign(new Error('aborted'), { name: 'AbortError' }), /^Stopped\.$/],
    [new Error('something specific'), /^something specific$/],
    [new Error(''), /Something went wrong/],
    [undefined, /Something went wrong/],
  ];
  for (const [e, re] of cases) {
    it(`${(e as Error)?.name ?? String(e)} → ${re}`, () => {
      expect(describeError(e)).toMatch(re);
    });
  }
});
