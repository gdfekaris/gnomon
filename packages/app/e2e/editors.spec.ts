import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByTestId('use-demo').click();
  await expect(page.getByText('Connected: demo brain')).toBeVisible();
});

test('write a principle from the editor with a grounding link from the picker', async ({ page }) => {
  await page.goto('/#/sets');
  await page.getByTestId('set-ps-7k2m').getByTestId('new-principle').click();
  await expect(page.getByRole('heading', { name: 'New principle in Set 2 — Work' })).toBeVisible();
  await page.getByTestId('edit-title').fill('Rise to the work');
  await page.getByTestId('edit-body').fill('Get up; the work is what you are for.');
  await page.getByTestId('link-picker').selectOption('aurelius-meditations-5-1');
  await page.getByTestId('link-insert').click();
  await expect(page.getByTestId('ground-aurelius-meditations-5-1')).toBeVisible();
  await expect(page.getByTestId('edit-body')).toHaveValue(/\[\[sources\/aurelius-meditations-5-1\/raw\]\] \(\[raw\]\(\.\.\/\.\.\/sources\/aurelius-meditations-5-1\/raw\.md\)\)/);
  await expect(page.getByTestId('drift')).toHaveCount(0);
  await page.getByTestId('edit-tags').fill('Stoicism, work');
  await page.getByTestId('edit-save').click();

  await expect(page).toHaveURL(/#\/browse\/principles\/ps-7k2m\/rise-to-the-work\.md$/);
  await expect(page.getByRole('heading', { name: 'Rise to the work' })).toBeVisible();
  await expect(page.getByTestId('frontmatter')).toContainText('3');
  await expect(page.getByTestId('file-body').locator('a')).toHaveCount(1);
  await expect(page.getByTestId('backlinks')).toHaveCount(1);
  await page.goto('/#/settings');
  await expect(page.getByTestId('validation')).toContainText('The brain is valid and its indexes are current.');
});

test('grounds drift is flagged and synced in either direction', async ({ page }) => {
  await page.goto('/#/edit/principles/ps-g8xw/courage-before-comfort.md');
  await expect(page.getByRole('heading', { name: 'Edit principle' })).toBeVisible();
  await expect(page.getByTestId('drift')).toHaveCount(0);
  // grounds only: remove the link from the body
  const body = await page.getByTestId('edit-body').inputValue();
  await page.getByTestId('edit-body').fill(body.split('**Grounding passages:**')[0]!.trim());
  await expect(page.getByTestId('drift')).toContainText('In grounds only: aurelius-meditations-4-3');
  await page.getByTestId('sync-body').click();
  await expect(page.getByTestId('drift')).toHaveCount(0);
  await expect(page.getByTestId('edit-body')).toHaveValue(/\[\[sources\/aurelius-meditations-4-3\/raw\]\]/);
  // body only: remove the chip
  await page.getByTestId('ground-aurelius-meditations-4-3').getByRole('button').click();
  await expect(page.getByTestId('drift')).toContainText('Linked in the body only: aurelius-meditations-4-3');
  await page.getByTestId('sync-grounds').click();
  await expect(page.getByTestId('drift')).toHaveCount(0);
  await expect(page.getByTestId('ground-aurelius-meditations-4-3')).toBeVisible();
  await page.getByTestId('edit-save').click();
  await expect(page).toHaveURL(/courage-before-comfort\.md$/);
  await page.goto('/#/settings');
  await expect(page.getByTestId('validation')).toContainText('The brain is valid and its indexes are current.');
});

test('editing notes makes them human; source metadata edits keep the passage read-only', async ({ page }) => {
  await page.goto('/#/browse/sources/aurelius-meditations-5-1/notes.md');
  await expect(page.getByTestId('frontmatter')).toContainText('agent-proposed');
  await page.getByTestId('edit-link').click();
  await page.getByTestId('edit-body').fill('Compare the morning passage with 4.3.');
  await page.getByTestId('edit-save').click();
  await expect(page.getByTestId('frontmatter')).toContainText('human');
  await expect(page.getByTestId('file-body')).toContainText('Compare the morning passage with 4.3.');

  await page.goto('/#/browse/sources/didion-why-i-write/raw.md');
  await expect(page.getByText('the passage text is immutable')).toBeVisible();
  await page.getByTestId('edit-link').click();
  await expect(page.getByTestId('passage-readonly')).toContainText("I write entirely to find out what I'm thinking");
  await expect(page.getByTestId('edit-body')).toHaveCount(0);
  await page.getByTestId('edit-title').fill('Why I write');
  await page.getByTestId('edit-year').fill('1976');
  await page.getByTestId('edit-save').click();
  await expect(page.getByRole('heading', { name: 'Why I write' })).toBeVisible();
  await expect(page.getByTestId('frontmatter')).toContainText('human');
  await expect(page.getByTestId('file-body')).toContainText("I write entirely to find out what I'm thinking");

  await page.goto('/#/edit/sources/didion-why-i-write/original.pdf');
  await expect(page.getByText('Nothing editable at')).toBeVisible();
});
