// Schema §11.3, §11.4: canonical JSON, signed bytes, the word list, the
// recovery phrase, root derivation, and signatures, each checked against an
// independent implementation where one exists (Node's crypto).
import { createPrivateKey, createPublicKey, hkdfSync, verify as nodeVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BIP39_ENGLISH, PhraseError, canonicalJson, deriveRoot, digest, ed25519Signer, entropyToPhrase, fingerprint, fromBase64, generateDeviceKey, keyId, phraseToEntropy,
  signedBytes, utf8, verifySignature,
} from '../src/index';

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const nodeEd25519Public = (seed: Uint8Array) =>
  new Uint8Array(createPublicKey(createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(seed)]), format: 'der', type: 'pkcs8' })).export({ format: 'der', type: 'spki' }).subarray(12));

describe('canonical JSON (RFC 8785 for payload values)', () => {
  it('sorts keys by UTF-16 code units, recursively, with no whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: null, c: 'x' }, A: 0, é: 'é' })).toBe('{"A":0,"a":{"c":"x","d":null},"b":1,"é":"é"}');
  });
  it('escapes as JSON.stringify does', () => {
    expect(canonicalJson('a"b\\c\n\t\u0001é😀')).toBe('"a\\"b\\\\c\\n\\t\\u0001é😀"');
  });
  it('refuses what a payload cannot hold', () => {
    for (const bad of [1.5, -1, 2 ** 53, true, [1], undefined, '\uD800']) expect(() => canonicalJson(bad)).toThrow();
  });
  it('prefixes a context line per kind, so one kind never verifies as another', () => {
    expect(new TextDecoder().decode(signedBytes('seal', { v: 1 }))).toBe('gnomon-seal v1\n{"v":1}');
    expect(new TextDecoder().decode(signedBytes('enroll', { v: 1 }))).toBe('gnomon-enroll v1\n{"v":1}');
    expect(new TextDecoder().decode(signedBytes('revoke', { v: 1 }))).toBe('gnomon-revoke v1\n{"v":1}');
  });
  it('digests as sha256: and lowercase hex', async () => {
    expect(await digest(utf8('abc'))).toBe('sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('the recovery phrase (BIP-39 English, 24 words)', () => {
  it('ships the published word list unchanged', async () => {
    expect(BIP39_ENGLISH).toHaveLength(2048);
    expect(await digest(utf8(`${BIP39_ENGLISH.join('\n')}\n`))).toBe('sha256:2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda');
  });
  it('matches the BIP-39 test vectors for 256-bit entropy', async () => {
    expect((await entropyToPhrase(new Uint8Array(32))).join(' ')).toBe(`${'abandon '.repeat(23)}art`);
    expect((await entropyToPhrase(new Uint8Array(32).fill(0xff))).join(' ')).toBe(`${'zoo '.repeat(23)}vote`);
  });
  it('round-trips, case and spacing aside', async () => {
    const entropy = crypto.getRandomValues(new Uint8Array(32));
    const words = await entropyToPhrase(entropy);
    expect(await phraseToEntropy(`  ${words.join('  ').toUpperCase()} `)).toEqual(entropy);
  });
  it('refuses a wrong count, an unknown word, and a bad checksum', async () => {
    const words = await entropyToPhrase(new Uint8Array(32).fill(9));
    await expect(phraseToEntropy(words.slice(1))).rejects.toThrow(PhraseError);
    await expect(phraseToEntropy([...words.slice(0, 23), 'gnomon'])).rejects.toThrow(/not a word/);
    const swapped = [...words];
    [swapped[0], swapped[1]] = [words[1]!, words[0]!];
    if (swapped[0] !== words[0]) await expect(phraseToEntropy(swapped)).rejects.toThrow(/does not check out/);
    await expect(phraseToEntropy([...words.slice(0, 23), words[23] === 'zoo' ? 'abandon' : 'zoo'])).rejects.toThrow(PhraseError);
  });
});

describe('the root (schema §11.4)', () => {
  it('is Ed25519 from HKDF-SHA256(entropy, no salt, "gnomon root v1"), as Node computes it', async () => {
    const entropy = new Uint8Array(32).fill(7);
    const seed = new Uint8Array(hkdfSync('sha256', entropy, new Uint8Array(0), 'gnomon root v1', 32));
    const root = await deriveRoot(entropy);
    expect(fromBase64(root.pub)).toEqual(nodeEd25519Public(seed));
    expect(root.keyId).toBe(await keyId('ed25519', root.pub));
    expect(root.keyId).toMatch(/^[0-9a-f]{32}$/);
    expect(fingerprint(root.keyId).split(' ')).toHaveLength(8);
  });
  it('signs what Node verifies, and stops signing usefully once wiped', async () => {
    const root = await deriveRoot(new Uint8Array(32).fill(7));
    const msg = utf8('gnomon-enroll v1\n{}');
    const sig = await root.sign(msg);
    const spki = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(fromBase64(root.pub))]), format: 'der', type: 'spki' });
    expect(nodeVerify(null, msg, spki, Buffer.from(fromBase64(sig)))).toBe(true);
    root.wipe();
    expect(await verifySignature('ed25519', root.pub, await root.sign(msg), msg)).toBe(false);
  });
});

describe('signatures (schema §11.4)', () => {
  it('verifies Ed25519 and rejects a changed message or key', async () => {
    const k = await ed25519Signer(new Uint8Array(32).fill(3));
    const other = await ed25519Signer(new Uint8Array(32).fill(4));
    const msg = utf8('hello');
    const sig = await k.sign(msg);
    expect(await verifySignature('ed25519', k.pub, sig, msg)).toBe(true);
    expect(await verifySignature('ed25519', k.pub, sig, utf8('hellO'))).toBe(false);
    expect(await verifySignature('ed25519', other.pub, sig, msg)).toBe(false);
    expect(await verifySignature('ed25519', k.pub, 'not base64!', msg)).toBe(false);
  });
  it('makes non-extractable P-256 and Ed25519 device keys whose signatures verify, P-256 as Node reads IEEE P1363', async () => {
    for (const prefer of ['p256', 'ed25519'] as const) {
      const { privateKey, signer } = await generateDeviceKey(prefer);
      expect(privateKey.extractable).toBe(false);
      await expect(crypto.subtle.exportKey('pkcs8', privateKey)).rejects.toThrow();
      const msg = utf8('a seal');
      const sig = await signer.sign(msg);
      expect(await verifySignature(signer.alg, signer.pub, sig, msg)).toBe(true);
      expect(await verifySignature(signer.alg, signer.pub, sig, utf8('another'))).toBe(false);
      if (signer.alg === 'p256') {
        const jwk = createPublicKey({ key: Buffer.concat([Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex'), Buffer.from(fromBase64(signer.pub))]), format: 'der', type: 'spki' });
        expect(nodeVerify('sha256', msg, { key: jwk, dsaEncoding: 'ieee-p1363' }, Buffer.from(fromBase64(sig)))).toBe(true);
      }
    }
  });
});
