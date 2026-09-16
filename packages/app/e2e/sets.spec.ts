import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByTestId('use-demo').click();
  await expect(page.getByText('Connected: demo brain')).toBeVisible();
  await page.goto('/#/sets');
});

const labels = (page: import('@playwright/test').Page) => page.getByTestId('set-label').allTextContents();
const openSet = (page: import('@playwright/test').Page, id: string) => page.getByTestId(id).getByTestId('set-toggle').click();


test('create Set 3, rename it, reorder principles, delete Set 1, and the survivors renumber with links intact', async ({ page }) => {
  await expect(page.getByTestId('sets').locator('li.set')).toHaveCount(2);
  await page.getByTestId('new-set-name').fill('Parenting');
  await page.getByTestId('new-set').click();
  await expect.poll(() => labels(page)).toEqual(['Set 1', 'Set 2 — Work', 'Set 3 — Parenting']);

  const set3 = page.getByTestId('sets').locator('li.set').nth(2);
  await set3.getByTestId('set-rename').click();
  await set3.getByTestId('rename-input').fill('Kids');
  await set3.getByTestId('rename-save').click();
  await expect.poll(() => labels(page)).toEqual(['Set 1', 'Set 2 — Work', 'Set 3 — Kids']);

  await openSet(page, 'set-ps-7k2m');
  const work = page.getByTestId('principles-ps-7k2m');
  await expect(work.locator('li a')).toHaveText(['Say the hard thing first', 'Write to find out']);
  // Each row carries its precedence number, and the numbers follow a reorder.
  await expect(work.locator('.num')).toHaveText(['1.', '2.']);
  await work.locator('li').nth(1).getByTestId('principle-up').click();
  await expect(work.locator('li a')).toHaveText(['Write to find out', 'Say the hard thing first']);
  await expect(work.locator('.num')).toHaveText(['1.', '2.']);
  await expect(work.locator('li').first()).toContainText('1. Write to find out');

  const set1 = page.getByTestId('set-ps-g8xw');
  await set1.getByTestId('set-delete').click();
  const confirm = page.getByTestId('delete-confirm');
  await expect(confirm).toContainText('Delete Set 1 and its 2 principles?');
  await expect(confirm.getByTestId('dangling')).toContainText('principles/ps-7k2m/say-the-hard-thing-first.md → ps-g8xw/courage-before-comfort');
  await expect(confirm.getByTestId('dangling')).toContainText('maps/proposals/P-20260905-002.md → ps-g8xw');
  await confirm.getByTestId('delete-confirm-yes').click();
  await expect.poll(() => labels(page)).toEqual(['Set 1 — Work', 'Set 2 — Kids']);
  await expect(page.getByTestId('set-ps-g8xw')).toHaveCount(0);

  // paths never changed: the principle is still where it was, and the brain has no refusals
  await page.goto('/#/browse/principles/ps-7k2m/say-the-hard-thing-first.md');
  await expect(page.getByRole('heading', { name: 'Say the hard thing first' })).toBeVisible();
  await expect(page.getByTestId('frontmatter')).toContainText('order');
  await expect(page.getByTestId('frontmatter')).toContainText('2');
  await page.goto('/#/settings');
  await expect(page.getByTestId('refusal-count')).toHaveText('0 refusals');
  await expect(page.getByTestId('warnings')).toContainText('related.dangling');
});

test('reorder sets with the buttons and edit a set description', async ({ page }) => {
  await page.getByTestId('set-ps-7k2m').getByTestId('set-up').click();
  await expect.poll(() => labels(page)).toEqual(['Set 1 — Work', 'Set 2']);
  await page.getByTestId('set-ps-g8xw').getByTestId('set-up').click();
  await expect.poll(() => labels(page)).toEqual(['Set 1', 'Set 2 — Work']);

  const work = page.getByTestId('set-ps-7k2m');
  await work.getByTestId('set-describe').click();
  await work.getByTestId('describe-input').fill('Read these as constraints on craft.');
  await work.getByTestId('describe-save').click();
  await expect(work).toContainText('Read these as constraints on craft.');
  await page.goto('/#/browse/principles/ps-7k2m/_set.md');
  await expect(page.getByTestId('file-body')).toContainText('Read these as constraints on craft.');
});

test('the last set cannot be deleted and an empty new set says so', async ({ page }) => {
  await page.getByTestId('new-set').click();
  await expect.poll(() => labels(page)).toEqual(['Set 1', 'Set 2 — Work', 'Set 3']);
  await page.getByTestId('sets').locator('li.set').nth(2).getByTestId('set-toggle').click();
  await expect(page.getByTestId('sets').locator('li.set').nth(2)).toContainText('No principles yet');
  for (const slug of ['ps-g8xw', 'ps-7k2m']) {
    await page.getByTestId(`set-${slug}`).getByTestId('set-delete').click();
    await page.getByTestId('delete-confirm-yes').click();
    await expect(page.getByTestId(`set-${slug}`)).toHaveCount(0);
  }
  await expect(page.getByTestId('sets').locator('li.set')).toHaveCount(1);
  await expect(page.getByTestId('set-delete')).toBeDisabled();
});

// Every set and the reserve start collapsed, with a count; a tap opens one for the session, and a search opens
// the sets that match and shuts the rest, restoring what was open when it is cleared (maintainer, 2026-09-16).
test('sets start collapsed with counts, open on a tap for the session, and follow the search', async ({ page }) => {
  const set1 = page.getByTestId('set-ps-g8xw');
  const work = page.getByTestId('set-ps-7k2m');
  const reserve = page.getByTestId('reserve');
  for (const s of [set1, work, reserve]) await expect(s.getByTestId('set-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(set1.getByTestId('set-count')).toHaveText('· 2 principles');
  await expect(page.getByTestId('principles-ps-g8xw')).toHaveCount(0);
  await expect(reserve.getByTestId('reserve-list')).toHaveCount(0);
  await expect(reserve.getByTestId('reserve-total')).toHaveText('· 1');
  // the controls stay on the heading, collapsed or not
  await expect(set1.getByTestId('set-rename')).toBeVisible();

  await openSet(page, 'set-ps-g8xw');
  await expect(set1.getByTestId('set-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('principles-ps-g8xw').locator('li a.title')).toHaveText(['Courage before comfort', 'Attention is generosity']);
  await expect(set1.getByTestId('set-file')).toBeVisible();
  await expect(work.getByTestId('set-toggle')).toHaveAttribute('aria-expanded', 'false');
  await openSet(page, 'reserve');
  await expect(reserve.getByTestId('reserve-list').locator('li')).toHaveCount(1);

  // a trip away and back keeps them open; a reload starts collapsed
  await page.getByTestId('principles-ps-g8xw').locator('li a.title').first().click();
  await expect(page.getByRole('heading', { name: 'Courage before comfort' })).toBeVisible();
  await page.goto('/#/sets');
  await expect(set1.getByTestId('set-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(reserve.getByTestId('set-toggle')).toHaveAttribute('aria-expanded', 'true');

  // the search opens matches and shuts the rest, then hands back what was open
  await page.getByTestId('principles-search').fill('didion');
  await expect(work.getByTestId('set-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('principles-ps-7k2m').locator('li a.title')).toHaveText(['Say the hard thing first']);
  await expect(set1.getByTestId('set-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(set1.getByTestId('no-match')).toHaveText('No principle in this set matches.');
  await expect(page.getByTestId('principles-ps-g8xw')).toHaveCount(0);
  await expect(reserve.getByTestId('reserve-list').locator('li.empty')).toHaveText('No reserve principle matches.');
  await page.getByTestId('principles-clear').click();
  await expect(set1.getByTestId('set-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(work.getByTestId('set-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('principles-ps-g8xw').locator('li a.title')).toHaveCount(2);

  await page.reload();
  await expect(set1.getByTestId('set-toggle')).toHaveAttribute('aria-expanded', 'false');
});
