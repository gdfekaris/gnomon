// crypto — spec §6.4. The encrypted body format as pure functions over a
// WebCrypto AES-GCM key. No key storage, no passphrase derivation (that is
// the Phase 4 keyring); this module only turns a body into ciphertext and
// back, bound to the file's repo path through the AAD.

import { isExemptPath } from '../schema/paths';

/** The first line of an encrypted body. Files without it are plaintext. */
export const ENC_MARKER = '<!-- gnomon-enc v1 -->';
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;

/** Files whose bodies are never encrypted (spec §6.4): scaffold, templates, both indexes, attachments. */
export function isEncryptablePath(path: string): boolean {
  if (!path.endsWith('.md') || isExemptPath(path)) return false;
  return path !== 'principles/_index.md' && path !== 'maps/_index.md';
}

export function isEncryptedBody(body: string): boolean {
  return body === ENC_MARKER || body.startsWith(`${ENC_MARKER}\n`);
}

// ---- base64, dependency-free and identical in browser and Node
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2]! + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    out += c === undefined ? '=' : B64[c & 63]!;
  }
  return out;
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const clean = text.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 !== 0) throw new Error('malformed base64');
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((clean.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]!) << 18) | (B64.indexOf(clean[i + 1]!) << 12) | ((B64.indexOf(clean[i + 2]!) & 63) << 6) | (B64.indexOf(clean[i + 3]!) & 63);
    out[o++] = n >> 16;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

// ---- keys

/** Import 32 raw bytes as a non-extractable AES-256-GCM key and zero the input (spec §6.4). */
export async function importBodyKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error(`a body key is 32 bytes, not ${raw.length}`);
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  raw.fill(0);
  return key;
}

// ---- bodies

/** `nonce || ciphertext || tag`, base64, under the marker. AAD is the UTF-8 repo path. */
export async function encryptBody(key: CryptoKey, path: string, plaintext: string): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const sealed = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(path), tagLength: TAG_BYTES * 8 },
    key,
    new TextEncoder().encode(plaintext),
  ));
  const payload = new Uint8Array(NONCE_BYTES + sealed.length);
  payload.set(nonce);
  payload.set(sealed, NONCE_BYTES);
  return `${ENC_MARKER}\n${toBase64(payload)}\n`;
}

export class DecryptError extends Error {
  override name = 'DecryptError';
}

/** The plaintext of an encrypted body. Throws DecryptError on a wrong key, a wrong path, or a damaged payload. */
export async function decryptBody(key: CryptoKey, path: string, body: string): Promise<string> {
  if (!isEncryptedBody(body)) throw new DecryptError(`${path}: body is not encrypted`);
  let payload: Uint8Array<ArrayBuffer>;
  try {
    payload = fromBase64(body.slice(ENC_MARKER.length));
  } catch {
    throw new DecryptError(`${path}: payload is not base64`);
  }
  if (payload.length < NONCE_BYTES + TAG_BYTES) throw new DecryptError(`${path}: payload is too short`);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: payload.slice(0, NONCE_BYTES), additionalData: new TextEncoder().encode(path), tagLength: TAG_BYTES * 8 },
      key,
      payload.slice(NONCE_BYTES),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new DecryptError(`${path}: cannot decrypt (wrong key, wrong path, or damaged payload)`);
  }
}

/** Decrypt when the body carries the marker, else return it unchanged. Mixed brains are the norm during enablement. */
export async function decryptIfEncrypted(key: CryptoKey, path: string, body: string): Promise<{ body: string; encrypted: boolean }> {
  return isEncryptedBody(body) ? { body: await decryptBody(key, path, body), encrypted: true } : { body, encrypted: false };
}

/** The `.gnomon/encryption.json` document (spec §6.4). Written and read by the Phase 4 keyring; typed here so both sides agree. */
export interface EncryptionConfig {
  version: 1;
  kdf: 'argon2id13';
  /** base64, 16 bytes */
  salt: string;
  opslimit: number;
  memlimit: number;
  /** base64 AES-GCM encryption of the constant below under the derived key, AAD = the config path */
  check: string;
}
export const ENCRYPTION_CONFIG_PATH = '.gnomon/encryption.json';
export const ENCRYPTION_CHECK_PLAINTEXT = 'gnomon-ok';
