// Typed provider errors (spec §14). Named with a Provider prefix so the app
// can import them beside the storage errors without aliasing.

export class ProviderError extends Error {
  override name = 'ProviderError';
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}
/** 401 or 403: the key is wrong, revoked, or lacks access to the model. */
export class ProviderAuthError extends ProviderError { override name = 'ProviderAuthError'; }
/** 429: slow down; `retryAfterSeconds` when the server said. */
export class ProviderRateLimitError extends ProviderError {
  override name = 'ProviderRateLimitError';
  constructor(message: string, public readonly retryAfterSeconds?: number) {
    super(message, 429);
  }
}
/** 500 or 529: the provider is overloaded or failing; retry later. */
export class ProviderUnavailableError extends ProviderError { override name = 'ProviderUnavailableError'; }
/** fetch itself failed: offline, DNS, CORS. */
export class ProviderNetworkError extends ProviderError { override name = 'ProviderNetworkError'; }
