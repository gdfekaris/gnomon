import { expect, test } from '@playwright/test';

// Runs against the production preview (spec §11): manifest, icons, and a
// registered service worker that precaches the shell and nothing else.
test('the built app serves a manifest with icons and registers a service worker', async ({ page }) => {
  await page.goto('/');
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBeTruthy();
  const manifest = await (await page.request.get(new URL(manifestHref!, page.url()).href)).json();
  expect(manifest.name).toBe('Gnomon');
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toContain('#/capture');
  expect(manifest.icons.map((i: { sizes: string; purpose?: string }) => [i.sizes, i.purpose ?? 'any'])).toEqual([['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']]);
  for (const icon of manifest.icons as { src: string }[]) {
    expect((await page.request.get(new URL(icon.src, page.url()).href)).status()).toBe(200);
  }
  expect(await page.locator('link[rel="apple-touch-icon"]').getAttribute('href')).toBe('/icons/apple-touch-icon.png');
  expect(await page.locator('meta[name="theme-color"]').getAttribute('content')).toBe('#1c1917');

  const registered = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return { scope: reg.scope, hasWorker: reg.active !== null || reg.installing !== null || reg.waiting !== null };
  });
  expect(registered.hasWorker).toBe(true);
  expect(registered.scope).toBe('http://localhost:4173/');

  const sw = await (await page.request.get('/sw.js')).text();
  expect(sw).toContain('precacheAndRoute');
  expect(sw).not.toContain('api.github.com');
  // The only route is the navigation fallback to index.html (spec §11); nothing else is runtime-cached.
  expect(sw.match(/registerRoute\(/g)).toHaveLength(1);
  expect(sw).toMatch(/registerRoute\(new \w+\.NavigationRoute\(/);
});
