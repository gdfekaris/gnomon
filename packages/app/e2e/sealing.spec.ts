// Sealing (spec §6.5; Phase 5 blocks S3 and S4). Keys, over the fake GitHub:
// set up with the recovery phrase, keep the device key across a relaunch (a
// non-extractable CryptoKey in IndexedDB, on each engine), enroll a desktop
// key from its request, revoke it, add a second device from the phrase.
// Seals: a capture sealed as it is saved, "Seal as mine and ratify",
// sealing the existing captures, and an agent's edit shown as broken.
import { type Browser, type Page, expect, test } from '@playwright/test';
import { makeRequest } from '@gnomon/core';
import { FakeGitHub, readBrainBytes, serveGitHub } from './github-fake';

const YUBIKEY = 'sk-ssh-ed25519@openssh.com AAAAGnNrLXNzaC1lZDI1NTE5QG9wZW5zc2guY29tAAAAIJsaDYXQYruc6bilCYDIK4YSOeG+zmrRO2M9t03//7LHAAAABHNzaDo=';
const messages = (gh: FakeGitHub) => [...gh.commits.values()].map((c) => c.message);

async function connect(page: Page, gh: FakeGitHub) {
  await serveGitHub(page, gh);
  await page.goto('/#/settings');
  await page.getByTestId('git-owner').fill('octocat');
  await page.getByTestId('git-name').fill('brain');
  await page.getByTestId('git-token').fill('test-token');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByText('Connected: octocat/brain')).toBeVisible();
  // The brain finishes loading after "Connected" shows, and the screen above Sealing grows when it does: wait, so a tap lands where it aims.
  await expect(page.getByTestId('diagnostics')).toContainText(/octocat\/brain, at [0-9a-f]{7}/);
}

/** Set up sealing through the screens; returns the 24 words and the fingerprint shown. */
async function setUp(page: Page): Promise<{ words: string[]; fingerprint: string }> {
  const panel = page.getByTestId('sealing');
  await panel.getByTestId('seal-begin').click();
  await expect(panel.getByTestId('seal-word')).toHaveCount(24);
  const words = await panel.getByTestId('seal-word').allTextContents();
  const fingerprint = (await panel.getByTestId('seal-root-fp').textContent())!;
  await panel.getByTestId('seal-written').click();
  const finish = panel.getByTestId('seal-finish');
  await expect(finish).toBeDisabled();
  const answers = panel.getByTestId('seal-answer');
  for (let i = 0; i < 3; i++) {
    const label = await answers.nth(i).locator('xpath=..').textContent();
    const n = Number(/Word (\d+)/.exec(label!)![1]);
    await answers.nth(i).fill(words[n - 1]!);
  }
  await panel.getByTestId('seal-label').fill('iPhone');
  await expect(finish).toBeEnabled();
  await finish.click();
  await expect(panel.getByTestId('seal-on')).toBeVisible();
  return { words, fingerprint };
}

test('set up sealing, keep the key across a relaunch, enroll a desktop key, revoke it', async ({ page }) => {
  const gh = await FakeGitHub.create(readBrainBytes());
  await connect(page, gh);
  await expect(page.getByTestId('seal-diag')).toHaveText(/Sealing off/);

  const { words, fingerprint } = await setUp(page);
  const panel = page.getByTestId('sealing');
  await expect(panel.getByTestId('seal-root')).toHaveText(fingerprint);
  await expect(panel.getByTestId('seal-words')).toHaveCount(0);
  expect(messages(gh)).toContain('Set up sealing');
  await expect(page.getByTestId('seal-diag')).toHaveText(/Sealing on; this device’s key is (Ed25519|ECDSA P-256)\./);

  // A relaunch keeps the device key: the IndexedDB record survives with its non-extractable CryptoKey.
  await page.reload();
  await page.goto('/#/settings');
  await expect(page.getByText('Connected: octocat/brain')).toBeVisible();
  await expect(panel.getByTestId('seal-on')).toBeVisible();
  await expect(panel.getByTestId('seal-key')).toHaveCount(1);

  // The desktop asks to be enrolled; the phone enrolls it with the phrase after comparing fingerprints.
  const req = await makeRequest({ pub: YUBIKEY, label: 'YubiKey', at: '2026-10-05T12:00:00Z' });
  await gh.externalCommit({ [req.path]: req.text });
  await page.reload();
  await page.goto('/#/settings');
  const request = panel.getByTestId('seal-request');
  await expect(request).toContainText('YubiKey');
  await request.getByTestId('seal-enroll-open').click();
  await request.getByTestId('seal-phrase').fill('abandon '.repeat(23) + 'art');
  await request.getByTestId('seal-phrase-go').click();
  await expect(request.getByTestId('seal-error')).toContainText('not this brain’s recovery phrase');
  await request.getByTestId('seal-phrase').fill(words.join(' '));
  await request.getByTestId('seal-phrase-go').click();
  await expect(panel.getByTestId('seal-request')).toHaveCount(0);
  await expect(panel.getByTestId('seal-key')).toHaveCount(2);
  expect(messages(gh)).toContain('Enroll key: YubiKey');

  // Revoke the YubiKey: the form says what stays valid.
  const yubi = panel.getByTestId('seal-key').filter({ hasText: 'YubiKey' });
  await yubi.getByTestId('seal-revoke-open').click();
  await expect(yubi.getByTestId('seal-revoke-point')).toContainText('made no seals');
  await yubi.getByTestId('seal-phrase').fill(words.join(' '));
  await yubi.getByTestId('seal-phrase-go').click();
  await expect(yubi.getByTestId('seal-revoked')).toBeVisible();
  expect(messages(gh)).toContain('Revoke key: YubiKey');
});

test('a second device adds itself from the phrase', async ({ page, browser }: { page: Page; browser: Browser }) => {
  const gh = await FakeGitHub.create(readBrainBytes());
  await connect(page, gh);
  const { words, fingerprint } = await setUp(page);

  const other = await (await browser.newContext()).newPage();
  await connect(other, gh);
  const panel = other.getByTestId('sealing');
  await expect(panel.getByTestId('seal-recover-state')).toContainText(fingerprint);
  await panel.getByTestId('seal-phrase').fill([...words.slice(1), words[0]].join(' '));
  await panel.getByTestId('seal-label').fill('Old phone');
  await panel.getByTestId('seal-recover').click();
  await expect(panel.getByTestId('seal-error')).toBeVisible();
  await panel.getByTestId('seal-phrase').fill(words.join('  '));
  await panel.getByTestId('seal-recover').click();
  await expect(panel.getByTestId('seal-on')).toBeVisible();
  await expect(panel.getByTestId('seal-key')).toHaveCount(2);
  expect(messages(gh)).toContain('Enroll key: Old phone');
  await other.context().close();
});

test('captures are sealed as they are saved; an unsealed filing is sealed as mine and ratified; existing captures are sealed once', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByTestId('use-demo').click();
  await expect(page.getByText('Connected: demo brain')).toBeVisible();
  await expect(page.getByTestId('diagnostics')).toContainText(/demo brain, at [0-9a-f]{7}/);
  await setUp(page);
  const panel = page.getByTestId('sealing');
  await expect(panel.getByTestId('seal-summary')).toContainText('0 sealed when captured, 0 sealed after the fact, 7 unsealed');
  await expect(panel.getByTestId('seal-uncapturable')).toContainText('1 source names no capture');
  await expect(panel.getByTestId('seal-backfill')).toHaveText('Seal existing captures (4)');

  // A capture saved now carries its seal.
  await page.goto('/#/capture');
  await page.getByTestId('capture-text').fill('Sealed the moment it was saved.');
  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('saved')).toBeVisible();
  await page.goto('/#/inbox');
  const unfiled = page.getByTestId('unfiled');
  await expect(unfiled.locator('li').filter({ hasText: '20260906-070000-2bq' }).getByTestId('seal-mark')).toHaveText('unsealed');
  await expect(unfiled.locator('li').filter({ hasNotText: '20260906-070000-2bq' }).getByTestId('seal-mark')).toHaveText('sealed');

  // Filing the old, unsealed capture: ratifying it seals the capture as mine first, on the panel that shows the passage.
  await unfiled.locator('li').filter({ hasNotText: '20260906-070000-2bq' }).locator('input[type=checkbox]').uncheck();
  await page.getByTestId('process').click();
  const filing = page.getByTestId('filing-unknown-the-only-way-to');
  await expect(filing.getByTestId('state')).toHaveText('awaiting review');
  await expect(filing.getByTestId('review-panel').getByTestId('seal-mark').first()).toHaveText('unsealed');
  await expect(filing.getByTestId('ratify-seal-first')).toBeVisible();
  await expect(filing.getByTestId('ratify')).toHaveText('Seal as mine and ratify');
  await filing.getByTestId('ratify').click();
  await expect(filing.getByTestId('state')).toHaveText('ratified');
  await page.goto('/#/browse/sources/unknown-the-only-way-to/raw.md');
  await expect(page.getByTestId('seal-mark')).toHaveText(/^sealed since /);

  // The rest, once.
  await page.goto('/#/settings');
  await panel.getByTestId('seal-backfill').click();
  await panel.getByTestId('seal-backfill-yes').click();
  await expect(panel.getByTestId('seal-done')).toHaveText(/Sealed \d+ captures? as they stand today\./);
  await expect(panel.getByTestId('seal-backfill')).toHaveCount(0);
  await expect(panel.getByTestId('seal-summary')).toContainText(', 0 unsealed');
  await expect(page.getByTestId('seal-banner')).toHaveCount(0);
});

test('an agent’s edit to a sealed passage shows as broken: a banner, the mark, and Reason leaves it out', async ({ page }) => {
  const gh = await FakeGitHub.create(readBrainBytes());
  await connect(page, gh);
  await setUp(page);
  const panel = page.getByTestId('sealing');
  await panel.getByTestId('seal-backfill').click();
  await panel.getByTestId('seal-backfill-yes').click();
  await expect(panel.getByTestId('seal-summary')).toContainText(', 0 unsealed');
  await expect(page.getByTestId('seal-banner')).toHaveCount(0);

  const RAW = 'sources/aurelius-meditations-4-3/raw.md';
  const head = gh.refs.get('heads/main')!;
  const blob = gh.trees.get(gh.commits.get(head)!.tree)!.get(RAW)!;
  const text = new TextDecoder().decode(gh.blobs.get(blob)!);
  await gh.externalCommit({ [RAW]: text.replace('Men seek retreats', 'Men seek comfort') });
  await page.reload();
  await page.goto(`/#/browse/${RAW}`);
  await expect(page.getByTestId('seal-banner')).toContainText('1 passage does not match its seal');
  await expect(page.getByTestId('seal-mark')).toHaveText('broken: its passage differs from the sealed capture');
  await page.goto('/#/reason');
  await expect(page.getByTestId('reason-left-out')).toContainText('it does not match its sealed capture: Retire into thyself');
  await page.goto('/#/settings');
  await expect(panel.getByTestId('seal-summary')).toContainText('1 broken');
});
