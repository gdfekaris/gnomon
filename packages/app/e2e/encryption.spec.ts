// Encryption in the app (spec §6.4, US-16, US-17; Phase 4 block 3). The
// long flow runs over the fake GitHub, which persists across reloads inside
// one test, so the stored bytes can be read from Node and the unlock sheet
// can be met on relaunch. `?kdf=fast` keeps Argon2id far below the presets.
import { expect, test } from '@playwright/test';
import { ENCRYPTION_CONFIG_PATH, KDF_PRESETS, encryptBody, newEncryptionConfig, serializeEncryptionConfig, splitFrontmatter } from '@gnomon/core';
import { FakeGitHub, readBrainBytes, serveGitHub } from './github-fake';

const MARKER = '<!-- gnomon-enc v1 -->';
const RAW = 'sources/weil-attention/raw.md';
const PASSAGE = 'Attention is the rarest and purest form of generosity.';
const messages = (gh: FakeGitHub) => [...gh.commits.values()].map((c) => c.message);
function textAt(gh: FakeGitHub, path: string): string | undefined {
  const head = gh.refs.get('heads/main')!;
  const blob = gh.trees.get(gh.commits.get(head)!.tree)!.get(path);
  return blob === undefined ? undefined : new TextDecoder().decode(gh.blobs.get(blob)!);
}

async function fillEncrypt(page: import('@playwright/test').Page, passphrase: string, opts: { sentence?: boolean; remember?: boolean } = {}) {
  const form = page.getByTestId('encrypt-form');
  await form.getByTestId('enc-passphrase').fill(passphrase);
  await form.getByTestId('enc-confirm').fill(passphrase);
  if (opts.sentence) await form.getByTestId('enc-sentence').fill('A lost passphrase loses the bodies.');
  if (opts.remember) await form.getByTestId('enc-remember').check();
  await expect(form.getByTestId('enc-go')).toBeEnabled();
  await form.getByTestId('enc-go').click();
}

test('enable on a GitHub brain, relaunch into the unlock sheet, work on it encrypted, change the passphrase, remember, lock, disable', async ({ page }) => {
  const gh = await FakeGitHub.create(readBrainBytes());
  await serveGitHub(page, gh);
  await page.goto('/#/settings?kdf=fast');
  await page.getByTestId('git-owner').fill('octocat');
  await page.getByTestId('git-name').fill('brain');
  await page.getByTestId('git-token').fill('test-token');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByText('Connected: octocat/brain')).toBeVisible();
  await expect(page.getByTestId('enc-diag')).toHaveText(/Encryption off/);

  // Enable: the sentence must be typed back and the passphrases must match before the button works.
  await page.getByTestId('enc-enable').click();
  const form = page.getByTestId('encrypt-form');
  await form.getByTestId('enc-passphrase').fill('open sesame');
  await form.getByTestId('enc-confirm').fill('open sesame!');
  await expect(form.getByTestId('enc-mismatch')).toBeVisible();
  await expect(form.getByTestId('enc-go')).toBeDisabled();
  await form.getByTestId('enc-confirm').fill('open sesame');
  await expect(form.getByTestId('enc-go')).toBeDisabled();
  await form.getByTestId('enc-sentence').fill('A lost passphrase loses the bodies.');
  await form.getByTestId('enc-go').click();
  await expect(page.getByTestId('enc-done')).toContainText(/Encryption is on: \d+ files encrypted/);
  await expect(page.getByTestId('enc-on')).toBeVisible();
  await expect(page.getByTestId('enc-diag')).toHaveText(/Encryption on, unlocked/);
  // Stored: ciphertext bodies under cleartext frontmatter, the config beside them, one commit.
  expect(messages(gh).some((m) => /^Encrypt: \d+ files$/.test(m))).toBe(true);
  const raw = textAt(gh, RAW)!;
  expect(raw).toContain('title: Attention as generosity');
  expect(raw).toContain(MARKER);
  expect(raw).not.toContain(PASSAGE);
  expect(textAt(gh, '.gnomon/encryption.json')).toContain('argon2id13');
  expect(textAt(gh, 'maps/_index.md')).not.toContain(MARKER);
  // The app reads plaintext.
  await page.goto(`/#/browse/${RAW}`);
  await expect(page.getByTestId('file-body')).toContainText(PASSAGE);

  // Relaunch, not remembered: the sheet; a wrong passphrase is refused beside the field; the right one lands on the brain.
  await page.goto('/#/capture');
  await page.reload();
  const sheet = page.getByTestId('unlock-sheet');
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId('load-error')).toContainText('encrypted and locked');
  await sheet.getByTestId('unlock-passphrase').fill('nope');
  await sheet.getByTestId('unlock-go').click();
  await expect(sheet.getByTestId('unlock-error')).toContainText('does not unlock');
  await sheet.getByTestId('unlock-passphrase').fill('open sesame');
  await sheet.getByTestId('unlock-go').click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('capture-text')).toBeVisible();

  // Capture, file, ratify on the encrypted brain: the review reads in the clear, the capture's two lines are cleartext frontmatter.
  // The title a filing writes is cleartext by design (spec §6.4), so the tail past the title is what must stay unreadable.
  await page.getByTestId('capture-text').fill('An encrypted capture, filed and ratified, with a secret tail.');
  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('saved')).toBeVisible();
  await page.goto('/#/inbox');
  await expect(page.getByTestId('inbox-model')).toContainText('Demo model');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('process-results')).toContainText('filed as unknown-an-encrypted-capture-filed');
  const filing = page.getByTestId('filing-unknown-an-encrypted-capture-filed');
  const panel = filing.getByTestId('review-panel');
  await expect(panel).toContainText('with a secret tail');
  await expect(panel.getByTestId('capture-filed')).toHaveText('Now filed as unknown-an-encrypted-capture-filed.');
  await expect(panel.getByTestId('capture-lines')).toHaveCount(0);
  await panel.getByTestId('ratify').click();
  await expect(filing.getByTestId('state')).toHaveText('ratified');
  const filed = textAt(gh, 'sources/unknown-an-encrypted-capture-filed/raw.md')!;
  expect(filed).toContain('curated: ratified');
  expect(filed).toContain(MARKER);
  expect(filed).toContain('title: An encrypted capture, filed and ratified');
  expect(filed).not.toContain('secret tail');

  // Change the passphrase: the old one no longer opens the brain after a relaunch, the new one does, and this time it is remembered.
  await page.goto('/#/settings?kdf=fast');
  await page.getByTestId('enc-rekey').click();
  await fillEncrypt(page, 'a newer phrase');
  await expect(page.getByTestId('enc-done')).toContainText(/Passphrase changed: \d+ files re-encrypted/);
  expect(messages(gh)).toContain('Change passphrase');
  await page.goto('/#/capture');
  await page.reload();
  await expect(sheet).toBeVisible();
  await sheet.getByTestId('unlock-passphrase').fill('open sesame');
  await sheet.getByTestId('unlock-go').click();
  await expect(sheet.getByTestId('unlock-error')).toContainText('does not unlock');
  await sheet.getByTestId('unlock-passphrase').fill('a newer phrase');
  await sheet.getByTestId('unlock-remember').check();
  await sheet.getByTestId('unlock-go').click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('capture-text')).toBeVisible();

  // Remembered: a relaunch lands straight on Capture. Lock now brings the sheet back; forget makes the next relaunch ask.
  await page.reload();
  await expect(page.getByTestId('capture-text')).toBeVisible();
  await expect(sheet).toHaveCount(0);
  await page.goto('/#/settings');
  await expect(page.getByTestId('enc-diag')).toHaveText(/Encryption on, unlocked/);
  await page.getByTestId('enc-lock').click();
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId('enc-locked')).toBeVisible();
  await expect(page.getByTestId('enc-diag')).toHaveText(/Encryption on, locked/);
  await sheet.getByTestId('unlock-passphrase').fill('a newer phrase');
  await sheet.getByTestId('unlock-go').click();
  await expect(sheet).toHaveCount(0);
  await page.getByTestId('enc-forget').click();
  await expect(sheet).toBeVisible();
  await page.reload();
  await expect(sheet).toBeVisible();
  await sheet.getByTestId('unlock-passphrase').fill('a newer phrase');
  await sheet.getByTestId('unlock-go').click();
  await expect(sheet).toHaveCount(0);

  // Disable, after a confirmation: plaintext at rest again, the config gone, and a relaunch asks nothing.
  await page.getByTestId('enc-disable').click();
  await expect(page.getByTestId('enc-disable-confirm')).toBeVisible();
  await page.getByTestId('enc-disable-yes').click();
  await expect(page.getByTestId('enc-done')).toContainText(/Encryption is off: \d+ files rewritten as plaintext/);
  await expect(page.getByTestId('enc-enable')).toBeVisible();
  expect(messages(gh).some((m) => /^Decrypt: \d+ files$/.test(m))).toBe(true);
  expect(textAt(gh, RAW)).toContain(PASSAGE);
  expect(textAt(gh, RAW)).not.toContain(MARKER);
  expect(textAt(gh, '.gnomon/encryption.json')).toBeUndefined();
  expect(textAt(gh, 'sources/unknown-an-encrypted-capture-filed/raw.md')).toContain('with a secret tail.');
  await page.goto('/#/capture');
  await page.reload();
  await expect(page.getByTestId('capture-text')).toBeVisible();
  await expect(sheet).toHaveCount(0);
  await page.goto('/#/settings');
  await expect(page.getByTestId('refusal-count')).toHaveText('0 refusals');
});

test('the demo brain encrypts, locks, unlocks, and decrypts within one launch', async ({ page }) => {
  await page.goto('/#/settings?kdf=fast');
  await page.getByTestId('use-demo').click();
  await expect(page.getByText('Connected: demo brain')).toBeVisible();
  await page.getByTestId('enc-enable').click();
  await fillEncrypt(page, 'open sesame', { sentence: true });
  await expect(page.getByTestId('enc-done')).toContainText('Encryption is on');
  await page.goto(`/#/browse/${RAW}`);
  await expect(page.getByTestId('file-body')).toContainText(PASSAGE);
  await page.goto('/#/settings');
  await page.getByTestId('enc-lock').click();
  const sheet = page.getByTestId('unlock-sheet');
  await expect(sheet).toBeVisible();
  await page.goto('/#/browse');
  await expect(page.getByTestId('load-error')).toContainText('locked');
  await sheet.getByTestId('unlock-passphrase').fill('open sesame');
  await sheet.getByTestId('unlock-go').click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByText('25 files')).toBeVisible();
  await page.goto('/#/settings');
  await page.getByTestId('enc-disable').click();
  await page.getByTestId('enc-disable-yes').click();
  await expect(page.getByTestId('enc-done')).toContainText('Encryption is off');
  await expect(page.getByTestId('validation')).toContainText('The brain is valid and its indexes are current.');
});

test('onboarding offers encryption on the privacy step, before the brain holds anything', async ({ page }) => {
  const gh = new FakeGitHub('nobody', 'nothing');
  await serveGitHub(page, gh);
  await page.goto('/#/onboarding?kdf=fast');
  await page.getByTestId('onboard-create').click();
  await page.getByTestId('onboard-name').fill('brain');
  await page.getByTestId('onboard-token').fill('test-token');
  await page.getByTestId('onboard-go').click();
  await expect(page.getByTestId('created')).toContainText('octocat/brain');
  await page.getByTestId('onboard-next').click();
  await expect(page.getByRole('heading', { name: 'Who can see what' })).toBeVisible();
  await page.getByTestId('onboard-encrypt').click();
  await fillEncrypt(page, 'open sesame', { sentence: true, remember: true });
  await expect(page.getByTestId('onboard-encrypted')).toContainText('Encryption is on: 1 file encrypted');
  expect(textAt(gh, '.gnomon/encryption.json')).toContain('argon2id13');
  expect(textAt(gh, 'principles/ps-g8xw/_set.md')).toContain(MARKER);
  await page.getByTestId('onboard-next').click();
  await page.getByTestId('onboard-next').click();
  await page.getByTestId('onboard-finish').click();
  await expect(page.getByTestId('capture-text')).toBeVisible();
  // Remembered at enablement: the relaunch asks nothing, and the capture lands as ciphertext.
  await page.reload();
  await expect(page.getByTestId('capture-text')).toBeVisible();
  await expect(page.getByTestId('unlock-sheet')).toHaveCount(0);
  await page.getByTestId('capture-text').fill('The first passage.');
  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('saved')).toBeVisible();
  const capture = [...gh.trees.get(gh.commits.get(gh.refs.get('heads/main')!)!.tree)!.keys()].find((p) => p.startsWith('inbox/') && p.endsWith('.md'))!;
  expect(textAt(gh, capture)).toContain(MARKER);
  expect(textAt(gh, capture)).not.toContain('The first passage.');
});

// iOS Lockdown Mode removes WebAssembly from every site not excluded (the maintainer's phone, 2026-09-19), and
// libsodium's Argon2id runs in it: the app says so up front on the Measure line, the enable form, and the unlock
// sheet, in a sentence that names the fix, instead of "Can't find variable: WebAssembly" after a tap.
test('a device without WebAssembly is told so before any tap, and an encrypted brain reads as locked, not broken', async ({ page }) => {
  await page.addInitScript(() => { delete (globalThis as { WebAssembly?: unknown }).WebAssembly; });
  // A brain encrypted elsewhere: one body sealed, the config beside it, made here with Node's WebAssembly.
  const seed = readBrainBytes();
  const { config, key } = await newEncryptionConfig('open sesame', KDF_PRESETS.interactive);
  const split = splitFrontmatter(new TextDecoder().decode(seed.get(RAW)!))!;
  seed.set(RAW, new TextEncoder().encode(`---\n${split.yaml}\n---\n${await encryptBody(key, RAW, split.body)}`));
  seed.set(ENCRYPTION_CONFIG_PATH, new TextEncoder().encode(serializeEncryptionConfig(config)));
  const gh = await FakeGitHub.create(seed);
  await serveGitHub(page, gh);

  await page.goto('/#/settings');
  await page.getByTestId('use-demo').click();
  await expect(page.getByText('Connected: demo brain')).toBeVisible();
  await expect(page.getByTestId('kdf-timing')).toContainText('Lockdown Mode');
  await expect(page.getByTestId('kdf-measure')).toBeDisabled();
  await page.getByTestId('enc-enable').click();
  await expect(page.getByTestId('enc-no-wasm')).toContainText('without WebAssembly');
  await fillEncrypt(page, 'open sesame', { sentence: true }).catch(() => undefined);
  await expect(page.getByTestId('encrypt-form').getByTestId('enc-go')).toBeDisabled();
  expect(messages(gh).some((m) => m.startsWith('Encrypt'))).toBe(false);

  await page.getByTestId('git-owner').fill('octocat');
  await page.getByTestId('git-name').fill('brain');
  await page.getByTestId('git-token').fill('test-token');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  const sheet = page.getByTestId('unlock-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('unlock-no-wasm')).toContainText('Lockdown Mode');
  await sheet.getByTestId('unlock-passphrase').fill('open sesame');
  await expect(sheet.getByTestId('unlock-go')).toBeDisabled();
  await expect(page.getByTestId('enc-locked')).toBeVisible();
  await expect(page.getByTestId('enc-diag')).toHaveText(/Encryption on, locked/);
});
