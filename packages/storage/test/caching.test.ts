import { describe, expect, it } from 'vitest';
import { CachingDriver, EncryptingDriver, MemoryDriver, NetworkError, NotInCopyError, StaticKeyring, type StorageDriver, loadSnapshot, memoryCopyStore } from '../src/index';
import { importBodyKey } from '@gnomon/core';
import { driverContract } from './contract';
import { readBrainBytes } from './fixture';

driverContract('CachingDriver(MemoryDriver)', async (seed) => new CachingDriver(await MemoryDriver.create(seed), memoryCopyStore(), 'b'));

/** Count what reaches the host, and cut the line on demand. */
function counted(inner: StorageDriver) {
  const calls = { head: 0, list: 0, readMany: 0, read: 0, compare: 0, commit: 0 };
  let down = false;
  const gate = () => {
    if (down) throw new NetworkError('offline');
  };
  const driver: StorageDriver = {
    head: async () => (gate(), calls.head++, inner.head()),
    list: async () => (gate(), calls.list++, inner.list()),
    readMany: async (p) => (gate(), calls.readMany++, (calls.read += p.length), inner.readMany(p)),
    readBytes: async (p) => (gate(), inner.readBytes(p)),
    commit: async (b) => (gate(), calls.commit++, inner.commit(b)),
    history: async (o) => (gate(), inner.history(o)),
    compare: async (a, b) => (gate(), calls.compare++, inner.compare(a, b)),
    revert: async (s, m) => (gate(), inner.revert(s, m)),
  };
  return { driver, calls, cut: (v: boolean) => (down = v) };
}

const NOTES = 'sources/weil-attention/notes.md';
const notes = (body: string) => `---\ntype: notes\nsource: weil-attention\ncurated: human\ncreated: 2026-09-04T21:30:00Z\nupdated: 2026-09-06T12:00:00Z\n---\n${body}\n`;

describe('CachingDriver (spec §6.6)', () => {
  async function setup(now = { t: 0 }) {
    const memory = await MemoryDriver.create(readBrainBytes());
    const host = counted(memory);
    const store = memoryCopyStore();
    const open = () => new CachingDriver(host.driver, store, 'me/brain', () => now.t);
    return { memory, host, store, open, now };
  }

  it('loads once from the host, then a second launch reads no file again', async () => {
    const { host, open, now } = await setup();
    const first = await loadSnapshot(open());
    const reads = host.calls.read;
    expect(reads).toBeGreaterThan(0);

    now.t += 60_000;
    const second = await loadSnapshot(open());
    expect(host.calls.read).toBe(reads);
    expect(second.head).toBe(first.head);
    expect([...second.files.keys()]).toEqual([...first.files.keys()]);
  });

  it('opens from the copy with the host unreachable, and says so when there is no copy', async () => {
    const { host, open } = await setup();
    const fresh = open();
    host.cut(true);
    expect(await fresh.hasCopy()).toBe(false);
    await expect(loadSnapshot(fresh.copyOnly)).rejects.toBeInstanceOf(NotInCopyError);

    host.cut(false);
    const online = await loadSnapshot(open());
    host.cut(true);
    const again = open();
    expect(await again.hasCopy()).toBe(true);
    const offline = await loadSnapshot(again.copyOnly);
    expect(offline.head).toBe(online.head);
    expect(offline.files.get(NOTES)!.body).toBe(online.files.get(NOTES)!.body);
  });

  it('fetches only what another device changed', async () => {
    const { memory, host, open, now } = await setup();
    await loadSnapshot(open());
    const before = host.calls.read;
    await memory.commit({ message: 'elsewhere', expectedHead: await memory.head(), writes: [{ path: NOTES, text: notes('Changed on the desktop.') }], deletes: [] });

    now.t += 60_000;
    const s = await loadSnapshot(open());
    expect(host.calls.read - before).toBe(1);
    expect(s.files.get(NOTES)!.body).toContain('Changed on the desktop.');
  });

  it('advances the copy from its own commit, so the reload asks the host nothing', async () => {
    const { memory, host, open } = await setup();
    const driver = open();
    const s = await loadSnapshot(driver);
    const calls = { ...host.calls };
    const { sha } = await driver.commit({ message: 'Edit notes: weil-attention', expectedHead: s.head, writes: [{ path: NOTES, text: notes('Mine.') }], deletes: ['sources/weil-attention/original.pdf'].filter((p) => s.attachments.has(p)) });

    host.cut(true);
    const local = await loadSnapshot(driver.copyOnly);
    expect(local.head).toBe(sha);
    expect(local.files.get(NOTES)!.body).toContain('Mine.');
    expect(host.calls.read).toBe(calls.read);

    // What the copy computed is what the host holds.
    host.cut(false);
    const truth = await loadSnapshot(memory);
    expect(local.files.get(NOTES)!.sha).toBe(truth.files.get(NOTES)!.sha);
    expect(await driver.copyHead()).toBe(truth.head);
  });

  it('does not trust an unchecked copy for an online read', async () => {
    const { memory, open, now } = await setup();
    await loadSnapshot(open());
    await memory.commit({ message: 'elsewhere', expectedHead: await memory.head(), writes: [{ path: NOTES, text: notes('Newer.') }], deletes: [] });
    now.t += 60_000;
    const reopened = open();
    expect((await reopened.readMany([NOTES])).get(NOTES)!.text).toContain('Newer.');
  });

  it('a refresh is never answered from memory, however soon after the last one', async () => {
    const { memory, open } = await setup();
    const driver = open();
    const s = await loadSnapshot(driver);
    const moved = await memory.commit({ message: 'elsewhere', expectedHead: s.head, writes: [{ path: NOTES, text: notes('A moment later.') }], deletes: [] });
    await expect(driver.commit({ message: 'x', expectedHead: s.head, writes: [{ path: NOTES, text: notes('Mine.') }], deletes: [] })).rejects.toThrow(/head moved/);
    const again = await loadSnapshot(driver);
    expect(again.head).toBe(moved.sha);
    expect(again.files.get(NOTES)!.body).toContain('A moment later.');
  });

  it('asks the host again after a revert', async () => {
    const { open } = await setup();
    const driver = open();
    const s = await loadSnapshot(driver);
    const { sha } = await driver.commit({ message: 'x', expectedHead: s.head, writes: [{ path: NOTES, text: notes('To be undone.') }], deletes: [] });
    const reverted = await driver.revert(sha, 'Reject: x');
    const after = await loadSnapshot(driver);
    expect(after.head).toBe(reverted.sha);
    expect(after.files.get(NOTES)!.body).toBe(s.files.get(NOTES)!.body);
  });

  it('keeps a compare, which can never change', async () => {
    const { host, open } = await setup();
    const driver = open();
    const s = await loadSnapshot(driver);
    const { sha } = await driver.commit({ message: 'x', expectedHead: s.head, writes: [{ path: NOTES, text: notes('Compared.') }], deletes: [] });
    const a = await driver.compare(s.head, sha);
    const b = await open().compare(s.head, sha);
    expect(b).toEqual(a);
    expect(host.calls.compare).toBe(1);
  });

  it('holds ciphertext, never plaintext, under the encrypting wrapper', async () => {
    const { store, open } = await setup();
    const copy = open();
    const keyring = new StaticKeyring(await importBodyKey(new Uint8Array(32).fill(7)));
    const driver = new EncryptingDriver(copy, keyring);
    const s = await loadSnapshot(driver);
    await driver.commit({ message: 'x', expectedHead: s.head, writes: [{ path: NOTES, text: notes('A secret thought.') }], deletes: [] });
    const held = (await store.getMany(await store.keys())).filter((v): v is string => typeof v === 'string');
    expect(held.some((t) => t.includes('A secret thought.'))).toBe(false);
    const local = await loadSnapshot(new EncryptingDriver(copy.copyOnly, keyring));
    expect(local.files.get(NOTES)!.body).toContain('A secret thought.');
  });

  it('forgets one brain and leaves another, and prunes blobs the tree dropped', async () => {
    const { host, store, open } = await setup();
    const mine = open();
    const s = await loadSnapshot(mine);
    const other = new CachingDriver(host.driver, store, 'me/other');
    await loadSnapshot(other);
    await mine.commit({ message: 'x', expectedHead: s.head, writes: [{ path: NOTES, text: notes('Replaced.') }], deletes: [] });
    expect(await mine.prune()).toBe(1);
    await mine.forget();
    expect(await mine.hasCopy()).toBe(false);
    expect(await other.hasCopy()).toBe(true);
    expect((await store.keys()).every((k) => k.startsWith('me/other|'))).toBe(true);
  });
});
