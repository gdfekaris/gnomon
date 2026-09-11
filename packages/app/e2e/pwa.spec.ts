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

// The demo brain must load from the production bundle, where Vite inlines
// its small PDF as a data: URL that the CSP's connect-src would refuse to
// fetch; the loader decodes it instead. Only the built app shows this.
test('the demo brain loads from the built app, its PDF attachment included', async ({ page }) => {
  const failures: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') failures.push(m.text()); });
  await page.goto('/');
  await page.getByTestId('onboard-demo').click();
  await expect(page.getByRole('heading', { name: 'Capture' })).toBeVisible();
  await page.goto('/#/browse');
  await page.getByRole('link', { name: "To find out what I'm thinking" }).click();
  await page.getByTestId('attachment-link').click();
  await expect(page.getByTestId('attachment-open')).toBeVisible();
  expect(failures.filter((f) => /Content Security Policy|Load failed|Failed to fetch/.test(f))).toEqual([]);
});

// The maintainer pressed "Check for updates" on a current build and nothing answered. Every check ends
// in a sentence; on the built app with its worker registered and unchanged, that sentence is "no update".
test('checking for updates on a current build says so', async ({ page }) => {
  await page.goto('/#/settings');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.getByTestId('check-update').click();
  await expect(page.getByTestId('update-status')).toHaveText('No update: this is the latest build.');
});
