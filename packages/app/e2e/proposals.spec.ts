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
  await expect(page.getByTestId('group-_reserve').getByRole('heading', { level: 3 })).toContainText('For your reserve · 3 open');
  await expect(page.getByTestId('group-_reserve').getByTestId('reserve-open').locator('li')).toHaveCount(3);
  await expect(page.getByTestId('group-_reserve').getByTestId('keep')).toHaveCount(3);
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

// A principle proposal for a set arrives with its sources as grounds, and its draft is only the proposal's
// wording: read it, save it as it is, and the principle has the ground and no instruction text.
test('accepting a principle proposal pre-fills its source as a ground, and an unedited draft saves clean', async ({ page }) => {
  await page.goto('/#/reason?task=relate-set&sources=weil-attention');
  await page.getByTestId('relate-set').click();
  await expect(page).toHaveURL(/#\/proposals\?related=3/);
  const set1 = page.getByTestId('group-ps-g8xw');
  const principle = set1.locator('article.proposal').filter({ hasText: 'Hold to this' });
  await expect(principle).toContainText('Grounds: weil-attention');
  await expect(principle.getByTestId('set-context')).toContainText('Set 1 holds 2 principles: Courage before comfort; Attention is generosity.');
  await principle.getByTestId('accept').click();
  await expect(page).toHaveURL(/#\/sets\/ps-g8xw\/new-principle\?from=/);
  await expect(page.getByTestId('ground-weil-attention')).toBeVisible();
  await expect(page.getByTestId('edit-body')).not.toHaveValue(/Drafted|Rewrite/);
  await expect(page.getByTestId('edit-body')).toHaveValue(/\*\*Grounding passages:\*\*\n\n- \[\[sources\/weil-attention\/raw\]\]/);
  await expect(page.getByTestId('from-proposal')).toContainText('Save it as it is, or put it in your own words.');
  await page.getByTestId('edit-save').click();
  await expect(page).toHaveURL(/#\/browse\/principles\/ps-g8xw\/hold-to-this-/);
  await expect(page.getByTestId('frontmatter')).toContainText('weil-attention');
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

// The reserve triage (schema §7.16): a filing's principles kept or dropped, singly or several at once in one
// commit, the rationale a tap away, and a near-duplicate named when the same text is filed twice.
test('triage a filing\'s reserve proposals: keep, drop, keep several as one commit, and see a near-duplicate', async ({ page }) => {
  await page.goto('/#/inbox');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('process-results')).toContainText('with 3 proposals');
  await page.goto('/#/proposals');
  const reserve = page.getByTestId('group-_reserve');
  await expect(reserve.getByRole('heading', { level: 3 })).toContainText('For your reserve · 3 open');
  const rows = reserve.getByTestId('reserve-open').locator('li');
  await expect(rows).toHaveCount(3);
  await expect(reserve.getByTestId('close-to')).toHaveCount(0);
  // the rationale unfolds on the title
  const first = rows.first();
  const firstId = (await first.getAttribute('data-testid'))!.slice('proposal-'.length);
  await expect(page.getByTestId(`rationale-${firstId}`)).toHaveCount(0);
  await page.getByTestId(`unfold-${firstId}`).click();
  await expect(page.getByTestId(`rationale-${firstId}`)).toContainText('The demo model suggests a principle');
  await expect(page.getByTestId(`rationale-${firstId}`)).toContainText('Grounds: unknown-the-only-way-to');
  // keep one: two rows left, the reserve holds it
  await first.getByTestId('keep').click();
  await expect(page.getByTestId('triaged')).toContainText('Kept 1 in the reserve');
  await expect(rows).toHaveCount(2);
  await reserve.getByTestId('toggle-decided').click();
  await expect(reserve.getByTestId('decided-_reserve').getByTestId('status')).toHaveText(['kept']);
  await expect(reserve.getByTestId('decided-_reserve').getByTestId('written-as')).toHaveText('in the reserve');
  // drop one
  await rows.first().getByTestId('drop').click();
  await expect(page.getByTestId('triaged')).toContainText('Dropped 1');
  await expect(rows).toHaveCount(1);
  await expect(reserve.getByTestId('keep-picked')).toHaveCount(0); // one row needs no picks

  // a second capture of the same text: its proposals name the open one and the kept principle as close
  await page.goto('/#/capture');
  await page.getByTestId('capture-text').fill('The only way to make sense out of change is to plunge into it, move with it, and join the dance.');
  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('saved')).toBeVisible();
  await page.goto('/#/inbox');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('process-results')).toContainText('with 3 proposals');
  await page.goto('/#/proposals');
  await expect(rows).toHaveCount(4);
  await expect(reserve.getByTestId('close-to').first()).toContainText('Close to:');
  await expect(reserve.getByTestId('close-to').filter({ hasText: '(principle)' }).first()).toBeVisible();
  await expect(reserve.getByTestId('close-to').filter({ hasText: '(proposal)' }).first()).toBeVisible();

  // keep two picked as one commit
  await expect(reserve.getByTestId('keep-picked')).toHaveText('Keep 0');
  await expect(reserve.getByTestId('keep-picked')).toBeDisabled();
  await reserve.getByTestId('reserve-pick-all').click();
  await expect(reserve.getByTestId('keep-picked')).toHaveText('Keep 4');
  await reserve.getByTestId('reserve-pick-none').click();
  const ids = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice('proposal-'.length)));
  await page.getByTestId(`pick-${ids[0]}`).check();
  await page.getByTestId(`pick-${ids[1]}`).check();
  await reserve.getByTestId('keep-picked').click();
  await expect(page.getByTestId('triaged')).toContainText('Kept 2 in the reserve');
  await expect(rows).toHaveCount(2);
  await page.goto('/#/sets');
  await expect(page.getByTestId('reserve-total')).toHaveText('· 4'); // the fixture's one, plus three kept
  await page.goto('/#/settings');
  await expect(page.getByTestId('refusal-count')).toHaveText('0 refusals');
});

test('the search narrows both parts, and an amendment card unfolds the principle it would change', async ({ page }) => {
  await page.goto('/#/inbox');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('process-results')).toContainText('with 3 proposals');
  await page.goto('/#/proposals');
  await expect(page.getByTestId('proposals-count')).toHaveCount(0);
  await page.getByTestId('proposals-search').fill('amendment');
  await expect(page.getByTestId('proposals-count')).toHaveText('1 of 5 open match');
  await expect(page.getByTestId('group-_reserve').getByTestId('reserve-open').locator('li.empty')).toHaveText('No reserve proposal matches.');
  const work = page.getByTestId('group-ps-7k2m');
  await expect(work.locator('article.proposal')).toHaveCount(1);
  const amendment = work.getByTestId('proposal-P-20260905-003');
  await expect(amendment.getByTestId('target-body')).toContainText('Say the hard thing first, as it stands');
  await amendment.getByTestId('target-body').locator('summary').click();
  await expect(amendment.getByTestId('target-body')).toContainText('the sentence I am avoiding is the one to write');
  await page.getByTestId('proposals-search').fill('only way');
  await expect(page.getByTestId('proposals-count')).toHaveText('3 of 5 open match'); // the filed source's title finds its three
  await page.getByTestId('proposals-clear').click();
  await expect(page.getByTestId('proposals-count')).toHaveCount(0);
});
