// The encryption flows (spec §6.4, Phase 4 block 3) over MemoryDriver and a fake key store.
import { describe, expect, it } from 'vitest';
import { ENCRYPTION_CONFIG_PATH, ENC_MARKER, isEncryptedBody, splitFrontmatter } from '@gnomon/core';
import { DEVICE_KEY, HeadMovedError, type KeyStore, LockedError, MemoryDriver, WRAPPED_KEY } from '@gnomon/storage';
import { readBrainBytes } from '@gnomon/storage/testing';
import { BrainService, type SnapshotState } from '../src/lib/services/brain';
import {
  type EncryptionState, KDF_FAST, LOST_SENTENCE, changePassphrase, composeStack, disableEncryption, enableEncryption, forgetOnDevice, kdfParamsFor, lockBrain, typedBack, unlockBrain,
} from '../src/lib/services/encryption';

class FakeStore implements KeyStore {
  readonly map = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> { return this.map.get(key) as T | undefined; }
  async set(key: string, value: unknown): Promise<void> { this.map.set(key, value); }
  async del(key: string): Promise<void> { this.map.delete(key); }
}

const fresh = (): SnapshotState => ({ current: null, stale: false, loading: false, error: null });
const state = (): EncryptionState => ({ enabled: false, locked: false, storeError: null });
const RAW = 'sources/weil-attention/raw.md';
const PASSAGE = 'Attention is the rarest and purest form of generosity.';
const opts = { params: KDF_FAST };

async function stored(plain: MemoryDriver, path: string): Promise<string | undefined> {
  return (await plain.readMany([path])).get(path)?.text;
}
const storedBody = async (plain: MemoryDriver, path: string) => splitFrontmatter((await stored(plain, path))!)!.body;

describe('encryption in the app (spec §6.4)', () => {
  it('composes the plain driver when there is no config, and the wrapper with a locked keyring when there is', async () => {
    const plain = await MemoryDriver.create(readBrainBytes());
    const st = state();
    const stack = await composeStack(plain, new FakeStore(), st);
    expect(stack.driver).toBe(plain);
    expect(stack.keyring).toBeNull();
    expect(st).toEqual({ enabled: false, locked: false, storeError: null });
  });

  it('enable: one Encrypt commit of ciphertext through the plain driver, plaintext through the stack, remembered on the device', async () => {
    const plain = await MemoryDriver.create(readBrainBytes());
    const store = new FakeStore();
    const st = state();
    const snapState = fresh();
    const brain = new BrainService(snapState);
    const stack = await composeStack(plain, store, st);
    await brain.connect(stack.driver);
    const head = snapState.current!.head;

    const r = await enableEncryption(brain, stack, st, 'open sesame', { ...opts, remember: true });
    expect(r.files).toBeGreaterThan(10);
    expect(st).toEqual({ enabled: true, locked: false, storeError: null });
    expect(r.stack.keyring!.unlocked).toBe(true);
    expect(store.map.has(WRAPPED_KEY) && store.map.has(DEVICE_KEY)).toBe(true);
    // stored: the config, ciphertext bodies, cleartext frontmatter; the indexes and scaffold untouched
    expect(await stored(plain, ENCRYPTION_CONFIG_PATH)).toContain('"argon2id13"');
    const raw = (await stored(plain, RAW))!;
    expect(raw).toContain('title: Attention as generosity');
    expect(raw).toContain(ENC_MARKER);
    expect(raw).not.toContain(PASSAGE);
    expect(await stored(plain, 'principles/_index.md')).not.toContain(ENC_MARKER);
    expect((await plain.history({ limit: 1 }))[0]!.message).toMatch(/^Encrypt: \d+ files$/);
    // the brain reloaded through the wrapper: plaintext, marked encrypted, at the new head
    const s = snapState.current!;
    expect(s.head).not.toBe(head);
    expect(s.files.get(RAW)!.body).toContain(PASSAGE);
    expect(s.files.get(RAW)!.encrypted).toBe(true);
    expect(s.files.get('principles/_index.md')!.encrypted).toBe(false);

    // a fresh stack over the same device restores the remembered key and loads straight away
    const again = state();
    const restored = await composeStack(plain, store, again);
    expect(again).toEqual({ enabled: true, locked: false, storeError: null });
    const brain2 = new BrainService(fresh());
    expect((await brain2.connect(restored.driver)).files.get(RAW)!.body).toContain(PASSAGE);

    // a device that remembers nothing is locked: connect fails with LockedError, a wrong passphrase is refused, the right one loads
    const bare = state();
    const locked = await composeStack(plain, new FakeStore(), bare);
    expect(bare.locked).toBe(true);
    const brain3State = fresh();
    const brain3 = new BrainService(brain3State);
    await expect(brain3.connect(locked.driver)).rejects.toBeInstanceOf(LockedError);
    expect(brain3State.error).toMatch(/encrypted and locked/);
    await expect(unlockBrain(brain3, locked, bare, 'nope')).rejects.toThrow(/does not unlock/);
    expect(bare.locked).toBe(true);
    await unlockBrain(brain3, locked, bare, 'open sesame');
    expect(bare.locked).toBe(false);
    expect(brain3State.current!.files.get(RAW)!.body).toContain(PASSAGE);
  }, 60_000);

  it('a key the device remembered for another brain is forgotten, and reads as locked', async () => {
    const store = new FakeStore();
    const other = await MemoryDriver.create(readBrainBytes());
    const otherBrain = new BrainService(fresh());
    const otherStack = await composeStack(other, store, state());
    await otherBrain.connect(otherStack.driver);
    await enableEncryption(otherBrain, otherStack, state(), 'other brain', { ...opts, remember: true });
    expect(store.map.has(WRAPPED_KEY)).toBe(true);

    const plain = await MemoryDriver.create(readBrainBytes());
    const brain = new BrainService(fresh());
    const stack = await composeStack(plain, new FakeStore(), state());
    await brain.connect(stack.driver);
    await enableEncryption(brain, stack, state(), 'this brain', opts);

    const st = state();
    const composed = await composeStack(plain, store, st);
    expect(st.locked).toBe(true);
    expect(store.map.has(WRAPPED_KEY)).toBe(false);
    await expect(new BrainService(fresh()).connect(composed.driver)).rejects.toBeInstanceOf(LockedError);
  }, 60_000);

  it('change passphrase: one Change passphrase commit; the old passphrase is refused and the new one opens; forget locks and clears the store', async () => {
    const plain = await MemoryDriver.create(readBrainBytes());
    const store = new FakeStore();
    const st = state();
    const snapState = fresh();
    const brain = new BrainService(snapState);
    let stack = await composeStack(plain, store, st);
    await brain.connect(stack.driver);
    stack = (await enableEncryption(brain, stack, st, 'open sesame', { ...opts, remember: true })).stack;
    const before = (await stored(plain, RAW))!;
    const oldConfig = stack.config!;

    const r = await changePassphrase(brain, stack, st, 'new phrase here', opts);
    stack = r.stack;
    expect(r.files).toBeGreaterThan(10);
    expect((await plain.history({ limit: 1 }))[0]!.message).toBe('Change passphrase');
    expect(stack.config!.salt).not.toBe(oldConfig.salt);
    expect(await stored(plain, ENCRYPTION_CONFIG_PATH)).toContain(stack.config!.check);
    expect(await storedBody(plain, RAW)).not.toBe(splitFrontmatter(before)!.body);
    expect(snapState.current!.files.get(RAW)!.body).toContain(PASSAGE);
    // not remembered this time: the device's earlier key is gone
    expect(store.map.has(WRAPPED_KEY)).toBe(false);

    const bare = state();
    const locked = await composeStack(plain, new FakeStore(), bare);
    const b2 = new BrainService(fresh());
    await expect(b2.connect(locked.driver)).rejects.toBeInstanceOf(LockedError);
    await expect(unlockBrain(b2, locked, bare, 'open sesame')).rejects.toThrow(/does not unlock/);
    await unlockBrain(b2, locked, bare, 'new phrase here', true);
    expect(bare.locked).toBe(false);

    await forgetOnDevice(b2, locked, bare);
    expect(bare.locked).toBe(true);
    expect(locked.keyring!.unlocked).toBe(false);
    expect(locked.store instanceof FakeStore && locked.store.map.size).toBe(0);
  }, 60_000);

  it('lock drops the key and the loaded brain; disable rewrites every body as plaintext and removes the config', async () => {
    const plain = await MemoryDriver.create(readBrainBytes());
    const st = state();
    const snapState = fresh();
    const brain = new BrainService(snapState);
    let stack = await composeStack(plain, new FakeStore(), st);
    await brain.connect(stack.driver);
    const plaintext = (await stored(plain, RAW))!;
    stack = (await enableEncryption(brain, stack, st, 'open sesame', opts)).stack;

    lockBrain(brain, stack, st);
    expect(st.locked).toBe(true);
    expect(snapState.current).toBeNull();
    expect(snapState.error).toMatch(/locked/);
    await expect(brain.refresh()).rejects.toBeInstanceOf(LockedError);
    await expect(disableEncryption(brain, stack, st)).rejects.toThrow(/unlock/);
    await unlockBrain(brain, stack, st, 'open sesame');

    const r = await disableEncryption(brain, stack, st);
    expect(r.files).toBeGreaterThan(10);
    expect(st).toEqual({ enabled: false, locked: false, storeError: null });
    expect(r.stack.driver).toBe(plain);
    expect(r.stack.keyring).toBeNull();
    expect((await plain.history({ limit: 1 }))[0]!.message).toMatch(/^Decrypt: \d+ files$/);
    expect(await stored(plain, ENCRYPTION_CONFIG_PATH)).toBeUndefined();
    expect(await stored(plain, RAW)).toBe(plaintext);
    for (const f of snapState.current!.files.values()) {
      expect(f.encrypted).toBe(false);
      expect(isEncryptedBody(f.body)).toBe(false);
    }
    await expect(disableEncryption(brain, r.stack, st)).rejects.toThrow(/not encrypted/);
  }, 60_000);

  it('a head that moved during enable is refused with nothing written, and the snapshot is marked stale', async () => {
    const plain = await MemoryDriver.create(readBrainBytes());
    const st = state();
    const snapState = fresh();
    const brain = new BrainService(snapState);
    const stack = await composeStack(plain, new FakeStore(), st);
    await brain.connect(stack.driver);
    await plain.commit({ message: 'Capture: elsewhere', expectedHead: snapState.current!.head, writes: [{ path: 'inbox/20260906-090000-q2w.md', text: '---\ntype: inbox\nstatus: unfiled\ncurated: human\ncreated: 2026-09-06T09:00:00Z\nupdated: 2026-09-06T09:00:00Z\n---\nElsewhere.\n' }], deletes: [] });
    await expect(enableEncryption(brain, stack, st, 'open sesame', opts)).rejects.toBeInstanceOf(HeadMovedError);
    expect(snapState.stale).toBe(true);
    expect(st.enabled).toBe(false);
    expect(await stored(plain, ENCRYPTION_CONFIG_PATH)).toBeUndefined();
    expect(await stored(plain, RAW)).toContain(PASSAGE);
  }, 60_000);

  it('the typed-back sentence and the kdf query', () => {
    expect(typedBack(LOST_SENTENCE)).toBe(true);
    expect(typedBack('  A lost passphrase loses the bodies. ')).toBe(true);
    expect(typedBack('a lost passphrase loses the body')).toBe(false);
    expect(kdfParamsFor('fast')).toBe(KDF_FAST);
    expect(kdfParamsFor('interactive').memlimit).toBe(67_108_864);
    expect(kdfParamsFor(null).memlimit).toBe(268_435_456);
  });
});
