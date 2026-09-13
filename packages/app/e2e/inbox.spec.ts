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
  await expect(page.getByTestId('process-results')).toContainText('filed as unknown-the-only-way-to with 3 proposals');
  await expect(page.getByTestId('unfiled')).toContainText('Nothing waiting');

  const filing = page.getByTestId('filing-unknown-the-only-way-to');
  await expect(filing.getByTestId('state')).toHaveText('awaiting review');
  // Awaiting review, so it is open already, with the decision in view.
  await expect(filing.getByTestId('show-files')).toHaveCount(0);
  const panel = filing.getByTestId('review-panel');
  await expect(panel).toContainText('The only way to make sense out of change');
  await expect(panel).toContainText('sources/unknown-the-only-way-to/raw.md');
  await expect(panel).toContainText('maps/proposals/');
  await expect(panel.getByTestId('capture-filed')).toHaveText('Now filed as unknown-the-only-way-to.');
  await expect(panel.getByTestId('capture-lines')).toHaveCount(0);
  await panel.getByTestId('ratify').click();
  await expect(filing.getByTestId('state')).toHaveText('ratified');
  await expect(filing.getByTestId('review-panel')).toHaveCount(0); // decided: collapsed
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
  await second.getByTestId('reject').click();
  // A rejected filing leaves the list (its files are gone, the capture is unfiled again) until asked for.
  await expect(second).toHaveCount(0);
  await page.getByTestId('toggle-rejected').click();
  await expect(page.getByTestId('toggle-rejected')).toHaveText('Hide 1 rejected');
  await expect(second.getByTestId('state')).toHaveText('rejected');
  await expect(page.getByTestId('unfiled').locator('li')).toHaveCount(1);
  await expect(page.getByTestId('unfiled').locator('code')).toHaveText(/^2026\d{4}-\d{6}-/);
  await page.goto('/#/settings');
  await expect(page.getByTestId('refusal-count')).toHaveText('0 refusals');
});

test('a ratified filing offers no Reject: the revert would be refused, so the review says what it is instead', async ({ page }) => {
  await page.getByTestId('process').click();
  await expect(page.getByTestId('process-results')).toContainText('filed as');
  const filing = page.getByTestId('filing-unknown-the-only-way-to');
  await filing.getByTestId('ratify').click();
  await expect(filing.getByTestId('state')).toHaveText('ratified');
  await expect(filing.getByTestId('show-files')).toHaveText('Show files');
  await filing.getByTestId('show-files').click();
  await expect(filing.getByTestId('show-files')).toHaveText('Hide files');
  await expect(filing.getByTestId('review-panel')).toBeVisible();
  await expect(filing.getByTestId('reject')).toHaveCount(0);
  await expect(filing.getByTestId('ratify')).toHaveCount(0);
  await expect(filing.getByTestId('ratified-note')).toContainText('part of the brain now');
});

// Editing one of a filing's files before ratifying makes that file yours and leaves the other for Ratify;
// editing the source itself is the stronger approval, so once nothing is left the filing reads "yours".
test('a filing edited before ratification still ratifies the rest, and an edited source makes it yours', async ({ page }) => {
  await page.getByTestId('process').click();
  await expect(page.getByTestId('process-results')).toContainText('filed as unknown-the-only-way-to');
  // notes first
  await page.goto('/#/edit/sources/unknown-the-only-way-to/notes.md');
  await page.getByTestId('edit-body').fill('Heard this one in a lecture.');
  await page.getByTestId('edit-save').click();
  await expect(page.getByTestId('fm-curated')).toHaveText('yours');
  await page.goto('/#/inbox');
  const filing = page.getByTestId('filing-unknown-the-only-way-to');
  await expect(filing.getByTestId('state')).toHaveText('awaiting review');
  await filing.getByTestId('ratify').click();
  await expect(filing.getByTestId('state')).toHaveText('ratified');
  await page.goto('/#/browse/sources/unknown-the-only-way-to/raw.md');
  await expect(page.getByTestId('frontmatter')).toContainText('ratified');

  // source first, on a second capture
  await page.goto('/#/capture');
  await page.getByTestId('capture-text').fill('A second passage, to be edited.');
  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('saved')).toBeVisible();
  await page.goto('/#/inbox');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('process-results')).toContainText('filed as unknown-a-second-passage-to');
  await page.goto('/#/edit/sources/unknown-a-second-passage-to/raw.md');
  await page.getByTestId('edit-author').fill('Someone');
  await page.getByTestId('edit-save').click();
  await expect(page.getByTestId('fm-curated')).toHaveText('yours');
  await page.goto('/#/inbox');
  const second = page.getByTestId('filing-unknown-a-second-passage-to');
  await expect(second.getByTestId('state')).toHaveText('awaiting review'); // the notes are still the model's
  await second.getByTestId('ratify').click();
  await expect(second.getByTestId('state')).toHaveText('yours');
  await second.getByTestId('show-files').click();
  await expect(second.getByTestId('yours-note')).toHaveText("Yours. You modified it manually, which is a stronger approval than ratifying an agent's modifications.");
  await expect(second.getByTestId('ratify')).toHaveCount(0);
  await page.goto('/#/settings');
  await expect(page.getByTestId('refusal-count')).toHaveText('0 refusals');
});

// The review panel is where the judgment happens, so "right except the author" is decided there too: each new
// markdown file row carries its edit link, and the editor comes back to the same filing, open, after Save or Back.
test('the review panel offers edit links, and the editor returns to the open filing', async ({ page }) => {
  await page.getByTestId('process').click();
  await expect(page.getByTestId('process-results')).toContainText('filed as unknown-the-only-way-to');
  const filing = page.getByTestId('filing-unknown-the-only-way-to');
  await expect(filing.getByTestId('edit-source')).toHaveText('Edit metadata');
  await expect(filing.getByTestId('edit-notes')).toHaveText('Edit');

  // Back without a change lands on the filing, not on the file view
  await filing.getByTestId('edit-source').click();
  await expect(page.getByTestId('edit-author')).toBeVisible();
  await page.getByTestId('edit-back').click();
  await expect(page).toHaveURL(/#\/inbox\?filing=unknown-the-only-way-to$/);
  await expect(filing.getByTestId('review-panel')).toBeVisible();

  // fix the author: the source is yours, the notes still await review, and the filing is open on return
  await filing.getByTestId('edit-source').click();
  await page.getByTestId('edit-author').fill('Someone');
  await page.getByTestId('edit-save').click();
  await expect(page).toHaveURL(/#\/inbox\?filing=unknown-the-only-way-to$/);
  await expect(filing.getByTestId('state')).toHaveText('awaiting review');
  await expect(filing.getByTestId('review-panel')).toBeVisible();
  await expect(filing.getByTestId('edit-source')).toBeVisible();

  // then the notes: nothing is left for Ratify, the filing reads "yours" and is still open on return
  await filing.getByTestId('edit-notes').click();
  await page.getByTestId('edit-body').fill('Heard this one in a lecture.');
  await page.getByTestId('edit-save').click();
  await expect(page).toHaveURL(/#\/inbox\?filing=unknown-the-only-way-to$/);
  await expect(filing.getByTestId('state')).toHaveText('yours');
  await expect(filing.getByTestId('review-panel')).toBeVisible();
  await expect(filing.getByTestId('yours-note')).toBeVisible();
  await expect(filing.getByTestId('ratify')).toHaveCount(0);
  await expect(filing.getByTestId('edit-source')).toHaveCount(0);
  await expect(filing.getByTestId('show-files')).toHaveText('Hide files');
  await page.goto('/#/browse/sources/unknown-the-only-way-to/raw.md');
  await expect(page.getByTestId('frontmatter')).toContainText('Someone');
  await expect(page.getByTestId('fm-curated')).toHaveText('yours');
  await page.goto('/#/settings');
  await expect(page.getByTestId('refusal-count')).toHaveText('0 refusals');
});

// A URL in a passage widened the Inbox past the phone in WebKit, which un-pegged the tab bar and left the
// page zoomed. The page must stay as wide as the screen whatever a capture contains.
test('a filing with a long URL in its passage does not widen the page past the screen', async ({ page }) => {
  await page.goto('/#/capture');
  await page.getByTestId('capture-text').fill('See https://example.org/a/very/long/path/that/never/breaks/anywhere/at/all/index.html for more.');
  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('saved')).toBeVisible();
  await page.goto('/#/inbox');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('process-results')).toContainText('filed as');
  await expect(page.getByTestId('review-panel').first()).toBeVisible();
  const width = await page.evaluate(() => ({ screen: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
  expect(width.page).toBe(width.screen);
  const filing = page.getByTestId('filing-unknown-see-https-example-org');
  await expect(filing.getByTestId('ratify')).toBeVisible();
  await filing.getByTestId('ratify').click();
  await expect(filing.getByTestId('state')).toHaveText('ratified');
});
