// Keyring — what the EncryptingDriver asks for a key (spec §6.4). Phase 4
// derives the key from a passphrase with Argon2id and may wrap it under a
// device key; Phase 1 needs only the interface and an in-memory holder.

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
