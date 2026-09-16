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

  // decline the amendment; then a fresh demo filing raises reserve principles only, its tags on the source
  // itself (schema §7.6, 2026-09-16): the Sources group keeps only the fixture's decided tag proposal.
  await work.getByTestId('proposal-P-20260905-003').getByTestId('decline').click();
  await expect(work.getByRole('heading', { level: 3 })).toContainText('0 open');
  await page.goto('/#/inbox');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('process-results')).toContainText('filed as unknown-the-only-way-to with 3 proposals');
  await page.goto('/#/proposals');
  await expect(page.getByTestId('group-_reserve').getByRole('heading', { level: 3 })).toContainText('Reserve · 3 open');
  await expect(page.getByTestId('group-_reserve').locator('article.proposal .kind')).toHaveText(['principle', 'principle', 'principle']);
  await expect(page.getByTestId('group-sources').getByRole('heading', { level: 3 })).toContainText('0 open');
  await expect(page.getByTestId('group-sources').getByTestId('accept')).toHaveCount(0);
  await page.goto('/#/browse/sources/unknown-the-only-way-to/raw.md');
  await expect(page.getByTestId('frontmatter')).toContainText('demo');
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

// A link proposal proposes a ground, and accepting it adds the ground: the decision, then the principle edit,
// then the principle's page saying so. The decided list points at the principle.
// Filing no longer raises link proposals (schema §7.6, 2026-09-16); this flow moves to the Relate task in the
// next block, where the demo model proposes the same ground.
test.fixme('accepting a link proposal adds the ground to the principle and shows it', async ({ page }) => {
  await page.goto('/#/inbox');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('process-results')).toContainText('filed as unknown-the-only-way-to with 3 proposals');
  await page.goto('/#/proposals');
  const set1 = page.getByTestId('group-ps-g8xw');
  const link = set1.locator('article.proposal').filter({ hasText: 'Ground courage-before-comfort in this passage' });
  await expect(link.getByTestId('proposes')).toHaveText('Proposes a ground: add The only way to make sense to the grounds of Courage before comfort.');
  await expect(link.getByTestId('accept')).toHaveText('Accept and add the ground');
  await link.getByTestId('accept').click();
  await expect(page).toHaveURL(/#\/browse\/principles\/ps-g8xw\/courage-before-comfort\.md\?added=unknown-the-only-way-to$/);
  await expect(page.getByTestId('ground-added')).toHaveText('Added The only way to make sense to the grounds.');
  await expect(page.getByTestId('frontmatter')).toContainText('unknown-the-only-way-to');
  await expect(page.locator('main')).toContainText('Grounding passages');
  await page.goto('/#/proposals');
  await expect(set1.getByRole('heading', { level: 3 })).toContainText('1 open'); // the principle proposal remains
  await set1.getByTestId('toggle-decided').click();
  const decided = set1.getByTestId('decided-ps-g8xw').locator('li').filter({ hasText: 'Ground courage-before-comfort in this passage' });
  await expect(decided.getByTestId('status')).toHaveText('accepted');
  await expect(decided.getByTestId('ground-of')).toHaveText('Courage before comfort');
  await expect(decided.getByTestId('add-ground')).toHaveCount(0);
  await page.goto('/#/settings');
  await expect(page.getByTestId('refusal-count')).toHaveText('0 refusals');
});

// A principle proposal from a filing arrives with the capture as a ground, and its draft is only the proposal's
// wording: read it, save it as it is, and the principle has the ground and no instruction text.
test('accepting a principle proposal pre-fills its source as a ground, and an unedited draft saves clean', async ({ page }) => {
  await page.goto('/#/inbox');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('process-results')).toContainText('filed as unknown-the-only-way-to with 3 proposals');
  await page.goto('/#/proposals');
  // A filing's principle proposals target the reserve (schema §7.6): they group under Reserve, not a set.
  const reserveGroup = page.getByTestId('group-_reserve');
  await expect(reserveGroup.getByRole('heading', { level: 3 })).toContainText('Reserve');
  await expect(reserveGroup.getByRole('heading', { level: 3 })).toContainText('3 open');
  const principle = reserveGroup.locator('article.proposal').filter({ hasText: 'asks of me' });
  await expect(principle).toContainText('Grounds: unknown-the-only-way-to');
  await principle.getByTestId('accept').click();
  await expect(page).toHaveURL(/#\/sets\/_reserve\/new-principle\?from=/);
  await expect(page.getByRole('heading', { name: 'New principle in reserve' })).toBeVisible();
  await expect(page.getByTestId('ground-unknown-the-only-way-to')).toBeVisible();
  await expect(page.getByTestId('edit-body')).not.toHaveValue(/Drafted|Rewrite/);
  await expect(page.getByTestId('edit-body')).toHaveValue(/\*\*Grounding passages:\*\*\n\n- \[\[sources\/unknown-the-only-way-to\/raw\]\]/);
  await expect(page.getByTestId('from-proposal')).toContainText('Save it as it is, or put it in your own words.');
  await page.getByTestId('edit-save').click();
  await expect(page).toHaveURL(/#\/browse\/principles\/_reserve\/what-the-only-way-to-make-sense-asks-of-me\.md$/);
  await expect(page.getByTestId('fm-set')).toContainText('in reserve');
  await expect(page.getByTestId('frontmatter')).toContainText('unknown-the-only-way-to');
  await expect(page.getByTestId('fm-curated')).toHaveText('yours');
  await expect(page.locator('main')).not.toContainText('Drafted from a proposal');
  await page.goto('/#/settings');
  await expect(page.getByTestId('refusal-count')).toHaveText('0 refusals');
});

// One tap writes a principle proposal as proposed: the decision, then the principle from the same pre-fill the
// editor shows. The row moves to decided with the principle linked; the set holds it with its ground.
test('"Write it as proposed" writes the principle in one tap', async ({ page }) => {
  await page.goto('/#/proposals');
  const work = page.getByTestId('group-ps-7k2m');
  const row = work.getByTestId('proposal-P-20260905-001');
  await expect(row.getByTestId('write-as-proposed')).toHaveText('Write it as proposed');
  await expect(row.getByTestId('accept')).toHaveText('Accept and edit');
  await row.getByTestId('write-as-proposed').click();
  await expect(work.getByRole('heading', { level: 3 })).toContainText('1 open');
  await expect(page).toHaveURL(/#\/proposals$/);
  await work.getByTestId('toggle-decided').click();
  const decided = work.getByTestId('decided-ps-7k2m').getByTestId('proposal-P-20260905-001');
  await expect(decided.getByTestId('status')).toHaveText('accepted');
  await expect(decided.getByTestId('written-as')).toHaveText('Rise to the work');
  await decided.getByTestId('written-as').click();
  await expect(page.getByRole('heading', { name: 'Rise to the work' })).toBeVisible();
  await expect(page.getByTestId('frontmatter')).toContainText('aurelius-meditations-5-1');
  await expect(page.getByTestId('fm-curated')).toHaveText('yours');
  await expect(page.getByTestId('file-body')).toContainText('Grounding passages');
  await page.goto('/#/sets');
  await expect(page.getByTestId('set-ps-7k2m')).toContainText('Rise to the work');
  await page.goto('/#/settings');
  await expect(page.getByTestId('refusal-count')).toHaveText('0 refusals');
});
