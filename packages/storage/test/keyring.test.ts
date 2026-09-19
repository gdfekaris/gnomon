import { describe, expect, it } from 'vitest';
import { KDF_PRESETS, decryptBody, encryptBody, newEncryptionConfig } from '@gnomon/core';
import { DEVICE_KEY, EncryptingDriver, type KeyStore, LockedError, MemoryDriver, PassphraseKeyring, WRAPPED_KEY } from '../src/index';
import { readBrainBytes } from './fixture';

// Spec §6.4: unlock once per session; "remember on this device" wraps the key under a device key in the store.
const FAST = KDF_PRESETS.interactive;
class FakeStore implements KeyStore {
  readonly map = new Map<string, unknown>();
  failing = false;
  async get<T>(key: string): Promise<T | undefined> { if (this.failing) throw new Error('IndexedDB is asleep'); return this.map.get(key) as T | undefined; }
  async set(key: string, value: unknown): Promise<void> { if (this.failing) throw new Error('IndexedDB is asleep'); this.map.set(key, value); }
  async del(key: string): Promise<void> { if (this.failing) throw new Error('IndexedDB is asleep'); this.map.delete(key); }
}

describe('PassphraseKeyring', () => {
  it('unlocks with the passphrase, refuses the wrong one, and locks', async () => {
    const { config } = await newEncryptionConfig('open sesame', FAST);
    const ring = new PassphraseKeyring();
    expect(ring.unlocked).toBe(false);
    await expect(ring.key()).rejects.toBeInstanceOf(LockedError);
    await expect(ring.unlock('nope', config)).rejects.toThrow(/does not unlock/);
    expect(ring.unlocked).toBe(false);
    await ring.unlock('open sesame', config);
    expect(ring.unlocked).toBe(true);
    const key = await ring.key();
    expect(key.extractable).toBe(false);
    ring.lock();
    await expect(ring.key()).rejects.toBeInstanceOf(LockedError);
  }, 30_000);

  it('remembers on a device: the wrapped key round-trips through the store into a new keyring, and a cleared store means locked', async () => {
    const { config, key } = await newEncryptionConfig('open sesame', FAST);
    const store = new FakeStore();
    const ring = new PassphraseKeyring(store);
    await ring.unlock('open sesame', config, true);
    expect(store.map.has(DEVICE_KEY)).toBe(true);
    expect((store.map.get(DEVICE_KEY) as CryptoKey).extractable).toBe(false);
    const wrapped = store.map.get(WRAPPED_KEY) as Uint8Array;
    expect(wrapped.length).toBe(12 + 32 + 16);

    const later = new PassphraseKeyring(store);
    expect(later.unlocked).toBe(false);
    expect(await later.restore()).toBe(true);
    expect(later.unlocked).toBe(true);
    const body = await encryptBody(key, 'sources/x/raw.md', 'secret');
    expect(await decryptBody(await later.key(), 'sources/x/raw.md', body)).toBe('secret');

    // forgotten: nothing in the store, and a fresh keyring stays locked
    await later.forget();
    expect(store.map.size).toBe(0);
    expect(later.unlocked).toBe(false);
    const cleared = new PassphraseKeyring(store);
    expect(await cleared.restore()).toBe(false);
    await expect(cleared.key()).rejects.toBeInstanceOf(LockedError);
    // a wrapped key without its device key, or a damaged one, is locked too
    store.map.set(WRAPPED_KEY, wrapped);
    expect(await new PassphraseKeyring(store).restore()).toBe(false);
    await ring.unlock('open sesame', config, true);
    const damaged = new Uint8Array(store.map.get(WRAPPED_KEY) as Uint8Array);
    damaged[20] = damaged[20]! ^ 1;
    store.map.set(WRAPPED_KEY, damaged);
    const broken = new PassphraseKeyring(store);
    expect(await broken.restore()).toBe(false);
    expect(broken.storeError).toMatch(/OperationError|decrypt/i);
    expect(await new PassphraseKeyring(null).restore()).toBe(false);
  }, 30_000);

  it('a failing store never locks the user out: the session unlocks and the failure is recorded', async () => {
    const { config } = await newEncryptionConfig('open sesame', FAST);
    const store = new FakeStore();
    store.failing = true;
    const ring = new PassphraseKeyring(store);
    await ring.unlock('open sesame', config, true);
    expect(ring.unlocked).toBe(true);
    expect(ring.storeError).toContain('IndexedDB is asleep');
    expect(await new PassphraseKeyring(store).restore()).toBe(false);
    await ring.forget();
    expect(ring.unlocked).toBe(false);
  }, 30_000);

  it('adopts raw bytes the caller derived: held, remembered when asked, and a stale remembered key forgotten when not', async () => {
    const { config, key } = await newEncryptionConfig('open sesame', FAST);
    const store = new FakeStore();
    const ring = new PassphraseKeyring(store);
    await ring.unlock('open sesame', config, true);
    expect(store.map.has(WRAPPED_KEY)).toBe(true);
    // a new key adopted without `remember` clears what the device remembered, so the store never holds a key that no longer opens the brain
    const raw = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(32)));
    const copy = raw.slice();
    await ring.adopt(raw, false);
    expect(ring.unlocked).toBe(true);
    expect(raw.every((b) => b === 0)).toBe(true);
    expect(store.map.has(WRAPPED_KEY)).toBe(false);
    expect(store.map.has(DEVICE_KEY)).toBe(false);
    const sealed = await encryptBody(await ring.key(), 'p', 'x');
    await expect(decryptBody(key, 'p', sealed)).rejects.toThrow();
    // adopted with `remember`, it round-trips into a fresh keyring
    await ring.adopt(copy, true);
    const later = new PassphraseKeyring(store);
    expect(await later.restore()).toBe(true);
    expect(await decryptBody(await later.key(), 'p', sealed)).toBe('x');
  }, 30_000);

  it('drives the encrypting driver: ciphertext at rest, plaintext through the unlocked keyring, LockedError when locked', async () => {
    const { config } = await newEncryptionConfig('open sesame', FAST);
    const ring = new PassphraseKeyring();
    const inner = await MemoryDriver.create(readBrainBytes());
    const driver = new EncryptingDriver(inner, ring);
    const path = 'sources/weil-attention/notes.md';
    const head = await driver.head();
    const text = '---\ntype: notes\nsource: weil-attention\ncurated: human\ncreated: 2026-09-04T21:30:00Z\nupdated: 2026-09-06T12:00:00Z\n---\nSecret marginalia.\n';
    await expect(driver.commit({ message: 'x', expectedHead: head, writes: [{ path, text }], deletes: [] })).rejects.toBeInstanceOf(LockedError);
    await ring.unlock('open sesame', config);
    await driver.commit({ message: 'x', expectedHead: head, writes: [{ path, text }], deletes: [] });
    expect((await inner.readMany([path])).get(path)!.text).not.toContain('Secret');
    expect((await driver.readMany([path])).get(path)!.text).toBe(text);
    ring.lock();
    await expect(driver.readMany([path])).rejects.toBeInstanceOf(LockedError);
  }, 30_000);
});
