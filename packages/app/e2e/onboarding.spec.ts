import { expect, test } from '@playwright/test';
import { FakeGitHub, readBrainBytes, serveGitHub } from './github-fake';

const messages = (gh: FakeGitHub) => [...gh.commits.values()].map((c) => c.message);

test('from nothing to a connected, valid brain that lands on Capture (US-14, US-16)', async ({ page }) => {
  const gh = new FakeGitHub('nobody', 'nothing');
  await serveGitHub(page, gh);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to Gnomon' })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);

  await page.getByTestId('onboard-create').click();
  await expect(page.getByTestId('onboard-step')).toHaveText('Step 1 of 5');
  const steps = page.getByTestId('token-steps');
  await expect(steps).toContainText('All repositories');
  await expect(steps).toContainText('"Administration" to "Read and write"');
  await page.getByRole('tab', { name: /Classic token/ }).click();
  await expect(steps).toContainText('Tick the box named "repo"');
  await expect(steps).not.toContainText('Administration');

  // A wrong token is explained and kept in the field.
  await page.getByTestId('onboard-token').fill('nope');
  await page.getByTestId('onboard-go').click();
  await expect(page.getByRole('alert')).toContainText('GitHub rejected the token');
  await expect(page.getByTestId('onboard-token')).toHaveValue('nope');

  // A token that may not create repositories is explained at creation and nothing is left behind.
  gh.canCreate = false;
  await page.getByTestId('onboard-token').fill('test-token');
  await page.getByTestId('onboard-go').click();
  await expect(page.getByRole('alert')).toContainText('would not let this token create a repository');
  await expect(page.getByTestId('onboard-token')).toHaveValue('test-token');
  expect(gh.commits.size).toBe(0);

  gh.canCreate = true;
  await page.getByTestId('onboard-name').fill('brain');
  await page.getByTestId('onboard-go').click();
  await expect(page.getByTestId('created')).toContainText('octocat/brain');
  await expect(page.getByTestId('onboard-step')).toHaveText('Step 2 of 5');
  await expect(page.getByTestId('validation')).toContainText('The brain is valid and its indexes are current.');
  expect(messages(gh).sort()).toEqual(['Initial commit', 'Scaffold: template']);

  await page.getByTestId('onboard-next').click();
  await expect(page.getByRole('heading', { name: 'Who can see what' })).toBeVisible();
  await expect(page.getByText('Nobody else.')).toBeVisible();

  // The optional swap validates the new token against the repository it now knows.
  await page.getByTestId('onboard-next').click();
  await expect(page.getByRole('heading', { name: /Narrow the token/ })).toBeVisible();
  gh.readOnly = true;
  await page.getByTestId('swap-token').fill('test-token');
  await page.getByTestId('swap-go').click();
  await expect(page.getByRole('alert')).toContainText('can read octocat/brain but not write');
  gh.readOnly = false;
  await page.getByTestId('swap-go').click();
  await expect(page.getByTestId('swapped')).toBeVisible();

  await page.getByTestId('onboard-next').click();
  await expect(page.getByText('Add to Home Screen', { exact: true })).toBeVisible();
  await page.getByTestId('onboard-finish').click();
  await expect(page).toHaveURL(/#\/capture$/);
  await expect(page.getByRole('heading', { name: 'Capture' })).toBeVisible();
  await expect(page.getByRole('navigation')).toBeVisible();

  // The connection is real: a capture lands in the new repository.
  await page.getByTestId('capture-text').fill('The first passage.');
  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('saved')).toBeVisible();
  expect(messages(gh).some((m) => m.startsWith('Capture: '))).toBe(true);

  // And it survives a reload through on-device settings.
  await page.reload();
  await expect(page.getByTestId('capture-text')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome to Gnomon' })).toHaveCount(0);
});

test('connecting an existing brain shows its validation results and adds what is missing (US-15)', async ({ page }) => {
  const seed = readBrainBytes();
  seed.delete('AGENTS.md');
  const gh = await FakeGitHub.create(seed);
  await serveGitHub(page, gh);
  await page.goto('/#/onboarding');
  await page.getByTestId('onboard-connect').click();
  await expect(page.getByTestId('onboard-step')).toHaveText('Step 1 of 4');
  await expect(page.getByTestId('token-steps')).toContainText('Only select repositories');

  await page.getByTestId('onboard-owner').fill('octocat');
  await page.getByTestId('onboard-name').fill('elsewhere');
  await page.getByTestId('onboard-token').fill('test-token');
  await page.getByTestId('onboard-go').click();
  await expect(page.getByRole('alert')).toContainText('cannot see octocat/elsewhere');

  await page.getByTestId('onboard-name').fill('brain');
  gh.readOnly = true;
  await page.getByTestId('onboard-go').click();
  await expect(page.getByRole('alert')).toContainText('can read octocat/brain but not write');
  gh.readOnly = false;
  await page.getByTestId('onboard-go').click();

  await expect(page.getByRole('heading', { name: 'Connected' })).toBeVisible();
  const panel = page.getByTestId('validation');
  await expect(panel.getByTestId('refusal-count')).toHaveText('1 refusal');
  await expect(panel.getByTestId('refusals')).toContainText('AGENTS.md');
  await panel.getByTestId('offer-AGENTS.md').click();
  await expect(panel).toContainText('The brain is valid and its indexes are current.');
  expect(messages(gh)).toContain('Scaffold: AGENTS.md');

  await page.getByTestId('onboard-next').click();
  await expect(page.getByRole('heading', { name: 'Who can see what' })).toBeVisible();
  await page.getByTestId('onboard-next').click();
  await expect(page.getByRole('heading', { name: 'Put it on your Home Screen' })).toBeVisible();
  await page.getByTestId('onboard-finish').click();
  await expect(page.getByRole('heading', { name: 'Capture' })).toBeVisible();
  await page.goto('/#/browse');
  await expect(page.getByText('24 files')).toBeVisible();
});

test('a device that lost its token re-onboards to the token step only (spec §10.3)', async ({ page }) => {
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  // idb-keyval's default store; the prefs say "github" but the token and repository are gone.
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('keyval-store', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('keyval');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('keyval', 'readwrite');
      tx.objectStore('keyval').put({ mode: 'github' }, 'prefs');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  }));
  await page.goto('/#/capture');
  await page.reload();
  await expect(page.getByTestId('evicted')).toBeVisible();
  await expect(page.getByTestId('onboard-owner')).toBeVisible();
  await expect(page.getByTestId('onboard-step')).toHaveText('Step 1 of 4');
});
