// Serve the storage package's fake GitHub to the browser: the real
// GitHubDriver runs in the page, Playwright intercepts api.github.com, and
// the fake answers from Node with the same shapes and status codes the
// contract suite trusts. CORS headers are needed because the page really
// does a cross-origin fetch with custom headers.
import type { Page } from '@playwright/test';
import { FakeGitHub } from '../../storage/test/fake-github';

export { FakeGitHub };
export { readBrainBytes } from '../../storage/test/fixture';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
  'access-control-expose-headers': '*',
};

export async function serveGitHub(page: Page, gh: FakeGitHub): Promise<void> {
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const init: RequestInit = { method: req.method(), headers: req.headers() };
    const body = req.postData();
    if (body !== null) init.body = body;
    const res = await gh.fetch(req.url(), init);
    const headers: Record<string, string> = { ...cors };
    res.headers.forEach((v, k) => { headers[k] = v; });
    return route.fulfill({ status: res.status, headers, body: await res.text() });
  });
}
