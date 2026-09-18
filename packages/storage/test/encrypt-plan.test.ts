import { describe, expect, it } from 'vitest';
import { type BrainSnapshot, DecryptError, ENCRYPTION_CONFIG_PATH, KDF_PRESETS, encryptedBodyCount, isEncryptedBody, newEncryptionConfig, parseEncryptionConfig, planDecrypt, planEncrypt, planRekey, unlockWithPassphrase, validateSnapshot } from '@gnomon/core';
import { EncryptingDriver, HeadMovedError, MemoryDriver, StaticKeyring, loadSnapshot } from '../src/index';
import { readBrainBytes } from './fixture';

// Spec §6.4 "Enabling encryption on an existing brain", Phase 4 block 2: each is one commit through the plain driver.
const FAST = KDF_PRESETS.interactive;
const texts = async (driver: MemoryDriver, paths: string[]) => new Map([...(await driver.readMany(paths))].map(([p, r]) => [p, r.text]));
const mdPaths = (s: BrainSnapshot) => [...s.files.keys()];

describe('planEncrypt, planDecrypt, planRekey over MemoryDriver', () => {
  it('encrypt then decrypt leaves every body byte-identical, with the config added then removed', async () => {
    const inner = await MemoryDriver.create(readBrainBytes());
    const plain = await loadSnapshot(inner);
    const before = await texts(inner, mdPaths(plain));
    const { config, key } = await newEncryptionConfig('open sesame', FAST);

    const enc = await planEncrypt(plain, key, config);
    expect(enc.message).toBe('Encrypt: 23 files'); // every .md but the scaffold, templates, and the two indexes
    expect(enc.expectedHead).toBe(plain.head);
    expect(enc.writes.map((w) => w.path)).toContain(ENCRYPTION_CONFIG_PATH);
    expect(enc.writes.some((w) => w.path === 'principles/_index.md' || w.path === 'AGENTS.md' || w.path.startsWith('templates/'))).toBe(false);
    await inner.commit(enc);

    // at rest: cleartext frontmatter, ciphertext bodies, the config present; without the key the validator runs its frontmatter rules and stands aside on bodies
    const stored = await loadSnapshot(inner);
    expect(encryptedBodyCount(stored)).toBe(23);
    expect(stored.files.get('sources/weil-attention/raw.md')!.body).not.toContain('attention');
    expect(validateSnapshot(stored).filter((i) => i.level === 'refusal')).toEqual([]);
    expect(validateSnapshot(stored).filter((i) => i.rule === 'grounds.drift')).toEqual([]);
    expect(parseEncryptionConfig((await inner.readMany([ENCRYPTION_CONFIG_PATH])).get(ENCRYPTION_CONFIG_PATH)!.text)).toEqual(config);
    for (const p of mdPaths(plain)) {
      const t = (await inner.readMany([p])).get(p)!.text;
      const isEncryptable = !p.startsWith('templates/') && !p.endsWith('_index.md') && p !== 'AGENTS.md' && p !== 'README.md';
      expect(isEncryptedBody(t.split('\n---\n')[1] ?? ''), p).toBe(isEncryptable);
    }

    // through the key: plaintext, marked encrypted, validating clean like the original
    const through = new EncryptingDriver(inner, new StaticKeyring(key));
    const open = await loadSnapshot(through);
    expect(encryptedBodyCount(open)).toBe(0);
    expect([...open.files.values()].filter((f) => f.encrypted).length).toBe(23);
    expect(validateSnapshot(open)).toEqual([]);
    for (const p of mdPaths(plain)) expect(open.files.get(p)!.body, p).toBe(plain.files.get(p)!.body);

    // a second enable is a no-op batch but for the config
    expect((await planEncrypt(open, key, config)).writes.map((w) => w.path)).toEqual([ENCRYPTION_CONFIG_PATH]);

    const dec = planDecrypt(open);
    expect(dec.message).toBe('Decrypt: 23 files');
    expect(dec.deletes).toEqual([ENCRYPTION_CONFIG_PATH]);
    await inner.commit(dec);
    const after = await texts(inner, mdPaths(plain));
    expect(after).toEqual(before);
    expect((await inner.list()).some((e) => e.path === ENCRYPTION_CONFIG_PATH)).toBe(false);
    expect(validateSnapshot(await loadSnapshot(inner))).toEqual([]);
  }, 60_000);

  it('rekey decrypts with the new passphrase and refuses the old', async () => {
    const inner = await MemoryDriver.create(readBrainBytes());
    const plain = await loadSnapshot(inner);
    const first = await newEncryptionConfig('old words', FAST);
    await inner.commit(await planEncrypt(plain, first.key, first.config));
    const open = await loadSnapshot(new EncryptingDriver(inner, new StaticKeyring(first.key)));

    const second = await newEncryptionConfig('new words', FAST);
    const rekey = await planRekey(open, second.key, second.config);
    expect(rekey.message).toBe('Change passphrase');
    expect(rekey.writes.length).toBe(24);
    await inner.commit(rekey);

    const config = parseEncryptionConfig((await inner.readMany([ENCRYPTION_CONFIG_PATH])).get(ENCRYPTION_CONFIG_PATH)!.text);
    expect(config.salt).not.toBe(first.config.salt);
    await expect(unlockWithPassphrase('old words', config)).rejects.toThrow(/does not unlock/);
    const key = await unlockWithPassphrase('new words', config);
    const reopened = await loadSnapshot(new EncryptingDriver(inner, new StaticKeyring(key)));
    for (const p of mdPaths(plain)) expect(reopened.files.get(p)!.body, p).toBe(plain.files.get(p)!.body);
    await expect(loadSnapshot(new EncryptingDriver(inner, new StaticKeyring(first.key)))).rejects.toBeInstanceOf(DecryptError);
  }, 60_000);

  it('a head that moved mid-operation is refused with nothing written, and a snapshot without its key is refused before any plan', async () => {
    const inner = await MemoryDriver.create(readBrainBytes());
    const plain = await loadSnapshot(inner);
    const { config, key } = await newEncryptionConfig('open sesame', FAST);
    const enc = await planEncrypt(plain, key, config);
    const head = await inner.head();
    await inner.commit({ message: 'Capture: 20260917-090000-abc', expectedHead: head, writes: [{ path: 'inbox/20260917-090000-abc.md', text: '---\ntype: inbox\nstatus: unfiled\ncurated: human\ncreated: 2026-09-17T09:00:00Z\nupdated: 2026-09-17T09:00:00Z\n---\nLater.\n' }], deletes: [] });
    const moved = await inner.head();
    await expect(inner.commit(enc)).rejects.toBeInstanceOf(HeadMovedError);
    expect(await inner.head()).toBe(moved);
    expect((await inner.list()).some((e) => e.path === ENCRYPTION_CONFIG_PATH)).toBe(false);
    expect(encryptedBodyCount(await loadSnapshot(inner))).toBe(0);

    await inner.commit(await planEncrypt(await loadSnapshot(inner), key, config));
    const locked = await loadSnapshot(inner);
    await expect(planEncrypt(locked, key, config)).rejects.toThrow(/still ciphertext/);
    expect(() => planDecrypt(locked)).toThrow(/still ciphertext/);
  }, 60_000);
});
