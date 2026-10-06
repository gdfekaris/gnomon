// Seals in the app (spec §6.5; Phase 5 block S4) over MemoryDriver: a capture
// committed with sealing on carries its seal; existing captures are sealed
// once; "Seal as mine"; verification after a load gives verdicts, finds a
// tampered capture, and moves the device's pins only on a clean result; the
// ratify rule and the reasoning snapshot follow the verdicts; an encrypted
// brain stores its seal files as ciphertext and still verifies.
import { beforeEach, describe, expect, it } from 'vitest';
import { SEALS_DIR, isEncryptedBody, splitFrontmatter } from '@gnomon/core';
import { type KeyStore, MemoryDriver } from '@gnomon/storage';
import { readBrainBytes } from '@gnomon/storage/testing';
import { BrainService, type SnapshotState } from '../src/lib/services/brain';
import { captureToInbox } from '../src/lib/services/capture';
import { type EncryptionState, KDF_FAST, composeStack, disableEncryption, enableEncryption } from '../src/lib/services/encryption';
import {
  type SealingContext, beginSetup, captureSealer, emptySealing, finishSetup, loadSealing, memorySealStore, newSealCache, ratifyRule, readSealingFiles, sealAsMine,
  sealExisting, unsealedCaptures, withoutBroken,
} from '../src/lib/services/sealing';

class FakeStore implements KeyStore {
  readonly map = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> { return this.map.get(key) as T | undefined; }
  async set(key: string, value: unknown): Promise<void> { this.map.set(key, value); }
  async del(key: string): Promise<void> { this.map.delete(key); }
}

const fresh = (): SnapshotState => ({ current: null, stale: false, loading: false, error: null });
const K3M = 'inbox/20260901-081500-k3m.md';
const RAW_4_3 = 'sources/aurelius-meditations-4-3/raw.md';
const verdict = (ctx: SealingContext, path: string) => ctx.state.verdicts[path]?.verdict;

let plain: MemoryDriver;
let ctx: SealingContext;

beforeEach(async () => {
  plain = await MemoryDriver.create(readBrainBytes());
  const brain = new BrainService(fresh());
  ctx = { brain, plain, driver: plain, cache: newSealCache(), store: memorySealStore(), brainId: 'me/brain', state: emptySealing() };
  brain.captureSealer = captureSealer(() => ctx);
  await brain.connect(plain);
  const { entropy } = await beginSetup();
  await finishSetup(ctx, entropy, 'iPhone');
});

/** Commit a change straight to the repository, as an agent would, then reload and verify as the app does. */
async function agentEdit(path: string, f: (t: string) => string) {
  const t = (await plain.readMany([path])).get(path)!.text;
  await plain.commit({ message: 'agent', expectedHead: await plain.head(), writes: [{ path, text: f(t) }], deletes: [] });
  await ctx.brain.refresh();
  await loadSealing(ctx);
}

describe('verifying a brain with sealing just set up', () => {
  it('finds every existing capture unsealed and no finding', () => {
    expect(ctx.state.findings).toEqual([]);
    expect(unsealedCaptures(ctx.state)).toHaveLength(4);
    expect(verdict(ctx, RAW_4_3)).toBe('unsealed');
    expect(ratifyRule(ctx.state, RAW_4_3)).toBe('seal-first');
  });
});

describe('sealing', () => {
  it('seals a capture in its own commit, and it verifies', async () => {
    const r = await captureToInbox(ctx.brain, { text: 'A new passage.\n', note: 'from a talk', now: () => '2026-10-06T09:00:00Z' });
    const files = await readSealingFiles(plain);
    const seals = [...files.keys()].filter((p) => p.startsWith(SEALS_DIR));
    expect(seals).toHaveLength(1);
    expect(JSON.parse(files.get(seals[0]!)!).payload).toMatchObject({ kind: 'capture', stem: r.stem, at: '2026-10-06T09:00:00Z', seq: 1 });
    expect((await plain.history({ limit: 1 }))[0]!.message).toBe(`Capture: ${r.stem}`);
    await loadSealing(ctx);
    expect(verdict(ctx, r.path)).toBe('verified');
    expect((await ctx.store.get('me/brain'))!.heads).toEqual(Object.fromEntries([[seals[0]!.split('/')[2], expect.objectContaining({ seq: 1 })]]));
  });

  it('seals a capture made at launch, before the first verification has run', async () => {
    await captureToInbox(ctx.brain, { text: 'First.\n' });
    Object.assign(ctx.state, emptySealing());
    ctx.cache = newSealCache();
    const r = await captureToInbox(ctx.brain, { text: 'Straight after launch.\n' });
    await loadSealing(ctx);
    expect(verdict(ctx, r.path)).toBe('verified');
    expect(ctx.state.findings).toEqual([]);
  });

  it('does not seal when this device’s key is not trusted here', async () => {
    ctx.state.status = 'unenrolled';
    await captureToInbox(ctx.brain, { text: 'Not sealed.\n' });
    expect([...(await readSealingFiles(plain)).keys()].some((p) => p.startsWith(SEALS_DIR))).toBe(false);
  });

  it('seals a capture with its attachment, and the next seal follows the chain', async () => {
    const a = await captureToInbox(ctx.brain, { text: 'One.\n', attachment: { filename: 'scan.pdf', bytes: new Uint8Array([37, 80, 68, 70, 1]) } });
    const b = await captureToInbox(ctx.brain, { text: 'Two.\n' });
    await loadSealing(ctx);
    expect([verdict(ctx, a.path), verdict(ctx, b.path)]).toEqual(['verified', 'verified']);
    expect(ctx.state.findings).toEqual([]);
  });

  it('seals every existing capture once, and their filed sources verify as attested', async () => {
    const n = await sealExisting(ctx, '2026-10-06T10:00:00Z');
    expect(n).toBe(4);
    expect((await plain.history({ limit: 1 }))[0]!.message).toBe('Seal: 4 existing captures');
    expect(ctx.state.verdicts[K3M]).toEqual({ verdict: 'attested', since: '2026-10-06T10:00:00Z' });
    expect(verdict(ctx, RAW_4_3)).toBe('attested');
    expect(verdict(ctx, 'sources/weil-attention/raw.md')).toBe('unsealed');
    expect(unsealedCaptures(ctx.state)).toEqual([]);
    expect(ratifyRule(ctx.state, RAW_4_3)).toBe('ok');
    await expect(sealExisting(ctx)).resolves.toBe(0);
  });

  it('seals one capture as mine, and refuses to seal it again', async () => {
    await sealAsMine(ctx, '20260901-081500-k3m');
    expect((await plain.history({ limit: 1 }))[0]!.message).toBe('Seal: 20260901-081500-k3m');
    expect(verdict(ctx, K3M)).toBe('attested');
    await expect(sealAsMine(ctx, '20260901-081500-k3m')).rejects.toThrow(/already sealed/);
  });
});

describe('tampering', () => {
  beforeEach(async () => {
    await sealExisting(ctx);
  });

  it('a passage changed by an agent is broken; ratify refuses it; reasoning leaves it out', async () => {
    await agentEdit(RAW_4_3, (t) => t.replace('Men seek retreats', 'Men seek comfort'));
    expect(ctx.state.verdicts[RAW_4_3]).toEqual({ verdict: 'broken', why: 'its passage differs from the sealed capture' });
    expect(verdict(ctx, K3M)).toBe('attested');
    expect(ratifyRule(ctx.state, RAW_4_3)).toBe('broken');
    const s = withoutBroken(ctx.brain.snapshot, ctx.state.verdicts)!;
    expect(s.files.has(RAW_4_3)).toBe(false);
    expect(s.files.has(K3M)).toBe(true);
    await expect(sealAsMine(ctx, '20260901-081500-k3m')).rejects.toThrow(/already sealed/);
  });

  it('a deleted seal is a finding, and the pins do not move', async () => {
    const before = (await ctx.store.get('me/brain'))!.heads;
    const seal = [...(await readSealingFiles(plain)).keys()].find((p) => p.startsWith(SEALS_DIR) && p.endsWith('000002.json'))!;
    await plain.commit({ message: 'agent', expectedHead: await plain.head(), writes: [], deletes: [seal] });
    await ctx.brain.refresh();
    await loadSealing(ctx);
    expect(ctx.state.findings.map((f) => f.code)).toEqual(['chain-gap']);
    expect((await ctx.store.get('me/brain'))!.heads).toEqual(before);
  });
});

describe('an encrypted brain', () => {
  it('stores seal files as ciphertext, verifies through the wrapper, and decrypts them with the brain', async () => {
    await sealExisting(ctx);
    const encState: EncryptionState = { enabled: false, locked: false, storeError: null };
    const stack = await composeStack(plain, new FakeStore(), encState);
    const on = await enableEncryption(ctx.brain, stack, encState, 'open sesame', { params: KDF_FAST });
    const stored = await readSealingFiles(plain);
    const sealPaths = [...stored.keys()].filter((p) => p.startsWith(SEALS_DIR));
    expect(sealPaths).toHaveLength(4);
    expect(sealPaths.every((p) => isEncryptedBody(stored.get(p)!))).toBe(true);
    expect(isEncryptedBody(stored.get('.gnomon/root.json')!)).toBe(false);

    ctx.driver = on.stack.driver;
    await loadSealing(ctx);
    expect(ctx.state.locked).toBe(false);
    expect(ctx.state.findings).toEqual([]);
    expect(verdict(ctx, K3M)).toBe('attested');

    // A new capture's seal goes through the wrapper as ciphertext, and verifies.
    const r = await captureToInbox(ctx.brain, { text: 'Encrypted and sealed.\n' });
    const sealText = [...(await readSealingFiles(plain))].find(([p]) => p.endsWith('000005.json'))![1];
    expect(isEncryptedBody(sealText)).toBe(true);
    await loadSealing(ctx);
    expect(verdict(ctx, r.path)).toBe('verified');
    expect(splitFrontmatter((await plain.readMany([r.path])).get(r.path)!.text)!.body.startsWith('<!-- gnomon-enc v1 -->')).toBe(true);

    const off = await disableEncryption(ctx.brain, on.stack, encState);
    ctx.driver = off.stack.driver;
    const after = await readSealingFiles(plain);
    expect([...after].filter(([p]) => p.startsWith(SEALS_DIR)).every(([, t]) => !isEncryptedBody(t))).toBe(true);
    await loadSealing(ctx);
    expect(ctx.state.findings).toEqual([]);
    expect(verdict(ctx, r.path)).toBe('verified');
  });
});
