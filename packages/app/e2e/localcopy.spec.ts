// The copy of the brain on the device (spec §6.6) and the capture that is
// never lost (spec §14), against the fake GitHub: a second launch opens
// from the copy and reads no file again, opens with GitHub unreachable,
// keeps what was typed and what was queued across a relaunch, and fetches
// only what another device changed.
import { type Page, expect, test } from '@playwright/test';
import { FakeGitHub, readBrainBytes, serveGitHub } from './github-fake';

async function connect(page: Page, gh: FakeGitHub) {
  const bridge = await serveGitHub(page, gh);
  await page.goto('/#/settings');
  await page.getByTestId('git-owner').fill('octocat');
  await page.getByTestId('git-name').fill('brain');
  await page.getByTestId('git-token').fill('test-token');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByText('Connected: octocat/brain')).toBeVisible();
  await expect(page.getByTestId('diagnostics')).toContainText(/octocat\/brain, at [0-9a-f]{7}/);
  return bridge;
}
const reads = (gh: FakeGitHub) => gh.requests.filter((r) => r.path === '/graphql').length;
const NOTES = 'sources/weil-attention/notes.md';

test('a second launch opens from the copy, reads no file again, and then fetches only what changed elsewhere', async ({ page }) => {
  const gh = await FakeGitHub.create(readBrainBytes());
  await connect(page, gh);
  await expect(page.getByTestId('copy-diag')).toContainText('from the repository');
  expect(reads(gh)).toBeGreaterThan(0);

  gh.requests.length = 0;
  await page.goto('/#/capture');
  await page.reload();
  await expect(page.getByTestId('capture-text')).toBeVisible();
  await page.goto('/#/settings');
  await expect(page.getByTestId('copy-diag')).toContainText('from the copy');
  await expect(page.getByTestId('copy-diag')).toContainText('checked against the repository');
  expect(reads(gh)).toBe(0);

  const text = new TextDecoder().decode(readBrainBytes().get(NOTES)!);
  await gh.externalCommit({ [NOTES]: `${text.trimEnd()}\n\nAdded on the desktop.\n` });
  gh.requests.length = 0;
  await page.reload();
  await page.goto(`/#/browse/${NOTES}`);
  await expect(page.getByTestId('file-body')).toContainText('Added on the desktop.');
  expect(reads(gh)).toBe(1);
});

test('with GitHub unreachable the app still opens, a capture waits across a relaunch, and it is saved when GitHub is back', async ({ page }) => {
  const gh = await FakeGitHub.create(readBrainBytes());
  const bridge = await connect(page, gh);
  const before = gh.commits.size;

  bridge.down = true;
  await page.goto('/#/capture');
  await page.reload();
  await expect(page.getByTestId('capture-text')).toBeVisible();
  await page.goto('/#/browse/sources/weil-attention/raw.md');
  await expect(page.getByTestId('file-body')).toBeVisible();
  await page.goto('/#/settings');
  await expect(page.getByTestId('copy-diag')).toContainText('in use, not yet checked');

  await page.goto('/#/capture');
  await page.getByTestId('capture-text').fill('Captured in the tunnel.');
  await page.getByTestId('capture-note').fill('Weil, p. 3');
  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('queued')).toContainText('One capture is waiting');
  await expect(page.getByTestId('capture-text')).toHaveValue('');
  expect(gh.commits.size).toBe(before);

  // The app is closed and opened again, still without GitHub: the capture is still waiting.
  await page.reload();
  await expect(page.getByTestId('queued-item')).toContainText('Captured in the tunnel.');

  bridge.down = false;
  await page.reload();
  await expect(page.getByTestId('saved')).toBeVisible();
  await expect(page.getByTestId('queued')).toHaveCount(0);
  const stem = (await page.getByTestId('saved').locator('code').textContent())!;
  expect([...gh.commits.values()].map((c) => c.message)).toContain(`Capture: ${stem}`);
  await page.goto(`/#/browse/inbox/${stem}.md`);
  await expect(page.getByTestId('file-body')).toContainText('Captured in the tunnel.');
});

test('what is typed on Capture survives leaving the screen and a relaunch, until it is saved or cleared', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByTestId('use-demo').click();
  await expect(page.getByText('Connected: demo brain')).toBeVisible();
  await page.goto('/#/capture');
  await page.getByTestId('capture-text').fill('Half a thought');
  await page.getByTestId('capture-note').fill('p. 12');
  await page.goto('/#/inbox');
  await page.goto('/#/capture');
  await expect(page.getByTestId('capture-text')).toHaveValue('Half a thought');
  await page.reload();
  await expect(page.getByTestId('capture-text')).toHaveValue('Half a thought');
  await expect(page.getByTestId('capture-note')).toHaveValue('p. 12');

  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('saved')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('capture-text')).toHaveValue('');
});

test('Paste fills the passage from the clipboard', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'only Chromium lets a test grant the clipboard');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/#/settings');
  await page.getByTestId('use-demo').click();
  await expect(page.getByText('Connected: demo brain')).toBeVisible();
  await page.goto('/#/capture');
  await page.evaluate(() => navigator.clipboard.writeText('Attention is the rarest and purest form of generosity.'));
  await page.getByTestId('capture-paste').click();
  await expect(page.getByTestId('capture-text')).toHaveValue('Attention is the rarest and purest form of generosity.');
  await page.getByTestId('capture-paste').click();
  await expect(page.getByTestId('capture-text')).toHaveValue('Attention is the rarest and purest form of generosity.\n\nAttention is the rarest and purest form of generosity.');
});

test('a save reports its time, and disconnecting drops the copy from the device', async ({ page }) => {
  const gh = await FakeGitHub.create(readBrainBytes());
  await connect(page, gh);
  await page.goto('/#/capture');
  await page.getByTestId('capture-text').fill('Timed.');
  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('saved')).toBeVisible();
  await page.goto('/#/settings');
  await expect(page.getByTestId('copy-diag')).toContainText(/Last save: \d+ ms/);
  const held = () => page.evaluate(() => new Promise<number>((resolve) => {
    const open = indexedDB.open('gnomon-copy');
    open.onsuccess = () => {
      const count = open.result.transaction('kv').objectStore('kv').count();
      count.onsuccess = () => resolve(count.result);
    };
  }));
  expect(await held()).toBeGreaterThan(10);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect.poll(held).toBe(0);
});

test('a saved connection whose token GitHub rejects says so at launch, on the screen and in About, and connects again once the token works', async ({ page }) => {
  const gh = await FakeGitHub.create(readBrainBytes());
  const bridge = await connect(page, gh);

  // no copy on the device, so launch has to ask GitHub, which refuses the token
  // With a copy on the device the brain still opens, and a banner says the repository refused the check.
  bridge.rejectToken = true;
  await page.goto('/#/capture');
  await page.reload();
  await expect(page.getByTestId('capture-text')).toBeVisible();
  await expect(page.getByTestId('check-error')).toContainText('GitHub rejected the token');

  // With no copy, launch has to ask GitHub, and the screen says why it is not connected.
  await page.evaluate(() => new Promise<void>((resolve) => {
    const open = indexedDB.open('gnomon-copy');
    open.onsuccess = () => {
      const clear = open.result.transaction('kv', 'readwrite').objectStore('kv').clear();
      clear.onsuccess = () => resolve();
    };
  }));
  await page.reload();
  await expect(page.getByTestId('connect-error')).toContainText('Could not connect to octocat/brain: GitHub rejected the token');
  await page.goto('/#/settings');
  await expect(page.getByTestId('diagnostics')).toContainText('none connected, the saved connection failed: GitHub rejected the token');
  await expect(page.getByTestId('copy-diag')).toContainText('not in use, since no brain is connected');

  bridge.rejectToken = false;
  await page.goto('/#/capture');
  await page.getByTestId('connect-error').getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('connect-error')).toHaveCount(0);
  await expect(page.getByTestId('capture-text')).toBeVisible();
});
