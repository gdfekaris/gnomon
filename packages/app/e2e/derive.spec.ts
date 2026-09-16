import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByTestId('use-demo').click();
  await expect(page.getByText('Connected: demo brain')).toBeVisible();
});

// Task E in the app: from a passage's page to Reason with it picked, derive into Set 1, decide the three on
// Proposals three different ways, and find two principles in the set in accept order with their grounds.
test('derive principles from one source into Set 1, then write, edit, and decline them', async ({ page }) => {
  await page.goto('/#/browse/sources/weil-attention/raw.md');
  await page.getByTestId('derive-from').click();
  await expect(page).toHaveURL(/#\/reason\?task=derive&sources=weil-attention$/);
  await expect(page.getByTestId('task')).toHaveValue('derive');
  await expect(page.getByTestId('derive-chosen')).toContainText('Attention as generosity');
  await expect(page.getByTestId('set-picker')).toHaveCount(0);
  await expect(page.getByTestId('derive-set')).toHaveValue('ps-g8xw');
  await expect(page.getByTestId('budget-note')).toHaveText('1 passage fits the budget.');
  await page.getByTestId('derive').click();
  await expect(page).toHaveURL(/#\/proposals\?derived=3&from=weil-attention&set=ps-g8xw$/);
  await expect(page.getByTestId('derived')).toHaveText('3 proposals derived from Attention as generosity. Write each as proposed, edit it, or decline it.');
  const set1 = page.getByTestId('group-ps-g8xw');
  await expect(set1.getByRole('heading', { level: 3 })).toContainText('3 open');
  const cards = set1.locator('article.proposal');
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).toContainText('Grounds: weil-attention');
  await expect(cards.first().locator('.kind')).toHaveText('principle');
  const first = await cards.first().locator('h4').textContent();
  const firstTitle = first!.replace(/^principle\s*/, '').replace(/\s*P-\d{8}-\d{3}.*$/, '').trim();

  await cards.first().getByTestId('write-as-proposed').click();
  await expect(set1.getByRole('heading', { level: 3 })).toContainText('2 open');
  await cards.first().getByTestId('accept').click();
  await expect(page).toHaveURL(/#\/sets\/ps-g8xw\/new-principle\?from=/);
  await expect(page.getByTestId('ground-weil-attention')).toBeVisible();
  await page.getByTestId('edit-title').fill('Attention, given freely, is the rarest gift');
  await page.getByTestId('edit-save').click();
  await expect(page).toHaveURL(/attention-given-freely-is-the-rarest-gift\.md$/);
  await page.goto('/#/proposals');
  await expect(set1.getByRole('heading', { level: 3 })).toContainText('1 open');
  await set1.locator('article.proposal').first().getByTestId('decline').click();
  await expect(set1.getByRole('heading', { level: 3 })).toContainText('0 open');

  await page.goto('/#/sets');
  await page.getByTestId('set-ps-g8xw').getByTestId('set-toggle').click();
  const set = page.getByTestId('set-ps-g8xw');
  await expect(set).toContainText(firstTitle);
  await expect(set).toContainText('Attention, given freely, is the rarest gift');
  const titles = await set.locator('li .title, li a').allTextContents();
  expect(titles.indexOf(firstTitle)).toBeLessThan(titles.indexOf('Attention, given freely, is the rarest gift')); // accept order
  await page.goto('/#/settings');
  await expect(page.getByTestId('refusal-count')).toHaveText('0 refusals');
});

test('derive from two sources into a new set, picked by search', async ({ page }) => {
  await page.goto('/#/reason');
  await page.getByTestId('task').selectOption('derive');
  await expect(page.getByTestId('budget-note')).toHaveText('Pick at least one source.');
  await expect(page.getByTestId('derive')).toBeDisabled();
  await page.getByTestId('derive-search').fill('aurelius');
  await page.getByTestId('derive-pick-aurelius-meditations-4-3').check();
  await page.getByTestId('derive-pick-aurelius-meditations-5-1').check();
  await expect(page.getByTestId('derive-chosen')).toContainText('Retire into thyself');
  await expect(page.getByTestId('derive-chosen')).toContainText('The work of a human being');
  await page.getByTestId('derive-drop-aurelius-meditations-5-1').click();
  await expect(page.getByTestId('derive-chosen')).not.toContainText('The work of a human being');
  await page.getByTestId('derive-pick-aurelius-meditations-5-1').check();
  await page.getByTestId('derive-set').selectOption('new');
  await page.getByTestId('derive-set-name').fill('Stoic');
  await expect(page.getByTestId('budget-note')).toHaveText('2 passages fit the budget.');
  await page.getByTestId('derive').click();
  await expect(page).toHaveURL(/#\/proposals\?derived=\d+&from=aurelius-meditations-4-3%2Caurelius-meditations-5-1&set=ps-[a-z0-9]{4}$/);
  const setSlug = /set=(ps-[a-z0-9]{4})/.exec(page.url())![1]!;
  await expect(page.getByTestId('derived')).toContainText('derived from Retire into thyself and The work of a human being');
  const group = page.getByTestId(`group-${setSlug}`);
  await expect(group.getByRole('heading', { level: 3 })).toContainText('Set 3 — Stoic');
  await expect(group.locator('article.proposal').first()).toContainText('Grounds: aurelius-meditations');
  await page.goto('/#/sets');
  await expect(page.getByTestId(`set-${setSlug}`)).toContainText('Set 3 — Stoic');
});

test('the empty-brain note offers Derive, and Derive waits for a source', async ({ page }) => {
  // A brain without principles offers Derive where reasoning is refused.
  await page.goto('/#/settings?demo-omit=principles/ps-g8xw/courage-before-comfort.md,principles/ps-g8xw/attention-is-generosity.md,principles/ps-7k2m/say-the-hard-thing-first.md,principles/ps-7k2m/write-to-find-out.md');
  await page.getByTestId('use-demo').click();
  await expect(page.getByText('Connected: demo brain')).toBeVisible();
  await page.goto('/#/reason');
  await page.getByTestId('task').selectOption('reason');
  await expect(page.getByTestId('empty-reason')).toContainText('derive principles from a source');
  await page.getByTestId('task').selectOption('derive');
  await expect(page.getByTestId('derive-results')).toBeVisible();
  await expect(page.getByTestId('derive')).toBeDisabled();
  await page.getByTestId('derive-pick-didion-why-i-write').check();
  await expect(page.getByTestId('budget-note')).toHaveText('1 passage fits the budget.');
  await expect(page.getByTestId('derive')).toBeEnabled();
});
