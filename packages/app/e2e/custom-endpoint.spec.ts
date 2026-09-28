import { expect, test } from '@playwright/test';

// Spec §15: a model endpoint the user runs, only in a build that opted in. The app's own deployment never opts in.

const SELF_BUILD = 'http://localhost:5174';

test('the default build offers no custom endpoint and says so in About', async ({ page }) => {
  await page.goto('/#/settings');
  await expect(page.getByTestId('custom-endpoint-build')).toHaveText('Custom model endpoint: not enabled in this build.');
  await expect(page.getByTestId('custom-url')).toHaveCount(0);
});

test.describe('a build with the endpoint on its own server', () => {
  test.use({ baseURL: SELF_BUILD });

  test('save an endpoint, refuse one elsewhere, and reason through "Your model" with its key', async ({ page }) => {
    const seen: Array<{ url: string; auth: string | undefined; body?: unknown }> = [];
    await page.route(`${SELF_BUILD}/v1/models`, async (route) => {
      seen.push({ url: route.request().url(), auth: route.request().headers()['authorization'] });
      await route.fulfill({ json: { object: 'list', data: [{ id: 'qwen3:30b', object: 'model' }] } });
    });
    await page.route(`${SELF_BUILD}/v1/chat/completions`, async (route) => {
      seen.push({ url: route.request().url(), auth: route.request().headers()['authorization'], body: route.request().postDataJSON() });
      const chunk = (content: string) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`;
      await route.fulfill({
        headers: { 'content-type': 'text/event-stream' },
        body: chunk('From your own model: ') + chunk('Set 1 says courage before comfort.') + `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
      });
    });

    await page.goto('/#/settings');
    await page.getByTestId('use-demo').click();
    await expect(page.getByText('Connected: demo brain')).toBeVisible();
    await expect(page.getByTestId('custom-endpoint-build')).toHaveText('Custom model endpoint: enabled, on this app\'s own server.');

    // An address on another server is refused beside the button, and nothing is saved.
    await page.getByTestId('custom-url').fill('https://elsewhere.example.com/v1');
    await page.getByTestId('custom-save').click();
    await expect(page.getByTestId('custom-error')).toHaveText(`This build allows only an endpoint on its own server, ${SELF_BUILD}.`);

    await page.getByTestId('custom-url').fill(`${SELF_BUILD}/v1`);
    await page.getByTestId('custom-key').fill('model-key-1');
    await page.getByTestId('custom-window').fill('32768');
    await page.getByTestId('custom-save').click();
    await expect(page.getByTestId('custom-error')).toHaveCount(0);
    await expect(page.getByText('Saved on this device.').last()).toBeVisible();

    await page.goto('/#/reason');
    await page.getByTestId('provider').selectOption('custom');
    await expect(page.getByTestId('provider').locator('option:checked')).toHaveText('Your model');
    await expect(page.getByTestId('model')).toContainText('qwen3:30b');
    await expect(page.getByTestId('budget-note')).toContainText('fit the budget');
    await page.getByTestId('input').fill('Should I start with the hard part?');
    await page.getByTestId('send').click();
    await expect(page.getByTestId('turn-assistant')).toContainText('From your own model: Set 1 says courage before comfort.');

    const call = seen.find((c) => c.url.endsWith('/chat/completions'))!;
    expect(call.auth).toBe('Bearer model-key-1');
    expect((call.body as { model: string }).model).toBe('qwen3:30b');
    expect(seen.find((c) => c.url.endsWith('/models'))!.auth).toBe('Bearer model-key-1');

    // Survives a relaunch: the endpoint is saved on the device like the other keys.
    await page.reload();
    await page.goto('/#/settings');
    await expect(page.getByTestId('custom-url')).toHaveValue(`${SELF_BUILD}/v1`);
  });
});
