import { expect, test } from '@playwright/test';

test('the shell loads the demo brain and lists its contents', async ({ page }) => {
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.getByTestId('use-demo').click();
  await expect(page.getByText('Connected: demo brain')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.getByRole('link', { name: 'Browse' }).click();
  await expect(page.getByTestId('sources')).toContainText('sources/didion-why-i-write/raw.md');
  await expect(page.getByTestId('sources')).toContainText('agent-proposed');
  await expect(page.getByText('24 files')).toBeVisible();
  await page.getByRole('link', { name: 'Sets' }).click();
  await expect(page.getByRole('heading', { name: 'Set 1', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Set 2 — Work' })).toBeVisible();
  await expect(page.getByTestId('set-ps-7k2m')).toContainText('Say the hard thing first');
  await page.getByRole('link', { name: 'Proposals' }).click();
  await expect(page.getByTestId('proposal-P-20260905-003')).toBeVisible();
});

test('the demo connection survives a reload through on-device settings', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByTestId('use-demo').click();
  await expect(page.getByText('Connected: demo brain')).toBeVisible();
  await page.goto('/#/browse');
  await page.reload();
  await expect(page.getByText('24 files')).toBeVisible();
});

test('the first run lands on onboarding; once a brain is connected the default route is Capture', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to Gnomon' })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await page.getByTestId('onboard-demo').click();
  await expect(page.getByRole('heading', { name: 'Capture' })).toBeVisible();
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Capture' })).toBeVisible();
  await expect(page.getByTestId('capture-text')).toBeVisible();
});
