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

test('the tag filter narrows the lists; chips carry counts; two tags combine', async ({ page }) => {
  await expect(page.getByTestId('tag-filter').getByRole('link', { name: 'stoicism 2', exact: true })).toBeVisible();
  await page.getByTestId('tag-filter').getByRole('link', { name: 'stoicism' }).click();
  await expect(page.getByTestId('sources').locator('li')).toHaveCount(2);
  await expect(page.getByTestId('browse-count')).toHaveText('2 of 4 sources');
  await page.getByTestId('tag-filter').getByRole('link', { name: 'work 1', exact: true }).click();
  await expect(page).toHaveURL(/tag=stoicism%2Cwork/);
  await expect(page.getByTestId('sources').locator('li')).toHaveCount(1);
  await expect(page.getByTestId('sources').locator('.title')).toHaveText('The work of a human being');
  await page.getByTestId('tag-filter').getByRole('link', { name: 'stoicism' }).click(); // toggles it off
  await expect(page.getByTestId('sources').locator('li')).toHaveCount(1);
  await expect(page).toHaveURL(/tag=work$/);
  await page.getByTestId('tag-filter').getByRole('link', { name: 'all', exact: true }).click();
  await expect(page.getByTestId('sources').locator('li')).toHaveCount(4);
  await expect(page.getByTestId('browse-count')).toHaveCount(0);
  await expect(page.getByTestId('all-tags')).toHaveCount(0); // six tags: nothing hidden
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
test('Browse lists sources newest first, oldest or by author on request, and nothing else', async ({ page }) => {
  // Newest first by default: `created` is when a source was filed. The author rides in the detail line.
  const titles = page.getByTestId('sources').locator('.title');
  await expect(page.getByTestId('sort-newest')).toHaveAttribute('aria-pressed', 'true');
  await expect(titles).toHaveText(['The work of a human being', 'Attention as generosity', "To find out what I'm thinking", 'Retire into thyself']);
  await expect(page.getByTestId('sources').locator('.detail').first()).toHaveText('Marcus Aurelius, Meditations (180) · awaiting review');
  await expect(page.locator('main h3')).toHaveText(['September 2026']); // a landmark per month
  await page.getByTestId('sort-oldest').click();
  await expect(titles).toHaveText(['Retire into thyself', "To find out what I'm thinking", 'Attention as generosity', 'The work of a human being']);
  // The choice is kept on the device.
  await page.reload();
  await expect(page.getByTestId('sort-oldest')).toHaveAttribute('aria-pressed', 'true');
  await expect(titles.first()).toHaveText('Retire into thyself');

  // Author: shelves, collapsed with counts; a tap opens one; works are sub-headings under an author with several.
  await page.getByTestId('sort-author').click();
  await expect(page.locator('main h3')).toHaveText(['Joan Didion · 1', 'Marcus Aurelius · 2', 'Simone Weil · 1']);
  await expect(page.getByTestId('sources').locator('li')).toHaveCount(0);
  await page.getByTestId('shelf-marcus-aurelius').click();
  await expect(page.getByTestId('shelf-marcus-aurelius')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('main h4')).toHaveText(['Meditations (180) · 2']);
  const aurelius = page.getByTestId('sources').locator('ul').first().locator('li');
  await expect(aurelius.locator('.title')).toHaveText(['Retire into thyself', 'The work of a human being']);
  await expect(aurelius.locator('.detail')).toHaveText(['Meditations (180)', 'Meditations (180) · awaiting review']);
  await page.getByTestId('shelf-joan-didion').click();
  await expect(page.getByTestId('sources').locator('.detail').first()).toHaveText('Why I Write (1976) · attachment');
  await expect(page.locator('main h4')).toHaveCount(1); // one source: no work sub-heading
  await expect(page.getByTestId('nudge')).toHaveCount(0);
  await expect(page.getByTestId('inbox')).toHaveCount(0);
  await expect(page.getByTestId('proposals')).toHaveCount(0);
  await expect(page.getByText('Set 1', { exact: true })).toHaveCount(0);
  // a filter opens every shelf that has a match
  await page.getByTestId('tag-filter').getByRole('link', { name: 'stoicism' }).click();
  await expect(page.locator('main h3')).toHaveText(['Marcus Aurelius · 2']);
  await expect(page.getByTestId('sources').locator('li')).toHaveCount(2);
});

// Search over what you remember of a source: title, author, work, tags, slug, year; never the passage text.
test('search narrows as you type, ignores accents, and survives a trip into a file and back', async ({ page }) => {
  await page.goto('/#/settings?demo-fill=1');
  await page.getByTestId('use-demo').click();
  await expect(page.getByText('Connected: demo brain')).toBeVisible();
  await page.goto('/#/browse');
  await expect(page.getByTestId('browse-count')).toHaveCount(0);
  await page.getByTestId('browse-search').fill('emile');
  await expect(page.getByTestId('browse-count')).toHaveText('1 of 8 sources');
  await expect(page.getByTestId('sources').locator('.detail').first()).toContainText('Émile Zola');
  await expect(page).toHaveURL(/#\/browse\?q=emile$/);
  await page.getByTestId('sources').locator('.title').first().click();
  await expect(page.getByTestId('frontmatter')).toBeVisible();
  await page.getByTestId('back-to-browse').click();
  await expect(page.getByTestId('browse-search')).toHaveValue('emile');
  await expect(page.getByTestId('browse-count')).toHaveText('1 of 8 sources');
  await page.getByTestId('browse-search').fill('medit stoic');
  await expect(page.getByTestId('browse-count')).toHaveText('2 of 8 sources');
  await page.getByTestId('browse-search').fill('the passage text is not searched');
  await expect(page.getByTestId('no-sources')).toContainText('No source matches');
  await page.getByTestId('browse-clear').click();
  await expect(page.getByTestId('browse-search')).toHaveValue('');
  await expect(page.getByTestId('browse-count')).toHaveCount(0);
  await expect(page.getByTestId('sources').locator('li')).toHaveCount(8);
});

// Hundreds of sources: twelve tags in view with the rest behind "All tags", fifty rows a page, and shelves that
// open by themselves under a search.
test('a brain of three hundred sources shows twelve tags, pages by fifty, and shelves open under a search', async ({ page }) => {
  await page.goto('/#/settings?demo-fill=75');
  await page.getByTestId('use-demo').click();
  await expect(page.getByText('Connected: demo brain')).toBeVisible();
  await page.goto('/#/browse');
  await expect(page.getByTestId('tag-filter').getByRole('link')).toHaveCount(13); // all + twelve
  await page.getByTestId('all-tags').click();
  await expect(page.getByTestId('tag-filter').getByRole('link')).toHaveCount(31); // all + thirty
  await page.getByTestId('all-tags').click();
  await expect(page.getByTestId('tag-filter').getByRole('link')).toHaveCount(13);
  await page.getByTestId('sort-newest').click();
  await expect(page.getByTestId('sources').locator('li')).toHaveCount(50);
  await expect(page.getByTestId('show-more')).toHaveText('Show 50 more (204 left)');
  await page.getByTestId('show-more').click();
  await expect(page.getByTestId('sources').locator('li')).toHaveCount(100);
  await expect(page.locator('main h3').first()).toHaveText(/\w+ 2026/);
  await page.getByTestId('sort-author').click();
  await expect(page.getByTestId('sources').locator('li')).toHaveCount(0); // every shelf collapsed
  await expect(page.locator('main h3').first()).toContainText('Annie Dillard · 25');
  await page.getByTestId('browse-search').fill('woolf');
  await expect(page.getByTestId('browse-count')).toHaveText('25 of 304 sources');
  await expect(page.locator('main h3')).toHaveText(['Virginia Woolf · 25']);
  await expect(page.locator('main h4')).toHaveCount(2); // her two works
  await expect(page.getByTestId('sources').locator('li')).toHaveCount(25);
  await expect(page.getByTestId('show-more')).toHaveCount(0);
});

// The file page speaks the app's words; the files keep the schema's. A capture says not filed or filed as,
// with the link; a source says filed from, with the link back; curated reads yours, ratified, or awaiting review.
test('the file page translates curation and filing state, with links both ways', async ({ page }) => {
  await page.goto('/#/browse/inbox/20260906-070000-2bq.md');
  await expect(page.getByTestId('fm-status')).toHaveText('not filed');
  await expect(page.getByTestId('fm-curated')).toHaveText('yours');
  await page.goto('/#/browse/inbox/20260905-143012-x7q.md');
  await expect(page.getByTestId('fm-status')).toHaveText('filed as aurelius-meditations-5-1');
  await expect(page.getByTestId('frontmatter')).not.toContainText('filed_as');
  await page.getByTestId('fm-status').getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'The work of a human being' })).toBeVisible();
  await expect(page.getByTestId('fm-curated')).toHaveText('awaiting review');
  await expect(page.getByTestId('fm-filed-from')).toHaveText('20260905-143012-x7q');
  await page.getByTestId('fm-filed-from').getByRole('link').click();
  await expect(page.getByTestId('fm-status')).toHaveText('filed as aurelius-meditations-5-1');
  await page.goto('/#/browse/sources/aurelius-meditations-4-3/raw.md');
  await expect(page.getByTestId('fm-curated')).toHaveText('ratified');
  await page.goto('/#/browse/maps/proposals/P-20260905-001.md');
  await expect(page.getByTestId('fm-curated')).toHaveText("the model's");
  await expect(page.getByTestId('frontmatter')).toContainText('open'); // a proposal's status is its own lifecycle
});
