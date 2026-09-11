import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByTestId('use-demo').click();
  await expect(page.getByText('Connected: demo brain')).toBeVisible();
});

test('decide three proposals and write a principle from an accepted one', async ({ page }) => {
  await page.goto('/#/proposals');
  const work = page.getByTestId('group-ps-7k2m');
  await expect(work.getByRole('heading', { level: 3 })).toContainText('Set 2 — Work · 2 open');
  await expect(work.getByTestId('proposal-P-20260905-001')).toContainText('Rise to the work');

  // accept the principle proposal: decided, then the editor pre-filled from it
  await work.getByTestId('proposal-P-20260905-001').getByTestId('accept').click();
  await expect(page).toHaveURL(/#\/sets\/ps-7k2m\/new-principle\?from=P-20260905-001$/);
  await expect(page.getByTestId('from-proposal')).toContainText('From proposal P-20260905-001');
  await expect(page.getByTestId('edit-title')).toHaveValue('Rise to the work');
  await expect(page.getByTestId('ground-aurelius-meditations-5-1')).toBeVisible();
  await expect(page.getByTestId('edit-body')).toHaveValue(/Written from \[\[maps\/proposals\/P-20260905-001\]\]/);
  await page.getByTestId('edit-body').fill('Get up; the work is what you are for.\n\n**Grounding passages:**\n\n- [[sources/aurelius-meditations-5-1/raw]] ([raw](../../sources/aurelius-meditations-5-1/raw.md))\n\nWritten from [[maps/proposals/P-20260905-001]] ([proposal](../../maps/proposals/P-20260905-001.md)).\n');
  await page.getByTestId('edit-save').click();
  await expect(page).toHaveURL(/rise-to-the-work\.md$/);

  // the proposal shows accepted with the new principle linked
  await page.goto('/#/proposals');
  await expect(work.getByRole('heading', { level: 3 })).toContainText('1 open');
  await work.getByTestId('toggle-decided').click();
  const decided = work.getByTestId('proposal-P-20260905-001');
  await expect(decided.getByTestId('status')).toHaveText('accepted');
  await expect(decided.getByTestId('written-as')).toHaveText('Rise to the work');

  // decline the amendment, and decide a tag proposal from a fresh demo filing
  await work.getByTestId('proposal-P-20260905-003').getByTestId('decline').click();
  await expect(work.getByRole('heading', { level: 3 })).toContainText('0 open');
  await page.goto('/#/inbox');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('process-results')).toContainText('filed as');
  await page.goto('/#/proposals');
  const sources = page.getByTestId('group-sources');
  await expect(sources.getByRole('heading', { level: 3 })).toContainText('1 open');
  await sources.getByTestId('accept').click();
  await expect(page).toHaveURL(/#\/edit\/sources\/unknown-the-only-way-to\/raw\.md\?from=/);
  await expect(page.getByTestId('from-proposal')).toContainText('(tag)');
  await expect(page.getByTestId('passage-readonly')).toBeVisible();
  await page.goto('/#/settings');
  await expect(page.getByTestId('refusal-count')).toHaveText('0 refusals');
});

test('a filing with an attachment shows it in the review by name and size', async ({ page }) => {
  await page.goto('/#/capture');
  await page.getByTestId('capture-text').fill('A photographed page.');
  await page.getByTestId('capture-file').setInputFiles({ name: 'page.png', mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]) });
  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('saved')).toContainText('with its attachment');
  await page.goto('/#/inbox');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('process-results')).toContainText('unknown-a-photographed-page');
  const filing = page.getByTestId('filing-unknown-a-photographed-page');
  await expect(filing.getByTestId('review-panel')).toContainText('original.png · attachment · 0.0 KB · new');
  await filing.getByTestId('review-panel').getByRole('link', { name: 'original.png' }).click();
  await expect(page.getByTestId('attachment-image')).toBeVisible();
});

// Accepting a principle proposal decides it at once; the principle itself is written in the editor
// afterwards. Leaving that editor without adding it must not strand the proposal: the decided list
// says it is not written yet and offers the pre-filled editor again.
test('an accepted principle proposal that was never written offers "Write it" from the decided list', async ({ page }) => {
  await page.goto('/#/proposals');
  const work = page.getByTestId('group-ps-7k2m');
  await work.getByTestId('proposal-P-20260905-001').getByTestId('accept').click();
  await expect(page.getByTestId('edit-title')).toHaveValue('Rise to the work');
  // An untouched draft is left without a question.
  await page.getByTestId('edit-back').click();
  await expect(page).toHaveURL(/#\/sets$/);
  await expect(page.getByTestId('set-ps-7k2m')).not.toContainText('Rise to the work');

  await page.goto('/#/proposals');
  await expect(work.getByRole('heading', { level: 3 })).toContainText('1 open');
  await work.getByTestId('toggle-decided').click();
  const decided = work.getByTestId('proposal-P-20260905-001');
  await expect(decided.getByTestId('status')).toHaveText('accepted');
  await expect(decided).toContainText('not written yet');
  await decided.getByTestId('write-it').click();
  await expect(page).toHaveURL(/#\/sets\/ps-7k2m\/new-principle\?from=P-20260905-001$/);
  await expect(page.getByTestId('edit-title')).toHaveValue('Rise to the work');
  await page.getByTestId('edit-save').click();
  await expect(page).toHaveURL(/rise-to-the-work\.md$/);

  await page.goto('/#/proposals');
  await work.getByTestId('toggle-decided').click();
  await expect(decided.getByTestId('written-as')).toHaveText('Rise to the work');
  await expect(decided.getByTestId('write-it')).toHaveCount(0);
  await page.goto('/#/sets');
  await expect(page.getByTestId('set-ps-7k2m')).toContainText('Rise to the work');
});
