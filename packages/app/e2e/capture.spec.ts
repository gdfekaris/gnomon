import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByTestId('use-demo').click();
  await expect(page.getByText('Connected: demo brain')).toBeVisible();
  await page.goto('/#/capture');
});

test('captures text with a note into the demo brain', async ({ page }) => {
  await page.getByTestId('capture-text').fill('Men seek retreats for themselves.');
  await page.getByTestId('capture-note').fill('from the phone');
  await page.getByTestId('capture-save').click();
  const saved = page.getByTestId('saved');
  await expect(saved).toBeVisible();
  const stem = (await saved.locator('code').textContent())!;
  expect(stem).toMatch(/^\d{8}-\d{6}-[23456789abcdefghjkmnpqrstuvwxyz]{3}$/);
  await expect(page.getByTestId('capture-text')).toHaveValue('');

  await page.getByRole('link', { name: 'Inbox', exact: true }).click();
  await expect(page.getByTestId('unfiled')).toContainText(stem);
  await expect(page.getByTestId('unfiled')).toContainText('from the phone');
  await page.getByRole('link', { name: 'Browse' }).click();
  await expect(page.getByText('25 files')).toBeVisible();
});

test('captures text with a PDF attachment', async ({ page }) => {
  await page.getByTestId('capture-text').fill('A scanned page.');
  await page.getByTestId('capture-file').setInputFiles({ name: 'Scan.PDF', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') });
  await expect(page.getByText('Scan.PDF ·')).toBeVisible();
  await page.getByTestId('capture-save').click();
  const saved = page.getByTestId('saved');
  await expect(saved).toContainText('with its attachment');
  const stem = (await saved.locator('code').textContent())!;

  await page.getByRole('link', { name: 'Inbox', exact: true }).click();
  await expect(page.getByTestId('unfiled')).toContainText(`${stem} · attachment`);
});

test('the save button waits for text', async ({ page }) => {
  await expect(page.getByTestId('capture-save')).toBeDisabled();
  await page.getByTestId('capture-text').fill('x');
  await expect(page.getByTestId('capture-save')).toBeEnabled();
});
