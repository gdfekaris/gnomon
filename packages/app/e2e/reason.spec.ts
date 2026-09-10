import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByTestId('use-demo').click();
  await expect(page.getByText('Connected: demo brain')).toBeVisible();
  await page.goto('/#/reason');
});

test('reason from two sets with the demo model: budget bar, set-attributed answer, precedence, resolving citations', async ({ page }) => {
  await expect(page.getByTestId('chip-ps-g8xw')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('chip-ps-7k2m')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('provider')).toHaveValue('mock');
  await expect(page.getByTestId('model')).toContainText('Demo model');
  await expect(page.getByTestId('budget-note')).toContainText('4 principles and 3 of 3 grounding passages fit the budget');
  await expect(page.getByTestId('send')).toBeDisabled();
  await page.getByTestId('input').fill('Should I start with the hard part?');
  await expect(page.getByTestId('send')).toBeEnabled();
  await page.getByTestId('send').click();

  const answer = page.getByTestId('turn-assistant');
  await expect(answer).toContainText('Reasoning from each set separately: Set 1, Set 2 — Work.');
  await expect(answer).toContainText('invoking precedence');
  await expect(answer).toContainText('3 citations');
  await expect(page.getByTestId('turn-user')).toContainText('Reason from my principles · Set 1, Set 2 — Work');
  await expect(page.getByTestId('input')).toHaveValue('');

  await answer.getByRole('link', { name: 'Courage before comfort' }).click();
  await expect(page).toHaveURL(/#\/browse\/principles\/ps-g8xw\/courage-before-comfort\.md$/);
  await expect(page.getByRole('heading', { name: 'Courage before comfort' })).toBeVisible();
});

test('deselecting a set narrows the budget note, compare needs no input, and the selection is remembered', async ({ page }) => {
  await page.getByTestId('chip-ps-g8xw').click();
  await expect(page.getByTestId('chip-ps-g8xw')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('budget-note')).toContainText('2 principles and 2 of 2 grounding passages');
  await page.getByTestId('task').selectOption('compare');
  await expect(page.getByTestId('input')).toHaveCount(0);
  await expect(page.getByTestId('send')).toBeEnabled();
  await page.getByTestId('send').click();
  await expect(page.getByTestId('turn-assistant')).toContainText('governing premise');
  await expect(page.getByTestId('turn-assistant')).not.toContainText('Reasoning from each set separately');

  await page.reload();
  await expect(page.getByTestId('chip-ps-g8xw')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('chip-ps-7k2m')).toHaveAttribute('aria-pressed', 'true');
});

test('an empty set is refused before anything is sent', async ({ page }) => {
  await page.goto('/#/sets');
  await page.getByTestId('new-set').click();
  await page.goto('/#/reason');
  // every set is selected by default; leave only the new, empty Set 3
  await page.getByTestId('chip-ps-g8xw').click();
  await page.getByTestId('chip-ps-7k2m').click();
  await expect(page.getByTestId('set-picker').locator('button[aria-pressed="true"]')).toHaveCount(1);
  await expect(page.getByTestId('budget-note')).toContainText('has no principles');
  await expect(page.getByTestId('send')).toBeDisabled();
});

test('relate a text with the demo model and save its proposal as yours (block 5)', async ({ page }) => {
  await page.getByTestId('task').selectOption('relate');
  await page.getByTestId('input').fill('Attention is a form of prayer. Everything else follows.');
  await page.getByTestId('send').click();
  const answer = page.getByTestId('turn-assistant');
  await expect(answer).toContainText('Proposal');
  await expect(answer).toContainText('Kind: principle');
  await expect(answer).toContainText('principle for ps-g8xw');
  await answer.getByTestId('save-proposal').click();
  const form = page.getByTestId('proposal-form');
  await expect(form.getByTestId('proposal-kind')).toHaveValue('principle');
  await expect(form.getByTestId('proposal-set')).toHaveValue('ps-g8xw');
  await expect(form.getByTestId('proposal-title')).toHaveValue('Attention is a form of prayer');
  await expect(form.getByTestId('proposal-grounds')).toHaveValue('aurelius-meditations-4-3');
  await form.getByTestId('proposal-save').click();
  const saved = answer.getByTestId('proposal-saved');
  await expect(saved).toContainText(/Saved as P-\d{8}-\d{3}, open and yours/);
  const id = (await saved.locator('code').textContent())!;

  await saved.getByRole('link', { name: 'Open Proposals' }).click();
  const group = page.getByTestId('group-ps-g8xw');
  await expect(group.getByRole('heading', { level: 3 })).toContainText('Set 1 · 1 open');
  const card = group.getByTestId(`proposal-${id}`);
  await expect(card).toContainText('Attention is a form of prayer');
  await expect(card).toContainText('yours');
  await expect(card).toContainText('Grounds: aurelius-meditations-4-3');
  await expect(card.getByTestId('accept')).toHaveText('Accept and write it');
});
