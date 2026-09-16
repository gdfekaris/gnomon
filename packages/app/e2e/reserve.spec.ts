import { expect, test } from '@playwright/test';

// The reserve (schema §7.14): principles held but not in force. The Sets screen is the view of every
// principle; its last section lists the reserve, newest first, searchable and paged, and moving a
// principle in or out is one tap that makes two commits.

test.beforeEach(async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByTestId('use-demo').click();
  await expect(page.getByText('Connected: demo brain')).toBeVisible();
  await page.goto('/#/sets');
});
// Sets and the reserve start collapsed; a tap on the heading opens one for the session.
const openSet = (page: import('@playwright/test').Page, id: string) => page.getByTestId(id).getByTestId('set-toggle').click();

test('the fixture\'s reserved principle shows on arrival, with its tag and no order', async ({ page }) => {
  const reserve = page.getByTestId('reserve');
  await expect(reserve.getByTestId('reserve-total')).toHaveText('· 1');
  await openSet(page, 'reserve');
  const row = reserve.getByTestId('reserve-one-thing-at-a-time');
  await expect(row).toContainText('One thing at a time');
  await expect(row).toContainText('attention');
  await expect(row.locator('.num')).toHaveCount(0);
  await expect(reserve.getByTestId('reserve-sort-newest')).toHaveCount(0); // one row needs no sort
  await expect(reserve.getByTestId('reserve-count')).toHaveCount(0);
  await expect(reserve.getByTestId('reserve-tag-attention')).toContainText('attention');
  await row.locator('a').first().click();
  await expect(page.getByTestId('fm-set')).toContainText('in reserve');
  await expect(page.getByTestId('frontmatter')).not.toContainText('order');
});

test('keep a set\'s principle in reserve instead of deleting it, then add the reserved one to another set', async ({ page }) => {
  // Reserve, from the Delete confirmation: the set renumbers and the reserve holds it first.
  const set1 = page.getByTestId('set-ps-g8xw');
  await openSet(page, 'set-ps-g8xw');
  await openSet(page, 'set-ps-7k2m');
  await openSet(page, 'reserve');
  await set1.getByTestId('principles-ps-g8xw').locator('li').first().getByTestId('principle-delete').click();
  const confirm = page.getByTestId('delete-confirm');
  await expect(confirm).toContainText('Delete the principle Courage before comfort?');
  await expect(confirm).toContainText('Or keep it in reserve');
  await expect(confirm.getByTestId('dangling')).toContainText('principles/ps-7k2m/say-the-hard-thing-first.md → ps-g8xw/courage-before-comfort');
  await confirm.getByTestId('reserve-instead').click();
  await expect(page.getByTestId('moved')).toContainText('Kept in reserve: Courage before comfort. It left Set 1.');
  await expect(page.getByTestId('moved')).toContainText('principles/ps-7k2m/say-the-hard-thing-first.md');
  await expect(set1.getByTestId('principles-ps-g8xw').locator('li a.title')).toHaveText(['Attention is generosity']);
  await expect(set1.locator('.num')).toHaveText(['1.']);
  const reserve = page.getByTestId('reserve');
  await expect(reserve.getByTestId('reserve-total')).toHaveText('· 2');
  await expect(reserve.getByTestId('reserve-list').locator('li .title a')).toHaveText(['Courage before comfort', 'One thing at a time']); // newest first
  await expect(reserve.getByTestId('reserve-sort-az')).toBeVisible();

  // Place, from the reserve row: last in Set 2, gone from the reserve.
  const row = reserve.getByTestId('reserve-one-thing-at-a-time');
  await expect(row.getByTestId('place')).toBeDisabled();
  await row.getByTestId('place-set').selectOption('ps-7k2m');
  await row.getByTestId('place').click();
  await expect(page.getByTestId('moved')).toContainText('Placed One thing at a time in Set 2 — Work.');
  const work = page.getByTestId('principles-ps-7k2m');
  await expect(work.locator('li a.title')).toHaveText(['Say the hard thing first', 'Write to find out', 'One thing at a time']);
  await expect(work.locator('.num')).toHaveText(['1.', '2.', '3.']);
  await expect(reserve.getByTestId('reserve-total')).toHaveText('· 1');
  await expect(reserve.getByTestId('reserve-list').locator('li .title a')).toHaveText(['Courage before comfort']);

  // Both halves of each move are in history, and the brain is clean.
  await page.goto('/#/browse/principles/ps-7k2m/one-thing-at-a-time.md');
  await expect(page.getByTestId('frontmatter')).toContainText('ps-7k2m');
  await page.goto('/#/settings');
  await expect(page.getByTestId('refusal-count')).toHaveText('0 refusals');
  await expect(page.getByTestId('warnings')).toContainText('related.dangling');
});

test('write a new principle straight into the reserve', async ({ page }) => {
  await openSet(page, 'reserve');
  await page.getByTestId('new-principle-reserve').click();
  await expect(page.getByRole('heading', { name: 'New principle in reserve' })).toBeVisible();
  await expect(page.getByTestId('reserve-hint')).toContainText('never sent to a model');
  await page.getByTestId('edit-title').fill('Hold this for later');
  await page.getByTestId('edit-body').fill('Not yet a commitment; kept so it is not lost.');
  await page.getByTestId('edit-tags').fill('later');
  await page.getByTestId('edit-save').click();
  await expect(page).toHaveURL(/#\/browse\/principles\/_reserve\/hold-this-for-later\.md$/);
  await expect(page.getByTestId('fm-set')).toContainText('in reserve');
  await page.goto('/#/sets');
  const reserve = page.getByTestId('reserve');
  await expect(reserve.getByTestId('reserve-total')).toHaveText('· 2');
  await expect(reserve.getByTestId('reserve-list').locator('li .title a')).toHaveText(['Hold this for later', 'One thing at a time']);
  await expect(reserve.getByTestId('reserve-tag-later')).toBeVisible();
  await page.goto('/#/settings');
  await expect(page.getByTestId('refusal-count')).toHaveText('0 refusals');
});

test('one search over every principle: a ground\'s author finds it, and a set with no match collapses', async ({ page }) => {
  await openSet(page, 'set-ps-g8xw');
  await openSet(page, 'set-ps-7k2m');
  await openSet(page, 'reserve');
  const search = page.getByTestId('principles-search');
  await search.fill('weil');
  await expect(page.getByTestId('set-ps-g8xw').getByTestId('set-match-count')).toHaveText('· 1 of 2');
  await expect(page.getByTestId('principles-ps-g8xw').locator('li a.title')).toHaveText(['Attention is generosity']);
  await expect(page.getByTestId('set-ps-7k2m').getByTestId('no-match')).toHaveText('No principle in this set matches.');
  await expect(page.getByTestId('set-ps-7k2m').getByTestId('principles-ps-7k2m')).toHaveCount(0);
  await expect(page.getByTestId('reserve-count')).toHaveText('1 of 1 in reserve');
  await expect(page.getByTestId('reserve-one-thing-at-a-time')).toBeVisible();
  // arrows are for a whole set, not a filtered view
  await expect(page.getByTestId('principle-up')).toHaveCount(0);

  await search.fill('Didion');
  await expect(page.getByTestId('set-ps-g8xw').getByTestId('no-match')).toBeVisible();
  await expect(page.getByTestId('principles-ps-7k2m').locator('li a.title')).toHaveText(['Say the hard thing first']);
  await expect(page.getByTestId('reserve-list').locator('li.empty')).toHaveText('No reserve principle matches.');
  await expect(page.getByTestId('reserve-count')).toHaveText('0 of 1 in reserve');

  await page.getByTestId('principles-clear').click();
  await expect(search).toHaveValue('');
  await expect(page.getByTestId('no-match')).toHaveCount(0);
  await expect(page.getByTestId('principles-ps-7k2m').locator('li a.title')).toHaveCount(2);
  await expect(page.getByTestId('principle-up')).toHaveCount(4);
  await expect(page.getByTestId('reserve-count')).toHaveCount(0);
});

test('the editor keeps a principle in reserve after showing what will dangle, and adds a reserve principle to a set', async ({ page }) => {
  await page.goto('/#/edit/principles/ps-g8xw/courage-before-comfort.md');
  await expect(page.getByTestId('edit-title')).toHaveValue('Courage before comfort');
  await page.getByTestId('keep-in-reserve').click();
  const confirm = page.getByTestId('reserve-confirm');
  await expect(confirm).toContainText('Keep Courage before comfort in reserve? It leaves Set 1');
  await expect(confirm.getByTestId('dangling')).toContainText('maps/proposals/P-20260905-002.md → ps-g8xw/courage-before-comfort');
  await confirm.getByTestId('keep-in-reserve-yes').click();
  await expect(page).toHaveURL(/#\/browse\/principles\/_reserve\/courage-before-comfort\.md$/);
  await expect(page.getByTestId('fm-set')).toContainText('in reserve');

  // The editor over a reserve principle offers a set instead of a copy, and no "keep in reserve".
  await page.goto('/#/edit/principles/_reserve/courage-before-comfort.md');
  await expect(page.getByRole('heading', { name: 'Edit principle (in reserve)' })).toBeVisible();
  await expect(page.getByTestId('keep-in-reserve')).toHaveCount(0);
  await expect(page.getByTestId('copy-to')).toHaveCount(0);
  await page.getByTestId('editor-place-set').selectOption('ps-7k2m');
  await page.getByTestId('editor-place-go').click();
  await expect(page).toHaveURL(/#\/browse\/principles\/ps-7k2m\/courage-before-comfort\.md$/);
  await expect(page.getByTestId('frontmatter')).toContainText('3');
  await page.goto('/#/sets');
  await openSet(page, 'set-ps-7k2m');
  await expect(page.getByTestId('principles-ps-7k2m').locator('li a.title')).toHaveText(['Say the hard thing first', 'Write to find out', 'Courage before comfort']);
  await expect(page.getByTestId('reserve-total')).toHaveText('· 1');
  // An amendment proposal targets this one, so the confirmation names it; then it goes.
  await page.goto('/#/edit/principles/ps-7k2m/write-to-find-out.md');
  await page.getByTestId('keep-in-reserve').click();
  await expect(page.getByTestId('reserve-confirm').getByTestId('dangling')).toContainText('maps/proposals/P-20260905-001.md → principles/ps-7k2m/write-to-find-out');
  await page.getByTestId('keep-in-reserve-yes').click();
  await expect(page).toHaveURL(/#\/browse\/principles\/_reserve\/write-to-find-out\.md$/);
  // A principle nothing references is reserved with no confirmation.
  await page.goto('/#/sets/ps-g8xw/new-principle');
  await page.getByTestId('edit-title').fill('Unreferenced');
  await page.getByTestId('edit-save').click();
  await expect(page).toHaveURL(/#\/browse\/principles\/ps-g8xw\/unreferenced\.md$/);
  await page.goto('/#/edit/principles/ps-g8xw/unreferenced.md');
  await page.getByTestId('keep-in-reserve').click();
  await expect(page.getByTestId('reserve-confirm')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/browse\/principles\/_reserve\/unreferenced\.md$/);
  await page.goto('/#/settings');
  await expect(page.getByTestId('refusal-count')).toHaveText('0 refusals');
});

test('a reserve of hundreds pages, sorts, and filters by tag', async ({ page }) => {
  await page.goto('/#/settings?reserve-fill=300');
  await page.getByTestId('use-demo').click();
  await expect(page.getByText('Connected: demo brain')).toBeVisible();
  await page.goto('/#/sets');
  const reserve = page.getByTestId('reserve');
  await expect(reserve.getByTestId('reserve-total')).toHaveText('· 301');
  await openSet(page, 'reserve');
  await openSet(page, 'set-ps-7k2m');
  const rows = reserve.getByTestId('reserve-list').locator('li');
  await expect(rows).toHaveCount(50);
  // newest first: the last generated principle has the latest created date
  await expect(rows.first()).toContainText('300');
  await expect(reserve.getByTestId('reserve-more')).toHaveText('Show 50 more (201 left)');
  await reserve.getByTestId('reserve-more').click();
  await expect(rows).toHaveCount(100);

  await reserve.getByTestId('reserve-sort-az').click();
  await expect(rows).toHaveCount(50); // the page resets with the sort
  await expect(rows.first().locator('.title a')).toHaveText(/^Attend /);

  // twelve tag chips in view, the rest behind "All tags"; a chip narrows the list and the count line says so
  const tags = reserve.getByTestId('reserve-tags');
  await expect(tags.locator('button.chip:not([data-testid="reserve-all-tags"])')).toHaveCount(12);
  await expect(reserve.getByTestId('reserve-all-tags')).toHaveText('All tags (30)');
  await reserve.getByTestId('reserve-all-tags').click();
  await expect(tags.locator('button.chip:not([data-testid="reserve-all-tags"])')).toHaveCount(30);
  await reserve.getByTestId('reserve-tag-stoicism').click();
  await expect(reserve.getByTestId('reserve-count')).toContainText(/^\d+ of 301 in reserve$/);
  const shown = Number((await reserve.getByTestId('reserve-count').textContent())!.split(' ')[0]);
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThan(301);
  await reserve.getByTestId('reserve-clear-tags').click();
  await expect(reserve.getByTestId('reserve-count')).toHaveCount(0);

  // the search reaches the reserve too, by a ground's author
  await page.getByTestId('principles-search').fill('didion');
  await expect(reserve.getByTestId('reserve-count')).toHaveText('100 of 301 in reserve');
  await expect(page.getByTestId('principles-ps-7k2m').locator('li a.title')).toHaveText(['Say the hard thing first']);
});
