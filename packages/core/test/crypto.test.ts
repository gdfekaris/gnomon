import { describe, expect, it } from 'vitest';
import {
  DecryptError, ENC_MARKER, decryptBody, decryptIfEncrypted, encryptBody, fromBase64, importBodyKey, isEncryptablePath,
  isEncryptedBody, parseFile, serializeFile, toBase64,
} from '../src/index';
import { FIXTURE, snapshotFromDisk } from './brains';

/** The stub keyring: a fixed 32-byte key. Phase 4 derives it from a passphrase instead. */
const stubKey = () => importBodyKey(new Uint8Array(32).map((_, i) => i * 7 + 1));
const otherKey = () => importBodyKey(new Uint8Array(32).fill(9));

describe('base64', () => {
  it('round-trips every length mod 3 and matches the platform encoder', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 6, 31, 32, 33, 100]) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 37 + 11) & 255);
      const text = toBase64(bytes);
      expect(text).toBe(Buffer.from(bytes).toString('base64'));
      expect(fromBase64(text)).toEqual(bytes);
    }
  });
  it('accepts wrapped input and rejects garbage', () => {
    expect(fromBase64('aGVs\nbG8=\n')).toEqual(new TextEncoder().encode('hello'));
    expect(() => fromBase64('a')).toThrow(/base64/);
    expect(() => fromBase64('!!!!')).toThrow(/base64/);
  });
});

describe('isEncryptablePath (spec §6.4)', () => {
  it('excludes the scaffold, templates, indexes, dot-directories, and attachments', () => {
    for (const p of ['AGENTS.md', 'README.md', 'templates/raw.md', 'principles/_index.md', 'maps/_index.md', '.gnomon/encryption.json', '.claude/commands/reason.md', 'sources/a-b/original.pdf', 'inbox/20260905-143012-x7q.pdf']) {
      expect(isEncryptablePath(p), p).toBe(false);
    }
  });
  it('includes every other brain file, _set.md and proposals among them', () => {
    for (const p of ['sources/a-b/raw.md', 'sources/a-b/notes.md', 'principles/ps-g8xw/_set.md', 'principles/ps-g8xw/x.md', 'inbox/20260905-143012-x7q.md', 'maps/proposals/P-20260905-001.md']) {
      expect(isEncryptablePath(p), p).toBe(true);
    }
  });
});

describe('encrypted body format (spec §6.4)', () => {
  const path = 'sources/a-b/raw.md';
  const plaintext = 'Men seek retreats for themselves.\n\nAnd thou too.\n';

  it('encrypts under the marker and decrypts back to the identical plaintext', async () => {
    const key = await stubKey();
    const body = await encryptBody(key, path, plaintext);
    expect(body.startsWith(`${ENC_MARKER}\n`)).toBe(true);
    expect(body.endsWith('\n')).toBe(true);
    expect(body.split('\n')).toHaveLength(3); // marker, payload, trailing newline
    expect(isEncryptedBody(body)).toBe(true);
    expect(await decryptBody(key, path, body)).toBe(plaintext);
  });
  it('payload is nonce(12) || ciphertext || tag(16)', async () => {
    const key = await stubKey();
    const body = await encryptBody(key, path, plaintext);
    const payload = fromBase64(body.slice(ENC_MARKER.length));
    expect(payload.length).toBe(12 + new TextEncoder().encode(plaintext).length + 16);
  });
  it('uses a fresh nonce each time, so ciphertexts differ while plaintexts agree', async () => {
    const key = await stubKey();
    const a = await encryptBody(key, path, plaintext);
    const b = await encryptBody(key, path, plaintext);
    expect(a).not.toBe(b);
    expect(await decryptBody(key, path, a)).toBe(await decryptBody(key, path, b));
  });
  it('the empty body and non-ASCII text round-trip', async () => {
    const key = await stubKey();
    for (const text of ['', 'Élan — "vital" 𝔘\n']) expect(await decryptBody(key, path, await encryptBody(key, path, text))).toBe(text);
  });
  it('AAD path binding: the same ciphertext fails under any other path', async () => {
    const key = await stubKey();
    const body = await encryptBody(key, path, plaintext);
    await expect(decryptBody(key, 'sources/c-d/raw.md', body)).rejects.toBeInstanceOf(DecryptError);
    await expect(decryptBody(key, path, body)).resolves.toBe(plaintext);
  });
  it('fails under a different key and on a damaged payload', async () => {
    const key = await stubKey();
    const body = await encryptBody(key, path, plaintext);
    await expect(decryptBody(await otherKey(), path, body)).rejects.toBeInstanceOf(DecryptError);
    const bytes = fromBase64(body.slice(ENC_MARKER.length));
    bytes[20] = bytes[20]! ^ 1;
    await expect(decryptBody(key, path, `${ENC_MARKER}\n${toBase64(bytes)}\n`)).rejects.toBeInstanceOf(DecryptError);
    await expect(decryptBody(key, path, `${ENC_MARKER}\nnot base64!\n`)).rejects.toThrow(/base64/);
    await expect(decryptBody(key, path, `${ENC_MARKER}\nAAAA\n`)).rejects.toThrow(/too short/);
    await expect(decryptBody(key, path, plaintext)).rejects.toThrow(/not encrypted/);
  });
  it('decryptIfEncrypted passes plaintext through and flags ciphertext', async () => {
    const key = await stubKey();
    expect(await decryptIfEncrypted(key, path, plaintext)).toEqual({ body: plaintext, encrypted: false });
    expect(await decryptIfEncrypted(key, path, await encryptBody(key, path, plaintext))).toEqual({ body: plaintext, encrypted: true });
  });
  it('importBodyKey demands 32 bytes and zeroes them', async () => {
    const raw = new Uint8Array(32).fill(5);
    await importBodyKey(raw);
    expect(raw.every((b) => b === 0)).toBe(true);
    await expect(importBodyKey(new Uint8Array(16))).rejects.toThrow(/32 bytes/);
  });
});

describe('an encrypted file is still a valid brain file', () => {
  it('frontmatter stays cleartext, the body is the marker plus payload, and parse/serialize round-trip it', async () => {
    const key = await stubKey();
    const snapshot = snapshotFromDisk(FIXTURE);
    for (const file of snapshot.files.values()) {
      if (!isEncryptablePath(file.path)) continue;
      const sealed = { ...file, body: await encryptBody(key, file.path, file.body) };
      const text = serializeFile(sealed);
      const back = parseFile(file.path, text);
      expect(back.fm).toEqual(file.fm);
      expect(isEncryptedBody(back.body)).toBe(true);
      expect(await decryptBody(key, file.path, back.body)).toBe(file.body);
    }
  });
});
