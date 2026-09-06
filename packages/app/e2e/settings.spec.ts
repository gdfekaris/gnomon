import { expect, test } from '@playwright/test';

test('connect-existing shows refusals and warnings and adds each missing scaffold item as its own commit', async ({ page }) => {
  await page.goto('/#/settings?demo-omit=AGENTS.md,templates/raw.md,sources/weil-attention/raw.md');
  await page.getByTestId('use-demo').click();
  await expect(page.getByText('Connected: demo brain')).toBeVisible();
  const panel = page.getByTestId('validation');
  await expect(panel.getByTestId('refusal-count')).toHaveText('3 refusals');
  await expect(panel.getByTestId('warning-count')).toHaveText('1 warning');
  await expect(panel.getByTestId('refusals')).toContainText('AGENTS.md');
  await expect(panel.getByTestId('refusals')).toContainText('fix by hand');
  await expect(panel.getByTestId('warnings')).toContainText('grounds.dangling');

  await panel.getByTestId('offer-AGENTS.md').click();
  await expect(panel.getByTestId('refusal-count')).toHaveText('2 refusals');
  await panel.getByTestId('offer-templates/raw.md').click();
  await expect(panel.getByTestId('refusal-count')).toHaveText('1 refusal');
  await expect(panel.getByTestId('refusals')).toContainText('source.missing-raw');
  await expect(panel.getByTestId('refusals').locator('button')).toHaveCount(0);

  await page.goto('/#/browse/AGENTS.md');
  await expect(page.getByText('No file at')).toBeVisible(); // exempt files are not brain files; they are simply present
  await page.goto('/#/browse');
  await expect(page.getByText('23 files')).toBeVisible(); // the omitted raw.md is gone; scaffold files are exempt and uncounted
});

test('a clean brain reports valid, and the indexes offer appears when they are stale', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByTestId('use-demo').click();
  await expect(page.getByTestId('validation')).toContainText('The brain is valid and its indexes are current.');

  await page.goto('/#/settings?demo-omit=maps/_index.md');
  await page.getByTestId('use-demo').click();
  await expect(page.getByTestId('offer-indexes')).toBeVisible();
  await page.getByTestId('offer-indexes').click();
  await expect(page.getByTestId('validation')).toContainText('The brain is valid and its indexes are current.');
});

test('provider keys, budget, and theme persist on the device', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByTestId('key-anthropic').fill('sk-ant-test');
  await page.getByTestId('save-keys').click();
  await expect(page.getByText('Saved on this device.')).toBeVisible();
  await page.getByTestId('budget').fill('40');
  await page.getByTestId('theme').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.reload();
  await expect(page.getByTestId('key-anthropic')).toHaveValue('sk-ant-test');
  await expect(page.getByText('Context budget: 40%')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByTestId('theme').selectOption('system');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
});

test('a bad GitHub connection explains itself', async ({ page }) => {
  // The driver sends custom headers, so the browser preflights; the mock must answer OPTIONS too.
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  await page.route('https://api.github.com/**', (r) =>
    r.request().method() === 'OPTIONS'
      ? r.fulfill({ status: 204, headers: cors })
      : r.fulfill({ status: 401, contentType: 'application/json', headers: cors, body: '{"message":"Bad credentials"}' }),
  );
  await page.goto('/#/settings');
  await page.getByTestId('git-owner').fill('octocat');
  await page.getByTestId('git-name').fill('brain');
  await page.getByTestId('git-token').fill('nope');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('GitHub rejected the token');
});
