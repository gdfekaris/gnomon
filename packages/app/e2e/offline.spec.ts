import { expect, test } from '@playwright/test';

test('offline, a text capture waits in memory and saves when the connection returns', async ({ page, context }) => {
  await page.goto('/#/settings');
  await page.getByTestId('use-demo').click();
  await expect(page.getByText('Connected: demo brain')).toBeVisible();
  await page.goto('/#/capture');

  await context.setOffline(true);
  await expect(page.getByTestId('offline')).toBeVisible();
  await expect(page.getByTestId('capture-save')).toHaveText('Keep until online');
  await page.getByTestId('capture-text').fill('Written on the train.');
  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('queued')).toBeVisible();
  await expect(page.getByTestId('capture-text')).toHaveValue('');

  await page.getByTestId('capture-text').fill('A second one.');
  await page.getByTestId('capture-save').click();
  await expect(page.getByRole('alert')).toContainText('already waiting');

  await context.setOffline(false);
  await expect(page.getByTestId('saved')).toBeVisible();
  await expect(page.getByTestId('queued')).toHaveCount(0);
  const stem = (await page.getByTestId('saved').locator('code').textContent())!;
  await page.goto('/#/inbox');
  await expect(page.getByTestId('unfiled')).toContainText(stem);
  await page.goto(`/#/browse/inbox/${stem}.md`);
  await expect(page.getByTestId('file-body')).toContainText('Written on the train.');
});

test('offline, an attachment is refused rather than queued', async ({ page, context }) => {
  await page.goto('/#/settings');
  await page.getByTestId('use-demo').click();
  await expect(page.getByText('Connected: demo brain')).toBeVisible();
  await page.goto('/#/capture');
  await context.setOffline(true);
  await page.getByTestId('capture-text').fill('With a file.');
  await page.getByTestId('capture-file').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: Buffer.from([1, 2, 3]) });
  await page.getByTestId('capture-save').click();
  await expect(page.getByRole('alert')).toContainText('Attachments are not queued');
  await expect(page.getByTestId('capture-text')).toHaveValue('With a file.');
});
