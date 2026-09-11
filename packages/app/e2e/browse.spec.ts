import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByTestId('use-demo').click();
  await expect(page.getByText('Connected: demo brain')).toBeVisible();
  await page.goto('/#/browse');
});

test('a principle shows one anchor per dual link, and backlinks', async ({ page }) => {
  await page.goto('/#/browse/principles/ps-g8xw/courage-before-comfort.md');
  await expect(page.getByRole('heading', { name: 'Courage before comfort' })).toBeVisible();
  await expect(page.getByTestId('frontmatter')).toContainText('order');
  const body = page.getByTestId('file-body');
  await expect(body).toContainText('Grounding passages:');
  await expect(body.locator('strong')).toHaveText('Grounding passages:');
  const links = body.locator('a');
  await expect(links).toHaveCount(1);
  await expect(links).toHaveAttribute('href', '#/browse/sources/aurelius-meditations-4-3/raw.md');
  await expect(body).not.toContainText('[[');
  await expect(page.getByTestId('backlinks')).toContainText('Say the hard thing first');

  await links.click();
  await expect(page.getByRole('heading', { name: 'Retire into thyself' })).toBeVisible();
  await expect(page.getByTestId('file-body')).toContainText('Men seek retreats for themselves');
  await expect(page.getByTestId('backlinks')).toContainText('Courage before comfort');
  await expect(page.getByTestId('backlinks')).toContainText('Say the hard thing first');
});

test('a heading anchor in a link lands on the heading', async ({ page }) => {
  await page.goto('/#/browse/sources/aurelius-meditations-4-3/notes.md');
  await expect(page.getByTestId('file-body').locator('a')).toHaveAttribute('href', '#/browse/sources/aurelius-meditations-5-1/raw.md');
  await page.goto('/#/browse/sources/fekaris/raw.md#nope');
  await expect(page.getByText('No file at')).toBeVisible();
});

test('the tag filter narrows the lists', async ({ page }) => {
  await page.getByTestId('tag-filter').getByRole('link', { name: 'stoicism' }).click();
  await expect(page.getByTestId('sources').locator('li')).toHaveCount(2);
  await page.getByTestId('tag-filter').getByRole('link', { name: 'all' }).click();
  await expect(page.getByTestId('sources').locator('li')).toHaveCount(4);
});

test('a PDF attachment opens in a new tab from a blob URL', async ({ page }) => {
  await page.getByRole('link', { name: "To find out what I'm thinking" }).click();
  await page.getByTestId('attachment-link').click();
  await expect(page.getByTestId('attachment-open')).toBeVisible();
  // Headless Chromium has no PDF viewer, so observe the window.open call rather than the tab.
  await page.evaluate(() => {
    const w = window as unknown as { opened: unknown[]; open: (...a: unknown[]) => null };
    w.opened = [];
    w.open = (...args: unknown[]) => { w.opened.push(args); return null; };
  });
  await page.getByTestId('attachment-open').click();
  const opened = await page.evaluate(() => (window as unknown as { opened: [string, string, string][] }).opened);
  expect(opened).toHaveLength(1);
  expect(opened[0]![0]).toMatch(/^blob:/);
  expect(opened[0]![1]).toBe('_blank');
  expect(opened[0]![2]).toBe('noopener');
});

test('an image attachment previews inline and an HTML attachment is shown as source, never rendered', async ({ page }) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  await page.goto('/#/capture');
  await page.getByTestId('capture-text').fill('A photo.');
  await page.getByTestId('capture-file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
  await page.getByTestId('capture-save').click();
  const stem = (await page.getByTestId('saved').locator('code').textContent())!;
  await page.goto(`/#/browse/inbox/${stem}.png`);
  const img = page.getByTestId('attachment-image');
  await expect(img).toBeVisible();
  expect(await img.getAttribute('src')).toMatch(/^blob:/);
  expect(await img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1);

  await page.goto('/#/capture');
  await page.getByTestId('capture-text').fill('A saved page.');
  await page.getByTestId('capture-file').setInputFiles({ name: 'page.html', mimeType: 'text/html', buffer: Buffer.from('<script>window.pwned = true</script><h1>Hi</h1>') });
  await page.getByTestId('capture-save').click();
  const stem2 = (await page.getByTestId('saved').locator('code').textContent())!;
  await page.goto(`/#/browse/inbox/${stem2}.html`);
  await expect(page.getByTestId('attachment-source')).toContainText('<script>window.pwned = true</script>');
  expect(await page.evaluate(() => (window as unknown as { pwned?: boolean }).pwned)).toBeUndefined();
  await expect(page.locator('h1', { hasText: 'Hi' })).toHaveCount(0);
});

// Browse is for reading what was collected (maintainer, 2026-09-11): sources by author, work, and title,
// with the tag filter. Sets, captures, and proposals have their own screens; the nudge lives on Capture.
test('Browse lists sources by author and nothing else', async ({ page }) => {
  await expect(page.locator('main h3')).toHaveText(['Joan Didion', 'Marcus Aurelius', 'Simone Weil']);
  const aurelius = page.getByTestId('sources').locator('ul').nth(1).locator('li');
  await expect(aurelius.locator('.title')).toHaveText(['Retire into thyself', 'The work of a human being']);
  await expect(aurelius.locator('.detail')).toHaveText(['Meditations (180)', 'Meditations (180) · agent-proposed']);
  await expect(page.getByTestId('sources').locator('.detail').first()).toHaveText('Why I Write (1976) · attachment');
  await expect(page.getByTestId('nudge')).toHaveCount(0);
  await expect(page.getByTestId('inbox')).toHaveCount(0);
  await expect(page.getByTestId('proposals')).toHaveCount(0);
  await expect(page.getByText('Set 1', { exact: true })).toHaveCount(0);
  await page.getByTestId('tag-filter').getByRole('link', { name: 'stoicism' }).click();
  await expect(page.locator('main h3')).toHaveText(['Marcus Aurelius']);
});
