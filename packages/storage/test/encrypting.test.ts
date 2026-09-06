import { describe, expect, it } from 'vitest';
import type { InboxFm } from '@gnomon/core';
import { DecryptError, ENC_MARKER, buildFiling, importBodyKey, isEncryptedBody, splitFrontmatter, validateSnapshot } from '@gnomon/core';
import { EncryptingDriver, LockedError, MemoryDriver, StaticKeyring, loadSnapshot } from '../src/index';
import { driverContract } from './contract';
import { readBrainBytes } from './fixture';

const keyBytes = (fill: number) => new Uint8Array(32).map((_, i) => (i * 7 + fill) & 255);
const stubKeyring = async (fill = 1) => new StaticKeyring(await importBodyKey(keyBytes(fill)));

driverContract('EncryptingDriver(MemoryDriver)', async (seed) => new EncryptingDriver(await MemoryDriver.create(seed), await stubKeyring()), { patchesAreStoredBytes: true });

describe('EncryptingDriver (spec §6.4)', () => {
  const NOTES = 'sources/weil-attention/notes.md';
  const NOW = '2026-09-06T12:00:00Z';
  async function pair(fill = 1) {
    const inner = await MemoryDriver.create(readBrainBytes());
    const keyring = await stubKeyring(fill);
    return { inner, keyring, driver: new EncryptingDriver(inner, keyring) };
  }

  it('stores ciphertext for encryptable paths and returns plaintext with the encrypted flag', async () => {
    const { inner, driver } = await pair();
    const head = await driver.head();
    const text = '---\ntype: notes\nsource: weil-attention\ncurated: human\ncreated: 2026-09-04T21:30:00Z\nupdated: 2026-09-06T12:00:00Z\n---\nSecret marginalia.\n';
    await driver.commit({ message: 'x', expectedHead: head, writes: [{ path: NOTES, text }], deletes: [] });

    const stored = (await inner.readMany([NOTES])).get(NOTES)!;
    const split = splitFrontmatter(stored.text)!;
    expect(split.yaml).toBe('type: notes\nsource: weil-attention\ncurated: human\ncreated: 2026-09-04T21:30:00Z\nupdated: 2026-09-06T12:00:00Z');
    expect(isEncryptedBody(split.body)).toBe(true);
    expect(stored.text).not.toContain('Secret');

    const read = (await driver.readMany([NOTES])).get(NOTES)!;
    expect(read).toEqual({ text, sha: stored.sha, encrypted: true });
  });

  it('never encrypts the scaffold, templates, index files, or attachments', async () => {
    const { inner, driver } = await pair();
    const head = await driver.head();
    const bytes = new Uint8Array([1, 2, 3]);
    await driver.commit({
      message: 'x', expectedHead: head,
      writes: [
        { path: 'README.md', text: '# Mine\n' },
        { path: 'templates/raw.md', text: '---\ntype: source\n---\n{{body}}\n' },
        { path: 'principles/_index.md', text: '---\ntype: index\n---\n<!-- GENERATED -->\n' },
        { path: 'inbox/20260906-090000-q2w.png', bytes },
      ],
      deletes: [],
    });
    for (const p of ['README.md', 'templates/raw.md', 'principles/_index.md']) {
      expect((await inner.readMany([p])).get(p)!.text).not.toContain(ENC_MARKER);
    }
    expect((await inner.readBytes('inbox/20260906-090000-q2w.png')).bytes).toEqual(bytes);
    expect((await driver.readMany(['README.md'])).get('README.md')).toMatchObject({ text: '# Mine\n', encrypted: false });
  });

  it('a mixed brain: plaintext files pass through unencrypted, rewrites encrypt them', async () => {
    const { inner, driver } = await pair();
    const before = (await driver.readMany([NOTES])).get(NOTES)!;
    expect(before.encrypted).toBe(false);
    expect((await inner.readMany([NOTES])).get(NOTES)!.text).toBe(before.text);
    const s = await loadSnapshot(driver);
    expect(validateSnapshot(s)).toEqual([]);
    expect([...s.files.values()].every((f) => !f.encrypted)).toBe(true);

    await driver.commit({ message: 'x', expectedHead: s.head, writes: [{ path: NOTES, text: before.text + 'Now mine.\n' }], deletes: [] });
    const after = await loadSnapshot(driver);
    expect(after.files.get(NOTES)!.encrypted).toBe(true);
    expect(after.files.get(NOTES)!.body).toContain('Now mine.');
    expect(validateSnapshot(after)).toEqual([]);
  });

  it('keeps the stored ciphertext when only the frontmatter changes, so a filing diffs by two lines', async () => {
    const { inner, driver } = await pair();
    // Encrypt the capture first by rewriting it unchanged.
    const capturePath = 'inbox/20260906-070000-2bq.md';
    const s0 = await loadSnapshot(driver);
    const original = (await driver.readMany([capturePath])).get(capturePath)!.text;
    await driver.commit({ message: 'encrypt', expectedHead: s0.head, writes: [{ path: capturePath, text: original }], deletes: [] });
    const sealedBefore = splitFrontmatter((await inner.readMany([capturePath])).get(capturePath)!.text)!.body;
    expect(isEncryptedBody(sealedBefore)).toBe(true);

    const s1 = await loadSnapshot(driver);
    const capture = s1.files.get(capturePath)!;
    expect(capture.encrypted).toBe(true);
    const batch = buildFiling(s1, capture as never, { title: 'Dance', author: 'Alan Watts' }, [], { now: NOW });
    const { sha } = await driver.commit(batch);

    const sealedAfter = splitFrontmatter((await inner.readMany([capturePath])).get(capturePath)!.text)!.body;
    expect(sealedAfter).toBe(sealedBefore);
    const change = (await driver.compare(s1.head, sha)).find((c) => c.path === capturePath)!;
    expect(change.patch!.split('\n').filter((l) => l.startsWith('+'))).toEqual(['+status: filed', '+filed_as: watts-dance']);
    expect(change.patch!.split('\n').filter((l) => l.startsWith('-'))).toEqual(['-status: unfiled']);

    const s2 = await loadSnapshot(driver);
    expect((s2.files.get(capturePath)!.fm as InboxFm).filed_as).toBe('watts-dance');
    expect(s2.files.get('sources/watts-dance/raw.md')!.encrypted).toBe(true);
    expect(s2.files.get('sources/watts-dance/raw.md')!.body).toBe(capture.body);
    expect(validateSnapshot(s2)).toEqual([]);
  });

  it('an identical rewrite produces an identical blob', async () => {
    const { inner, driver } = await pair();
    const h0 = await driver.head();
    const text = (await driver.readMany([NOTES])).get(NOTES)!.text + 'x\n';
    await driver.commit({ message: 'a', expectedHead: h0, writes: [{ path: NOTES, text }], deletes: [] });
    const sha1 = (await inner.list()).find((e) => e.path === NOTES)!.sha;
    await driver.commit({ message: 'b', expectedHead: await driver.head(), writes: [{ path: NOTES, text }], deletes: [] });
    expect((await inner.list()).find((e) => e.path === NOTES)!.sha).toBe(sha1);
  });

  it('a locked keyring still reads plaintext, but encrypted reads and encryptable writes throw LockedError', async () => {
    const { driver, keyring } = await pair();
    const h0 = await driver.head();
    const text = (await driver.readMany([NOTES])).get(NOTES)!.text + 'x\n';
    await driver.commit({ message: 'a', expectedHead: h0, writes: [{ path: NOTES, text }], deletes: [] });
    keyring.lock();
    expect(keyring.unlocked).toBe(false);
    expect((await driver.readMany(['README.md'])).get('README.md')!.encrypted).toBe(false);
    await expect(driver.readMany([NOTES])).rejects.toBeInstanceOf(LockedError);
    await expect(driver.commit({ message: 'b', expectedHead: await driver.head(), writes: [{ path: NOTES, text }], deletes: [] })).rejects.toBeInstanceOf(LockedError);
    await expect(driver.commit({ message: 'c', expectedHead: await driver.head(), writes: [{ path: 'README.md', text: 'ok\n' }], deletes: [] })).resolves.toBeTruthy();
  });

  it('the wrong key fails with DecryptError', async () => {
    const { inner, driver } = await pair();
    const h0 = await driver.head();
    const text = (await driver.readMany([NOTES])).get(NOTES)!.text + 'x\n';
    await driver.commit({ message: 'a', expectedHead: h0, writes: [{ path: NOTES, text }], deletes: [] });
    const wrong = new EncryptingDriver(inner, await stubKeyring(2));
    await expect(wrong.readMany([NOTES])).rejects.toBeInstanceOf(DecryptError);
  });
});
