// Sealing keys — schema §11.4: key ids, signature verification for the three
// algorithms, signers (libsodium seeds, non-extractable WebCrypto keys), the
// root derived from the recovery phrase, and the phrase itself (BIP-39).
import { fromBase64, toBase64 } from '../crypto/body';
import { loadSodium } from '../crypto/passphrase';
import { concat, hex, sha256, utf8 } from './encoding';
import { parseSkPublicKey, verifySshsig } from './sshsig';
import { BIP39_ENGLISH } from './wordlist';

export type SealAlg = 'ed25519' | 'p256' | 'sk-ed25519';
export const SEAL_ALGS: readonly SealAlg[] = ['ed25519', 'p256', 'sk-ed25519'];

/** Something that signs a payload's signed bytes and returns the `sig` string (schema §11.4). */
export interface Signer {
  keyId: string;
  alg: SealAlg;
  pub: string;
  sign(bytes: Uint8Array): Promise<string>;
}

/** The bytes a key id is computed over; throws when `pub` is not a key of `alg`. */
export function keyBytes(alg: SealAlg, pub: string): Uint8Array {
  if (alg === 'sk-ed25519') return parseSkPublicKey(pub).blob;
  const b = fromBase64(pub);
  const want = alg === 'ed25519' ? 32 : 65;
  if (b.length !== want || (alg === 'p256' && b[0] !== 4)) throw new Error(`not an ${alg} public key`);
  return b;
}

/** The first 16 bytes of SHA-256 of the key, lowercase hex (schema §11.4). */
export async function keyId(alg: SealAlg, pub: string): Promise<string> {
  return hex((await sha256(keyBytes(alg, pub))).slice(0, 16));
}

/** The fingerprint people compare: the key id in eight groups of four. */
export const fingerprint = (id: string): string => id.match(/.{1,4}/g)!.join(' ');

/** True when `sig` is a valid signature by (`alg`, `pub`) over `message`. Never throws. */
export async function verifySignature(alg: SealAlg, pub: string, sig: string, message: Uint8Array): Promise<boolean> {
  try {
    if (alg === 'sk-ed25519') return await verifySshsig(sig, pub, message);
    const key = keyBytes(alg, pub);
    const s = fromBase64(sig);
    if (s.length !== 64) return false;
    if (alg === 'ed25519') return (await loadSodium()).crypto_sign_verify_detached(s, message, key);
    const k = await crypto.subtle.importKey('raw', new Uint8Array(key), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, s, new Uint8Array(message));
  } catch {
    return false;
  }
}

/** An Ed25519 signer from a 32-byte seed (the root, and tests). `wipe` zeroes the secret. */
export async function ed25519Signer(seed: Uint8Array): Promise<Signer & { wipe(): void }> {
  if (seed.length !== 32) throw new Error('an Ed25519 seed is 32 bytes');
  const sodium = await loadSodium();
  const pair = sodium.crypto_sign_seed_keypair(seed);
  const pub = toBase64(pair.publicKey);
  return {
    alg: 'ed25519',
    pub,
    keyId: await keyId('ed25519', pub),
    sign: async (bytes) => toBase64(sodium.crypto_sign_detached(bytes, pair.privateKey)),
    wipe: () => sodium.memzero(pair.privateKey),
  };
}

/** A signer over a WebCrypto private key (the phone's, non-extractable). */
export async function cryptoKeySigner(privateKey: CryptoKey, alg: 'ed25519' | 'p256', pub: string): Promise<Signer> {
  const params = alg === 'ed25519' ? { name: 'Ed25519' } : { name: 'ECDSA', hash: 'SHA-256' };
  return {
    alg,
    pub,
    keyId: await keyId(alg, pub),
    sign: async (bytes) => toBase64(new Uint8Array(await crypto.subtle.sign(params, privateKey, new Uint8Array(bytes)))),
  };
}

/**
 * The phone's device key (spec §6.5): non-extractable, Ed25519 where WebCrypto
 * offers it, else ECDSA P-256. The public half is exported; the private half
 * can sign and nothing else.
 */
export async function generateDeviceKey(prefer: 'ed25519' | 'p256' = 'ed25519'): Promise<{ privateKey: CryptoKey; signer: Signer }> {
  const tryAlg = async (alg: 'ed25519' | 'p256') => {
    const pair = (
      alg === 'ed25519'
        ? await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
        : await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' } satisfies EcKeyGenParams, false, ['sign', 'verify'])
    ) as CryptoKeyPair;
    const pub = toBase64(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
    return { privateKey: pair.privateKey, signer: await cryptoKeySigner(pair.privateKey, alg, pub) };
  };
  if (prefer === 'p256') return tryAlg('p256');
  try {
    return await tryAlg('ed25519');
  } catch {
    return tryAlg('p256');
  }
}

export const ENTROPY_BYTES = 32;
export const newEntropy = (): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(ENTROPY_BYTES));

/** The root key (schema §11.4): Ed25519 from HKDF-SHA256(entropy, no salt, info "gnomon root v1", 32). */
export async function deriveRoot(entropy: Uint8Array): Promise<Signer & { wipe(): void }> {
  if (entropy.length !== ENTROPY_BYTES) throw new Error('the root entropy is 32 bytes');
  const ikm = await crypto.subtle.importKey('raw', new Uint8Array(entropy), 'HKDF', false, ['deriveBits']);
  const seed = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8('gnomon root v1') }, ikm, 256));
  try {
    return await ed25519Signer(seed);
  } finally {
    seed.fill(0);
  }
}

export class PhraseError extends Error {
  override name = 'PhraseError';
}

/** The 24 BIP-39 English words for 32 bytes of entropy, checksum included (schema §11.4). */
export async function entropyToPhrase(entropy: Uint8Array): Promise<string[]> {
  if (entropy.length !== ENTROPY_BYTES) throw new Error('the root entropy is 32 bytes');
  const bits = concat(entropy, (await sha256(entropy)).slice(0, 1));
  const words: string[] = [];
  for (let i = 0; i < 24; i++) {
    let n = 0;
    for (let j = 0; j < 11; j++) {
      const bit = i * 11 + j;
      n = (n << 1) | ((bits[bit >> 3]! >> (7 - (bit & 7))) & 1);
    }
    words.push(BIP39_ENGLISH[n]!);
  }
  return words;
}

/** The entropy behind a typed phrase; throws PhraseError on an unknown word, a wrong count, or a bad checksum. */
export async function phraseToEntropy(phrase: string | string[]): Promise<Uint8Array<ArrayBuffer>> {
  const words = (Array.isArray(phrase) ? phrase : phrase.trim().split(/\s+/)).map((w) => w.toLowerCase());
  if (words.length !== 24) throw new PhraseError(`a recovery phrase has 24 words, not ${words.length}`);
  const bits = new Uint8Array(33);
  words.forEach((w, i) => {
    const n = BIP39_ENGLISH.indexOf(w);
    if (n < 0) throw new PhraseError(`"${w}" is not a word of the phrase list`);
    for (let j = 0; j < 11; j++) {
      const bit = i * 11 + j;
      if ((n >> (10 - j)) & 1) bits[bit >> 3] = (bits[bit >> 3] ?? 0) | (1 << (7 - (bit & 7)));
    }
  });
  const entropy = bits.slice(0, 32);
  if ((await sha256(entropy))[0] !== bits[32]) throw new PhraseError('the phrase does not check out; a word is wrong or out of place');
  return entropy;
}
