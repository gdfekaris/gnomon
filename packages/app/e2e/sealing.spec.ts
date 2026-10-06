// Sealing keys (spec §6.5; Phase 5 block S3) over the fake GitHub: set up
// with the recovery phrase, keep the device key across a relaunch (a
// non-extractable CryptoKey in IndexedDB, on each engine), enroll a desktop
// key from its request, revoke it, and add a second device from the phrase.
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
