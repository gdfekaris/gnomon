import { describe, expect, it } from 'vitest';
import {
  ENCRYPTION_CHECK_PLAINTEXT, KDF_PRESETS, SALT_BYTES, WrongPassphraseError, DecryptError, decryptBody, deriveKeyBytes, deriveVerified, encryptBody, fromBase64,
  newEncryptionConfig, parseEncryptionConfig, randomSalt, sealCheck, serializeEncryptionConfig, timeDerivation, toBase64, unlockWithPassphrase, verifyCheck,
} from '../src/index';

// Spec §6.4 "Key derivation", Phase 4 block 1. INTERACTIVE keeps the suite quick; the parameters are stored either way.
const FAST = KDF_PRESETS.interactive;

describe('deriveKeyBytes (Argon2id via libsodium)', () => {
  it('derives the same 32 bytes twice from one passphrase and salt, and different bytes for another salt or passphrase', async () => {
    const salt = randomSalt();
    expect(salt.length).toBe(SALT_BYTES);
    const a = await deriveKeyBytes('correct horse', salt, FAST);
    const b = await deriveKeyBytes('correct horse', salt, FAST);
    expect(a.length).toBe(32);
    expect(toBase64(a)).toBe(toBase64(b));
    expect(toBase64(await deriveKeyBytes('correct horse', randomSalt(), FAST))).not.toBe(toBase64(a));
    expect(toBase64(await deriveKeyBytes('correct horse!', salt, FAST))).not.toBe(toBase64(a));
    // stronger parameters give a different key, so they must be stored, never assumed
    expect(toBase64(await deriveKeyBytes('correct horse', salt, { opslimit: 3, memlimit: FAST.memlimit }))).not.toBe(toBase64(a));
    // a passphrase is compared in NFKC, so the two ways of typing an accent agree
    expect(toBase64(await deriveKeyBytes('café', salt, FAST))).toBe(toBase64(await deriveKeyBytes('café', salt, FAST)));
    await expect(deriveKeyBytes('x', new Uint8Array(8), FAST)).rejects.toThrow(/16 bytes/);
  }, 30_000);
  it('presets are libsodium\'s', () => {
    expect(KDF_PRESETS.moderate).toEqual({ opslimit: 3, memlimit: 268_435_456 });
    expect(KDF_PRESETS.interactive).toEqual({ opslimit: 2, memlimit: 67_108_864 });
  });
});

describe('the config and its check', () => {
  it('a new config carries the salt and parameters and a check the derived key opens; the wrong passphrase fails the check without touching a file', async () => {
    const { config, key } = await newEncryptionConfig('open sesame', FAST);
    expect(config).toMatchObject({ version: 1, kdf: 'argon2id13', opslimit: FAST.opslimit, memlimit: FAST.memlimit });
    expect(fromBase64(config.salt).length).toBe(SALT_BYTES);
    expect(await verifyCheck(key, config.check)).toBe(true);
    expect(key.extractable).toBe(false);
    // the check is bound to the config path: the same bytes under another key, or damaged, fail
    const other = (await newEncryptionConfig('open sesame', FAST)).key;
    expect(await verifyCheck(other, config.check)).toBe(false);
    expect(await verifyCheck(key, config.check.slice(0, -4) + 'AAAA')).toBe(false);
    expect(await verifyCheck(key, 'not base64!')).toBe(false);

    const again = await unlockWithPassphrase('open sesame', config);
    const body = await encryptBody(key, 'sources/x/raw.md', 'secret');
    expect(await decryptBody(again, 'sources/x/raw.md', body)).toBe('secret');
    await expect(unlockWithPassphrase('open sesame?', config)).rejects.toThrow(WrongPassphraseError);
    await expect(unlockWithPassphrase('open sesame?', config)).rejects.toBeInstanceOf(DecryptError);
    const raw = await deriveVerified('open sesame', config);
    expect(raw.length).toBe(32);
    raw.fill(0);
  }, 30_000);
  it('sealCheck seals the constant and nothing else is accepted', async () => {
    const { key } = await newEncryptionConfig('p', FAST);
    const check = await sealCheck(key);
    expect(await verifyCheck(key, check)).toBe(true);
    expect(check).not.toContain(ENCRYPTION_CHECK_PLAINTEXT);
    expect(await sealCheck(key)).not.toBe(check); // a fresh nonce each time
  }, 30_000);
  it('the file round-trips and a bad one is refused with a reason', async () => {
    const { config } = await newEncryptionConfig('p', FAST);
    const text = serializeEncryptionConfig(config);
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(config);
    expect(parseEncryptionConfig(text)).toEqual(config);
    const bad = (edit: (o: Record<string, unknown>) => void) => { const o = JSON.parse(text) as Record<string, unknown>; edit(o); return JSON.stringify(o); };
    expect(() => parseEncryptionConfig('{')).toThrow(/not JSON/);
    expect(() => parseEncryptionConfig('[]')).toThrow(/JSON object/);
    expect(() => parseEncryptionConfig(bad((o) => { o['version'] = 2; }))).toThrow(/version 2/);
    expect(() => parseEncryptionConfig(bad((o) => { o['kdf'] = 'scrypt'; }))).toThrow(/scrypt/);
    expect(() => parseEncryptionConfig(bad((o) => { o['opslimit'] = 0; }))).toThrow(/opslimit/);
    expect(() => parseEncryptionConfig(bad((o) => { o['memlimit'] = '64'; }))).toThrow(/memlimit/);
    expect(() => parseEncryptionConfig(bad((o) => { o['salt'] = toBase64(new Uint8Array(8)); }))).toThrow(/salt is malformed \(8 bytes\)/);
    expect(() => parseEncryptionConfig(bad((o) => { o['check'] = 'AAAA'; }))).toThrow(/check is malformed/);
    expect(() => parseEncryptionConfig(bad((o) => { delete o['check']; }))).toThrow(/check must be/);
  }, 30_000);
  it('timeDerivation reports milliseconds', async () => {
    const ms = await timeDerivation(FAST);
    expect(ms).toBeGreaterThan(0);
  }, 30_000);
});
