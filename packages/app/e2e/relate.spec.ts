import { expect, test } from '@playwright/test';

// Relate sources to a set — Task F (schema §7.15): the deliberate act that filing no longer guesses at.
// From a passage's page to Reason with it picked, relate it to Set 1, and decide the proposals on
// Proposals, including the link that adds the ground.

test.beforeEach(async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByTestId('use-demo').click();
  await expect(page.getByText('Connected: demo brain')).toBeVisible();
});

test('relate one source to Set 1 from its page, then accept the link proposal and see the ground added', async ({ page }) => {
  await page.goto('/#/browse/sources/weil-attention/raw.md');
  await page.getByTestId('relate-from').click();
  await expect(page).toHaveURL(/#\/reason\?task=relate-set&sources=weil-attention$/);
  await expect(page.getByTestId('task')).toHaveValue('relate-set');
  await expect(page.getByTestId('relate-set-hint')).toContainText('Nothing changes until you decide each');
  await expect(page.getByTestId('derive-chosen')).toContainText('Attention as generosity');
  await expect(page.getByTestId('set-picker')).toHaveCount(0);
  await expect(page.getByTestId('derive-set')).toHaveCount(0); // no "New set…": the point is an existing stance
  await expect(page.getByTestId('relate-set-target')).toHaveValue('ps-g8xw');
  await expect(page.getByTestId('budget-note')).toHaveText('1 passage fits the budget.');
  await page.getByTestId('relate-set').click();
  await expect(page).toHaveURL(/#\/proposals\?related=3&from=weil-attention&set=ps-g8xw$/);
  await expect(page.getByTestId('related')).toHaveText('3 proposals for Set 1 from Attention as generosity. Decide each below.');
  const set1 = page.getByTestId('group-ps-g8xw');
  await expect(set1.getByRole('heading', { level: 3 })).toContainText('3 open');
  await expect(set1.locator('article.proposal .kind')).toHaveText(['principle', 'amendment', 'link']); // newest id first
  const link = set1.locator('article.proposal').filter({ hasText: 'Ground courage-before-comfort in this passage' });
  await expect(link.getByTestId('proposes')).toHaveText('Proposes a ground: add Attention as generosity to the grounds of Courage before comfort.');
  await expect(link).not.toContainText('From:'); // no from_source on a related proposal
  await expect(link.getByTestId('accept')).toHaveText('Accept and add the ground');
  await link.getByTestId('accept').click();
  await expect(page).toHaveURL(/#\/browse\/principles\/ps-g8xw\/courage-before-comfort\.md\?added=weil-attention$/);
  await expect(page.getByTestId('ground-added')).toHaveText('Added Attention as generosity to the grounds.');
  await expect(page.getByTestId('frontmatter')).toContainText('weil-attention');
  await page.goto('/#/proposals');
  await expect(set1.getByRole('heading', { level: 3 })).toContainText('2 open');
  await set1.getByTestId('toggle-decided').click();
  const decided = set1.getByTestId('decided-ps-g8xw').locator('li').filter({ hasText: 'Ground courage-before-comfort in this passage' });
  await expect(decided.getByTestId('status')).toHaveText('accepted');
  await expect(decided.getByTestId('ground-of')).toHaveText('Courage before comfort');
  // the amendment opens the principle's editor; the principle proposal writes into Set 1
  const amendment = set1.locator('article.proposal').filter({ hasText: 'Reword attention-is-generosity' });
  await expect(amendment.getByTestId('accept')).toHaveText('Accept and edit the principle');
  const principle = set1.locator('article.proposal').filter({ hasText: 'Hold to this' });
  await principle.getByTestId('write-as-proposed').click();
  await expect(set1.getByRole('heading', { level: 3 })).toContainText('1 open');
  await page.goto('/#/sets');
  await page.getByTestId('set-ps-g8xw').getByTestId('set-toggle').click();
  await expect(page.getByTestId('principles-ps-g8xw').locator('li a.title')).toHaveCount(3);
  await page.goto('/#/settings');
  await expect(page.getByTestId('refusal-count')).toHaveText('0 refusals');
});

test('a reply the set cannot take is refused beside the button, and a source picked by search relates to Set 2', async ({ page }) => {
  await page.goto('/#/reason');
  await page.getByTestId('task').selectOption('relate-set');
  await expect(page.getByTestId('budget-note')).toHaveText('Pick at least one source.');
  await expect(page.getByTestId('relate-set')).toBeDisabled();
  // aurelius-meditations-4-3 already grounds Set 1's first principle; the demo model proposes it again and the parser refuses
  await page.getByTestId('derive-search').fill('retire');
  await page.getByTestId('derive-pick-aurelius-meditations-4-3').check();
  await expect(page.getByTestId('budget-note')).toHaveText(/1 passage fits the budget/);
  await page.getByTestId('relate-set').click();
  await expect(page.getByTestId('derive-error')).toContainText('already lists aurelius-meditations-4-3');
  await expect(page).toHaveURL(/#\/reason$/);
  // a source that grounds nothing in Set 1 instead: the chips and the search swap it in
  await page.getByTestId('derive-drop-aurelius-meditations-4-3').click();
  await page.getByTestId('derive-search').fill('didion');
  await page.getByTestId('derive-pick-didion-why-i-write').check();
  await expect(page.getByTestId('derive-chosen')).toContainText("To find out what I'm thinking");
  await expect(page.getByTestId('derive-chosen')).not.toContainText('Retire into thyself');
  await expect(page.getByTestId('relate-set-target')).toHaveValue('ps-g8xw');
  await page.getByTestId('relate-set').click();
  await expect(page).toHaveURL(/#\/proposals\?related=3&from=didion-why-i-write&set=ps-g8xw$/);
  await expect(page.getByTestId('related')).toContainText("3 proposals for Set 1 from To find out what I'm thinking");
  await expect(page.getByTestId('group-ps-g8xw').getByRole('heading', { level: 3 })).toContainText('3 open');
  await page.goto('/#/settings');
  await expect(page.getByTestId('refusal-count')).toHaveText('0 refusals');
});
