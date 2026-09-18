// crypto — spec §6.4. The encrypted body format (body.ts: pure functions
// over a WebCrypto AES-GCM key, bound to the file's repo path through the
// AAD) and the passphrase key derivation (passphrase.ts: Argon2id through
// libsodium, the `.gnomon/encryption.json` config, the check). No key
// storage here; that is the storage package's keyring.

export * from './body';
export * from './passphrase';
