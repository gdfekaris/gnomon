// Passphrase key derivation — spec §6.4 "Key derivation", Phase 4 block 1.
// Argon2id through libsodium, loaded lazily so the WASM never sits in the
// initial bundle; the 32 derived bytes become a non-extractable AES-GCM key
// and are zeroed. `.gnomon/encryption.json` carries the salt, the parameters
// (stored, never assumed), and a check that lets a passphrase be verified
// before any file is touched. No key storage here: that is the keyring.

import { ENCRYPTION_CHECK_PLAINTEXT, ENCRYPTION_CONFIG_PATH, type EncryptionConfig, DecryptError, NONCE_BYTES, TAG_BYTES, fromBase64, importBodyKey, toBase64 } from './body';

export interface KdfParams { opslimit: number; memlimit: number }

/** libsodium's Argon2id presets (spec §20.3): MODERATE by default; INTERACTIVE when a phone takes too long. */
export const KDF_PRESETS = {
  moderate: { opslimit: 3, memlimit: 268_435_456 },
  interactive: { opslimit: 2, memlimit: 67_108_864 },
} as const satisfies Record<string, KdfParams>;
export const SALT_BYTES = 16;
export const KEY_BYTES = 32;

/** The passphrase did not derive the key that sealed the check. A DecryptError, so the app's words for it hold. */
export class WrongPassphraseError extends DecryptError {
  override name = 'WrongPassphraseError';
}

type Sodium = typeof import('libsodium-wrappers-sumo');
let sodiumReady: Promise<Sodium> | undefined;
/** libsodium, loaded once, on first use. */
export function loadSodium(): Promise<Sodium> {
  sodiumReady ??= import('libsodium-wrappers-sumo').then(async (mod) => {
    const sodium = ((mod as unknown as { default?: Sodium }).default ?? (mod as unknown as Sodium));
    await sodium.ready;
    return sodium;
  });
  return sodiumReady;
}

export const randomSalt = (): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(SALT_BYTES));

/** Argon2id: 32 bytes from the passphrase and salt under the given parameters. The caller zeroes the result. */
export async function deriveKeyBytes(passphrase: string, salt: Uint8Array, params: KdfParams): Promise<Uint8Array<ArrayBuffer>> {
  if (salt.length !== SALT_BYTES) throw new Error(`a salt is ${SALT_BYTES} bytes, not ${salt.length}`);
  const sodium = await loadSodium();
  const out = sodium.crypto_pwhash(KEY_BYTES, passphrase.normalize('NFKC'), salt, params.opslimit, params.memlimit, sodium.crypto_pwhash_ALG_ARGON2ID13);
  const copy = new Uint8Array(new ArrayBuffer(out.length));
  copy.set(out);
  sodium.memzero(out);
  return copy;
}

const aad = new TextEncoder().encode(ENCRYPTION_CONFIG_PATH);

/** `check`: AES-GCM of the constant under the key, nonce ‖ ciphertext ‖ tag, base64. */
export async function sealCheck(key: CryptoKey): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: TAG_BYTES * 8 }, key, new TextEncoder().encode(ENCRYPTION_CHECK_PLAINTEXT)));
  const payload = new Uint8Array(NONCE_BYTES + sealed.length);
  payload.set(nonce);
  payload.set(sealed, NONCE_BYTES);
  return toBase64(payload);
}

/** Whether the key opens the check to the constant. */
export async function verifyCheck(key: CryptoKey, check: string): Promise<boolean> {
  let payload: Uint8Array<ArrayBuffer>;
  try {
    payload = fromBase64(check);
  } catch {
    return false;
  }
  if (payload.length < NONCE_BYTES + TAG_BYTES) return false;
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: payload.slice(0, NONCE_BYTES), additionalData: aad, tagLength: TAG_BYTES * 8 }, key, payload.slice(NONCE_BYTES));
    return new TextDecoder().decode(plain) === ENCRYPTION_CHECK_PLAINTEXT;
  } catch {
    return false;
  }
}

/** A fresh config for a brain being encrypted: a random salt, the parameters, and the check sealed under the derived key. */
export async function newEncryptionConfig(passphrase: string, params: KdfParams = KDF_PRESETS.moderate): Promise<{ config: EncryptionConfig; key: CryptoKey }> {
  const salt = randomSalt();
  const raw = await deriveKeyBytes(passphrase, salt, params);
  const key = await importBodyKey(raw);
  const config: EncryptionConfig = { version: 1, kdf: 'argon2id13', salt: toBase64(salt), opslimit: params.opslimit, memlimit: params.memlimit, check: await sealCheck(key) };
  return { config, key };
}

/**
 * Derive the key bytes for a config and prove them against its check, before
 * anything else is touched. Returns the raw bytes so a keyring can wrap them
 * for a device first; the caller zeroes them. Throws WrongPassphraseError.
 */
export async function deriveVerified(passphrase: string, config: EncryptionConfig): Promise<Uint8Array<ArrayBuffer>> {
  const raw = await deriveKeyBytes(passphrase, fromBase64(config.salt), { opslimit: config.opslimit, memlimit: config.memlimit });
  const probe = await importBodyKey(raw.slice()); // zeroes its own copy
  if (!(await verifyCheck(probe, config.check))) {
    raw.fill(0);
    throw new WrongPassphraseError('the passphrase does not unlock this brain');
  }
  return raw;
}

/** Unlock once per session: the non-extractable key, or WrongPassphraseError. */
export async function unlockWithPassphrase(passphrase: string, config: EncryptionConfig): Promise<CryptoKey> {
  const raw = await deriveVerified(passphrase, config);
  return importBodyKey(raw);
}

/** How long a derivation takes here, in milliseconds: the number spec §20.3 wants from a phone. */
export async function timeDerivation(params: KdfParams): Promise<number> {
  const salt = randomSalt();
  const t0 = performance.now();
  (await deriveKeyBytes('timing only', salt, params)).fill(0);
  return Math.round(performance.now() - t0);
}

// ---- `.gnomon/encryption.json`

export function serializeEncryptionConfig(config: EncryptionConfig): string {
  return JSON.stringify({ version: config.version, kdf: config.kdf, salt: config.salt, opslimit: config.opslimit, memlimit: config.memlimit, check: config.check }, null, 2) + '\n';
}

/** The config, or a plain error naming what is wrong with the file. */
export function parseEncryptionConfig(text: string): EncryptionConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`${ENCRYPTION_CONFIG_PATH} is not JSON: ${(e as Error).message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${ENCRYPTION_CONFIG_PATH} must be a JSON object`);
  const o = raw as Record<string, unknown>;
  if (o['version'] !== 1) throw new Error(`${ENCRYPTION_CONFIG_PATH}: version ${String(o['version'])} is not one this app reads`);
  if (o['kdf'] !== 'argon2id13') throw new Error(`${ENCRYPTION_CONFIG_PATH}: kdf '${String(o['kdf'])}' is not argon2id13`);
  for (const k of ['opslimit', 'memlimit'] as const) {
    if (typeof o[k] !== 'number' || !Number.isInteger(o[k]) || (o[k] as number) < 1) throw new Error(`${ENCRYPTION_CONFIG_PATH}: ${k} must be a positive integer`);
  }
  for (const k of ['salt', 'check'] as const) {
    if (typeof o[k] !== 'string') throw new Error(`${ENCRYPTION_CONFIG_PATH}: ${k} must be a base64 string`);
    try {
      const bytes = fromBase64(o[k] as string);
      if (k === 'salt' && bytes.length !== SALT_BYTES) throw new Error(`${bytes.length} bytes`);
      if (k === 'check' && bytes.length < NONCE_BYTES + TAG_BYTES) throw new Error('too short');
    } catch (e) {
      throw new Error(`${ENCRYPTION_CONFIG_PATH}: ${k} is malformed (${(e as Error).message})`);
    }
  }
  return { version: 1, kdf: 'argon2id13', salt: o['salt'] as string, opslimit: o['opslimit'] as number, memlimit: o['memlimit'] as number, check: o['check'] as string };
}
