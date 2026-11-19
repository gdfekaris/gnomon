// Serve the storage package's fake GitHub to the browser: the real
// GitHubDriver runs in the page, Playwright intercepts api.github.com, and
// the fake answers from Node with the same shapes and status codes the
// contract suite trusts. CORS headers are needed because the page really
// does a cross-origin fetch with custom headers.
import type { Page } from '@playwright/test';
import { FakeGitHub, readBrainBytes } from '@gnomon/storage/testing';

export { FakeGitHub, readBrainBytes };

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
  'access-control-expose-headers': '*',
};

export interface Bridge {
  /** added to every answer; a slow connection for loading-state checks */
  latencyMs: number;
  /** every request fails as a dropped connection does: GitHub cannot be reached, though the app itself still loads */
  down: boolean;
  /** every request is answered 401, as GitHub answers an expired or revoked token */
  rejectToken: boolean;
}

export async function serveGitHub(page: Page, gh: FakeGitHub): Promise<Bridge> {
  const bridge: Bridge = { latencyMs: 0, down: false, rejectToken: false };
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    if (bridge.down) return route.abort('internetdisconnected');
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (bridge.rejectToken) return route.fulfill({ status: 401, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Bad credentials' }) });
    if (bridge.latencyMs) await new Promise((r) => setTimeout(r, bridge.latencyMs));
    const init: RequestInit = { method: req.method(), headers: req.headers() };
    const body = req.postData();
    if (body !== null) init.body = body;
    const res = await gh.fetch(req.url(), init);
    const headers: Record<string, string> = { ...cors };
    res.headers.forEach((v, k) => { headers[k] = v; });
    return route.fulfill({ status: res.status, headers, body: await res.text() });
  });
  return bridge;
}
