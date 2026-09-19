// Encryption in the app — spec §6.4, §12 step 5, §14; US-16, US-17; Phase 4
// block 3. The stack: when `.gnomon/encryption.json` exists the session's
// driver is the encrypting wrapper over the plain one, with a passphrase
// keyring that a device may remember. The flows: enable, disable, change
// the passphrase, unlock, lock, forget. Each of the three plan flows is one
// commit of stored bytes through the plain driver (never the wrapper, which
// would seal ciphertext a second time), then a swap of the stack and a
// refresh. Framework-free: it writes into a plain state object handed to it,
// so it runs under vitest without Svelte.

import {
  ENCRYPTION_CONFIG_PATH, type EncryptionConfig, KDF_PRESETS, type KdfParams, deriveKeyBytes, importBodyKey, parseEncryptionConfig, planDecrypt, planEncrypt, planRekey,
  randomSalt, sealCheck, toBase64, verifyCheck,
} from '@gnomon/core';
import { EncryptingDriver, type KeyStore, PassphraseKeyring, type StorageDriver } from '@gnomon/storage';
import type { BrainService } from './brain';

export interface EncryptionState {
  /** `.gnomon/encryption.json` exists on the connected brain */
  enabled: boolean;
  /** enabled and this process holds no key: the unlock sheet is up */
  locked: boolean;
  /** the last key-store failure, in its own words, for Settings → About */
  storeError: string | null;
}

/** The composed drivers of a session. `driver` is what the brain service uses; `plain` is what the plan commits go through. */
export interface Stack {
  driver: StorageDriver;
  plain: StorageDriver;
  keyring: PassphraseKeyring | null;
  config: EncryptionConfig | null;
  store: KeyStore | null;
}

/** The sentence the enable flow makes the user type back (spec §6.4): there is no recovery. */
export const LOST_SENTENCE = 'a lost passphrase loses the bodies';
export const typedBack = (text: string): boolean => text.trim().replace(/[.!]+$/, '').toLowerCase() === LOST_SENTENCE;

/** Argon2id parameters far below the presets, for tests and flows only (`#/settings?kdf=fast`); never a default. */
export const KDF_FAST: KdfParams = { opslimit: 1, memlimit: 16 * 1024 * 1024 };
/** The parameters a `kdf` query names: `interactive`, `fast`, or the default preset (spec §20.3, one constant). */
export function kdfParamsFor(name: string | null | undefined): KdfParams {
  if (name === 'fast') return KDF_FAST;
  if (name === 'interactive') return KDF_PRESETS.interactive;
  return KDF_PRESETS.moderate;
}

/** The brain's encryption config, or null when the file is absent. A present file that does not parse throws, in its own words. */
export async function readEncryptionConfig(plain: StorageDriver): Promise<EncryptionConfig | null> {
  const tree = await plain.list();
  if (!tree.some((e) => e.path === ENCRYPTION_CONFIG_PATH)) return null;
  const got = (await plain.readMany([ENCRYPTION_CONFIG_PATH])).get(ENCRYPTION_CONFIG_PATH);
  if (!got) throw new Error(`${ENCRYPTION_CONFIG_PATH} is in the repository but could not be read`);
  return parseEncryptionConfig(got.text);
}

/**
 * Compose the stack for a plain driver (spec §4): the encrypting wrapper with
 * a passphrase keyring when the config exists, the plain driver otherwise.
 * A key the device remembered is restored and proved against this brain's
 * check first; one that belongs to another brain or an earlier passphrase is
 * forgotten, so a wrong remembered key reads as locked, never as damage.
 */
export async function composeStack(plain: StorageDriver, store: KeyStore | null, state: EncryptionState): Promise<Stack> {
  const config = await readEncryptionConfig(plain);
  if (!config) {
    state.enabled = false;
    state.locked = false;
    return { driver: plain, plain, keyring: null, config: null, store };
  }
  const keyring = new PassphraseKeyring(store);
  if ((await keyring.restore()) && !(await verifyCheck(await keyring.key(), config.check))) await keyring.forget();
  state.enabled = true;
  state.locked = !keyring.unlocked;
  state.storeError = keyring.storeError;
  return { driver: new EncryptingDriver(plain, keyring), plain, keyring, config, store };
}

/** A fresh config and the raw key it seals (spec §6.4): one derivation, the check sealed from the same bytes. The caller adopts or zeroes `raw`. */
export async function newConfig(passphrase: string, params: KdfParams): Promise<{ config: EncryptionConfig; raw: Uint8Array<ArrayBuffer> }> {
  const salt = randomSalt();
  const raw = await deriveKeyBytes(passphrase, salt, params);
  const probe = await importBodyKey(raw.slice());
  const config: EncryptionConfig = { version: 1, kdf: 'argon2id13', salt: toBase64(salt), opslimit: params.opslimit, memlimit: params.memlimit, check: await sealCheck(probe) };
  return { config, raw };
}

export interface KeyOptions {
  /** wrap the key for this device (spec §6.4 "Remember on this device") */
  remember?: boolean;
  /** Argon2id parameters for a new config; the default preset when absent */
  params?: KdfParams;
}

function snap(brain: BrainService) {
  const s = brain.snapshot;
  if (!s) throw new Error('no brain is connected');
  return s;
}

/**
 * Enable: one `Encrypt: n files` commit through the plain driver, then the
 * stack becomes the wrapper over a keyring holding the new key, and the
 * brain reloads through it. Returns the new stack and how many bodies were
 * sealed. A head that moved is refused with nothing written.
 */
export async function enableEncryption(brain: BrainService, stack: Stack, state: EncryptionState, passphrase: string, opts: KeyOptions = {}): Promise<{ stack: Stack; files: number }> {
  if (stack.config) throw new Error('this brain is already encrypted');
  if (!passphrase) throw new Error('a passphrase is needed');
  const s = snap(brain);
  const { config, raw } = await newConfig(passphrase, opts.params ?? KDF_PRESETS.moderate);
  const key = await importBodyKey(raw.slice());
  const batch = await planEncrypt(s, key, config);
  try {
    await brain.commitStored(batch, stack.plain);
  } catch (e) {
    raw.fill(0);
    throw e;
  }
  const keyring = new PassphraseKeyring(stack.store);
  await keyring.adopt(raw, opts.remember ?? false);
  const next: Stack = { driver: new EncryptingDriver(stack.plain, keyring), plain: stack.plain, keyring, config, store: stack.store };
  state.enabled = true;
  state.locked = false;
  state.storeError = keyring.storeError;
  await brain.replaceDriver(next.driver);
  return { stack: next, files: batch.writes.length - 1 };
}

/** Disable: one `Decrypt: n files` commit through the plain driver, the device forgets the key, and the stack is the plain driver again. */
export async function disableEncryption(brain: BrainService, stack: Stack, state: EncryptionState): Promise<{ stack: Stack; files: number }> {
  if (!stack.keyring || !stack.config) throw new Error('this brain is not encrypted');
  if (!stack.keyring.unlocked) throw new Error('unlock the brain first');
  // The plan takes the bodies the wrapper read as ciphertext; a snapshot applied locally after a commit does not carry that mark.
  const s = await brain.refresh();
  const batch = planDecrypt(s);
  await brain.commitStored(batch, stack.plain);
  await stack.keyring.forget();
  const next: Stack = { driver: stack.plain, plain: stack.plain, keyring: null, config: null, store: stack.store };
  state.enabled = false;
  state.locked = false;
  state.storeError = stack.keyring.storeError;
  await brain.replaceDriver(next.driver);
  return { stack: next, files: batch.writes.length };
}

/** Change the passphrase: every body under the new key and the new salt and check, one `Change passphrase` commit; the keyring adopts the new key. */
export async function changePassphrase(brain: BrainService, stack: Stack, state: EncryptionState, passphrase: string, opts: KeyOptions = {}): Promise<{ stack: Stack; files: number }> {
  if (!stack.keyring || !stack.config) throw new Error('this brain is not encrypted');
  if (!stack.keyring.unlocked) throw new Error('unlock the brain first');
  if (!passphrase) throw new Error('a passphrase is needed');
  const s = await brain.refresh();
  const { config, raw } = await newConfig(passphrase, opts.params ?? { opslimit: stack.config.opslimit, memlimit: stack.config.memlimit });
  const key = await importBodyKey(raw.slice());
  const batch = await planRekey(s, key, config);
  try {
    await brain.commitStored(batch, stack.plain);
  } catch (e) {
    raw.fill(0);
    throw e;
  }
  await stack.keyring.adopt(raw, opts.remember ?? false);
  const next: Stack = { ...stack, config };
  state.locked = false;
  state.storeError = stack.keyring.storeError;
  await brain.replaceDriver(next.driver);
  return { stack: next, files: batch.writes.length - 1 };
}

/** Unlock once per session (spec §6.4): derive, prove against the check, hold, optionally remember; then load the brain. Throws WrongPassphraseError. */
export async function unlockBrain(brain: BrainService, stack: Stack, state: EncryptionState, passphrase: string, remember = false): Promise<void> {
  if (!stack.keyring || !stack.config) throw new Error('this brain is not encrypted');
  await stack.keyring.unlock(passphrase, stack.config, remember);
  state.locked = false;
  state.storeError = stack.keyring.storeError;
  await brain.refresh();
}

/** The locked sentence, as the screens show it under the sheet. */
export const LOCKED_SENTENCE = 'This brain is locked on this device. Enter its passphrase to unlock it.';

/** Lock: drop the key and the loaded brain from this process. The device may still remember the key; `forget` says otherwise. */
export function lockBrain(brain: BrainService, stack: Stack, state: EncryptionState): void {
  if (!stack.keyring) throw new Error('this brain is not encrypted');
  stack.keyring.lock();
  state.locked = true;
  brain.clearSnapshot(LOCKED_SENTENCE);
}

/** Forget on this device: lock, and delete the wrapped key and the device key from the store. */
export async function forgetOnDevice(brain: BrainService, stack: Stack, state: EncryptionState): Promise<void> {
  if (!stack.keyring) throw new Error('this brain is not encrypted');
  await stack.keyring.forget();
  state.locked = true;
  state.storeError = stack.keyring.storeError;
  brain.clearSnapshot(LOCKED_SENTENCE);
}

/** The disclosure, verbatim from spec §6.4, shown wherever encryption is offered or described. */
export const DISCLOSURE = 'Titles, tags, authors, structure, and attached files remain readable to your git host; passage text, notes, principle text, proposal text, and inbox text do not. File names and sizes stay visible. There is no recovery: a lost passphrase loses the bodies.';
export const REMEMBER_LIMIT = 'Remembering keeps the key on this device, wrapped under a key the browser holds: anyone with this device unlocked can open the brain. One brain at a time; connecting another encrypted brain asks again.';
