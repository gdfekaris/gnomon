// Keyring — what the EncryptingDriver asks for a key (spec §6.4). The
// StaticKeyring holds one CryptoKey in memory (the test stub). The
// PassphraseKeyring derives it from a passphrase with Argon2id, once per
// session, and can remember it on a device: the raw bytes encrypted under a
// non-extractable device key kept in the app's key store (IndexedDB, through
// the persist pattern), so a flaky store never locks the user out silently.

import { type EncryptionConfig, NONCE_BYTES, TAG_BYTES, deriveVerified, importBodyKey } from '@gnomon/core';
import { LockedError } from './errors';

export interface Keyring {
  /** The body key. Throws LockedError until the user has unlocked. */
  key(): Promise<CryptoKey>;
}

/** Holds one CryptoKey in memory for the session. Also the stub keyring for tests. */
export class StaticKeyring implements Keyring {
  private held: CryptoKey | undefined;
  constructor(key?: CryptoKey) {
    this.held = key;
  }
  get unlocked(): boolean {
    return this.held !== undefined;
  }
  unlock(key: CryptoKey): void {
    this.held = key;
  }
  lock(): void {
    this.held = undefined;
  }
  async key(): Promise<CryptoKey> {
    if (!this.held) throw new LockedError('the brain is encrypted and no key is unlocked');
    return this.held;
  }
}

/** The on-device store the remembered key lives in (spec §10.3): the app's persist layer, or a fake in tests. */
export interface KeyStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}
export const DEVICE_KEY = 'enc.deviceKey';
export const WRAPPED_KEY = 'enc.wrappedKey';
const WRAP_AAD = new TextEncoder().encode(WRAPPED_KEY);

export class PassphraseKeyring implements Keyring {
  private held: CryptoKey | undefined;
  /** the last store failure, in its own words, for Settings → About; never thrown */
  storeError: string | null = null;

  constructor(private readonly store: KeyStore | null = null) {}

  get unlocked(): boolean {
    return this.held !== undefined;
  }

  /** Derive from the passphrase and prove it against the config's check, then hold the key; with `remember`, wrap it for this device too. */
  async unlock(passphrase: string, config: EncryptionConfig, remember = false): Promise<void> {
    const raw = await deriveVerified(passphrase, config);
    try {
      this.held = await importBodyKey(raw.slice());
      if (remember) await this.remember(raw);
    } finally {
      raw.fill(0);
    }
  }

  /** Unlock from the device's remembered key. False when nothing is remembered or the store fails: locked, and the sheet asks. */
  async restore(): Promise<boolean> {
    if (!this.store) return false;
    try {
      const device = await this.store.get<CryptoKey>(DEVICE_KEY);
      const wrapped = await this.store.get<Uint8Array>(WRAPPED_KEY);
      if (!device || !wrapped || wrapped.length < NONCE_BYTES + TAG_BYTES) return false;
      const bytes = wrapped instanceof Uint8Array ? wrapped : new Uint8Array(wrapped as ArrayBufferLike);
      const raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, NONCE_BYTES), additionalData: WRAP_AAD, tagLength: TAG_BYTES * 8 }, device, bytes.slice(NONCE_BYTES)));
      this.held = await importBodyKey(raw);
      return true;
    } catch (e) {
      this.storeError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      return false;
    }
  }

  /** Drop the key for this session; the device may still remember it. */
  lock(): void {
    this.held = undefined;
  }

  /** Drop the key and forget it on this device. */
  async forget(): Promise<void> {
    this.lock();
    if (!this.store) return;
    try {
      await this.store.del(WRAPPED_KEY);
      await this.store.del(DEVICE_KEY);
    } catch (e) {
      this.storeError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
  }

  async key(): Promise<CryptoKey> {
    if (!this.held) throw new LockedError('the brain is encrypted and no key is unlocked');
    return this.held;
  }

  /** The raw key under a device key that never leaves the store extractable. A store failure is recorded, not thrown: the session is unlocked either way. */
  private async remember(raw: Uint8Array<ArrayBuffer>): Promise<void> {
    if (!this.store) return;
    try {
      let device = await this.store.get<CryptoKey>(DEVICE_KEY);
      if (!device) {
        device = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        await this.store.set(DEVICE_KEY, device);
      }
      const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
      const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: WRAP_AAD, tagLength: TAG_BYTES * 8 }, device, raw));
      const wrapped = new Uint8Array(NONCE_BYTES + sealed.length);
      wrapped.set(nonce);
      wrapped.set(sealed, NONCE_BYTES);
      await this.store.set(WRAPPED_KEY, wrapped);
      this.storeError = null;
    } catch (e) {
      this.storeError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
  }
}
