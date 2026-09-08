// Shared request plumbing for the two HTTP providers.
import { ProviderAuthError, ProviderError, ProviderNetworkError, ProviderRateLimitError, ProviderUnavailableError } from './errors';

export type Fetch = typeof fetch;

/** fetch, but every failure is a typed ProviderError. Returns the Response for 2xx. */
export async function providerFetch(fetchFn: Fetch, url: string, init: RequestInit, who: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetchFn(url, init);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ProviderNetworkError(`${who}: ${(e as Error).message}`);
  }
  if (res.ok) return res;
  let message = `${who} returned ${res.status}`;
  try {
    const body = (await res.json()) as { error?: { message?: string; type?: string }; message?: string };
    message = body.error?.message ?? body.message ?? message;
  } catch {
    /* not json */
  }
  if (res.status === 401 || res.status === 403) throw new ProviderAuthError(message, res.status);
  if (res.status === 429) {
    const retry = Number(res.headers.get('retry-after'));
    throw new ProviderRateLimitError(message, Number.isFinite(retry) && retry > 0 ? retry : undefined);
  }
  if (res.status >= 500) throw new ProviderUnavailableError(message, res.status);
  throw new ProviderError(message, res.status);
}

/** The default fetch, called unbound: browsers reject window.fetch invoked with another `this`. */
export const boundFetch: Fetch = (input, init) => fetch(input, init);
