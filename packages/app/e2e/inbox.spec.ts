import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByTestId('use-demo').click();
  await expect(page.getByText('Connected: demo brain')).toBeVisible();
  await page.goto('/#/inbox');
});

test('file a capture with the demo model, review it, ratify it; file another and reject it', async ({ page }) => {
  await expect(page.getByTestId('unfiled').locator('li')).toHaveCount(1);
  await expect(page.getByTestId('unfiled')).toContainText('20260906-070000-2bq');
  await expect(page.getByTestId('filings').locator('li')).toHaveCount(1); // the fixture's pending Aurelius filing is not in git history here
  await expect(page.getByTestId('inbox-model')).toContainText('Demo model');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('process-results')).toContainText('filed as unknown-the-only-way-to with 2 proposals');
  await expect(page.getByTestId('unfiled')).toContainText('Nothing waiting');

  const filing = page.getByTestId('filing-unknown-the-only-way-to');
  await expect(filing.getByTestId('state')).toHaveText('awaiting review');
  await filing.getByTestId('review').click();
  const panel = filing.getByTestId('review-panel');
  await expect(panel).toContainText('The only way to make sense out of change');
  await expect(panel).toContainText('sources/unknown-the-only-way-to/raw.md');
  await expect(panel).toContainText('maps/proposals/');
  await expect(panel.getByTestId('capture-lines')).toHaveText('+ status: filed\n+ filed_as: unknown-the-only-way-to');
  await panel.getByTestId('ratify').click();
  await expect(filing.getByTestId('state')).toHaveText('ratified');
  await page.goto('/#/browse/sources/unknown-the-only-way-to/raw.md');
  await expect(page.getByTestId('frontmatter')).toContainText('ratified');

  // a second capture, filed and rejected
  await page.goto('/#/capture');
  await page.getByTestId('capture-text').fill('Second capture, to be rejected.');
  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('saved')).toBeVisible();
  await page.goto('/#/inbox');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('process-results')).toContainText('filed as unknown-second-capture-to-be');
  const second = page.getByTestId('filing-unknown-second-capture-to-be');
  await second.getByTestId('review').click();
  await second.getByTestId('reject').click();
  await expect(second.getByTestId('state')).toHaveText('rejected');
  await expect(page.getByTestId('unfiled').locator('li')).toHaveCount(1);
  await expect(page.getByTestId('unfiled').locator('code')).toHaveText(/^2026\d{4}-\d{6}-/);
  await page.goto('/#/settings');
  await expect(page.getByTestId('refusal-count')).toHaveText('0 refusals');
});

test('rejecting a ratified filing explains the conflict', async ({ page }) => {
  await page.getByTestId('process').click();
  await expect(page.getByTestId('process-results')).toContainText('filed as');
  const filing = page.getByTestId('filing-unknown-the-only-way-to');
  await filing.getByTestId('review').click();
  await filing.getByTestId('ratify').click();
  await expect(filing.getByTestId('state')).toHaveText('ratified');
  await filing.getByTestId('review').click();
  await filing.getByTestId('reject').click();
  await expect(filing.getByTestId('conflict')).toContainText('cannot be reverted');
  await expect(filing.getByTestId('conflict')).toContainText('sources/unknown-the-only-way-to/raw.md');
  await expect(filing.getByTestId('state')).toHaveText('ratified');
});
