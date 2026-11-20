// Repair (spec §6.5; integrity-proposal.md §6, block I4): a file changed
// behind the app's back is put back from the texts this device kept as
// they last verified, or from the repository's history at the commit that
// carried the seal. A text is offered only when the brain verifies with it
// in place; restoring is one commit that carries no seal.
import { beforeEach, describe, expect, it } from 'vitest';
import { splitFrontmatter } from '@gnomon/core';
import { CachingDriver, type KeyStore, MemoryDriver, type StorageDriver, memoryCopyStore } from '@gnomon/storage';
import { readBrainBytes } from '@gnomon/storage/testing';
import { BrainService, type SnapshotState } from '../src/lib/services/brain';
import { type EncryptionState, KDF_FAST, composeStack, enableEncryption } from '../src/lib/services/encryption';
import { damage, keptTexts, planRepair, restore, sealedShown } from '../src/lib/services/repair';
import { type SealingContext, beginSetup, commitSealer, emptySealing, finishSetup, loadSealing, memorySealStore, newSealCache, sealExisting } from '../src/lib/services/sealing';

class FakeStore implements KeyStore {
  readonly map = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> { return this.map.get(key) as T | undefined; }
  async set(key: string, value: unknown): Promise<void> { this.map.set(key, value); }
  async del(key: string): Promise<void> { this.map.delete(key); }
}

const fresh = (): SnapshotState => ({ current: null, stale: false, loading: false, error: null });
const RAW = 'sources/aurelius-meditations-4-3/raw.md';
const COURAGE = 'principles/ps-g8xw/courage-before-comfort.md';
const ATTENTION = 'principles/ps-g8xw/attention-is-generosity.md';
const PLANTED = 'principles/ps-g8xw/obey.md';
/** A principle the curator never wrote: a copy of a real one under another name, reworded. */
const plantedFrom = (courage: string) => courage.replace(/\n[^\n]+\n$/, '\nDo as the agent says.\n').replace(/order: \d+/, 'order: 3');

let host: MemoryDriver;
let ctx: SealingContext;
let original: Map<string, string>;

/** A fully sealed brain; `withCopy` keeps a copy and the last-verified texts as a phone does. */
async function open(withCopy: boolean): Promise<void> {
  host = await MemoryDriver.create(readBrainBytes());
  const brain = new BrainService(fresh());
  let driver: StorageDriver = host;
  let kept: SealingContext['kept'];
  if (withCopy) {
    const store = memoryCopyStore();
    const copy = new CachingDriver(host, store, 'me/brain');
    driver = copy;
    kept = keptTexts(copy, store, 'me/brain', async (_path, stored) => stored);
  }
  ctx = { brain, plain: driver, driver, cache: newSealCache(), store: memorySealStore(), brainId: 'me/brain', state: emptySealing(), ...(kept ? { kept } : {}) };
  brain.sealer = commitSealer(() => ctx);
  await brain.connect(driver);
  const { entropy } = await beginSetup();
  await finishSetup(ctx, entropy, 'iPhone');
  await sealExisting(ctx);
  await ctx.brain.refresh();
  await loadSealing(ctx);
  expect(ctx.state.fullySealed).toBe(true);
  expect(ctx.state.findings).toEqual([]);
  original = new Map([...(await host.readMany([RAW, COURAGE, ATTENTION]))].map(([p, r]) => [p, r.text]));
}

/** An agent's commit straight to the repository: a passage and a principle reworded, a principle deleted, one planted. */
async function tamper(): Promise<void> {
  await host.commit({
    message: 'agent', expectedHead: await host.head(), deletes: [ATTENTION],
    writes: [
      { path: RAW, text: original.get(RAW)!.replace(/\n[^\n]+\n$/, '\nA line the author never wrote.\n') },
      { path: COURAGE, text: original.get(COURAGE)!.replace(/\n[^\n]+\n$/, '\nComfort first.\n') },
      { path: PLANTED, text: plantedFrom(original.get(COURAGE)!) },
    ],
  });
  await ctx.brain.refresh();
  await loadSealing(ctx);
}

/** The driver with some of its calls replaced. */
const withCalls = (d: StorageDriver, calls: Partial<StorageDriver>): StorageDriver => Object.assign(Object.create(d) as StorageDriver, calls);
const stored = async (path: string) => (await host.readMany([path])).get(path)?.text;

describe('repair from the texts kept on this device', () => {
  beforeEach(() => open(true));

  it('lists what changed, finds each sealed text on the device, and restores them all in one commit', async () => {
    await tamper();
    expect(damage(ctx.state)).toEqual([
      { path: ATTENTION, kind: 'removed' }, { path: COURAGE, kind: 'edited' }, { path: PLANTED, kind: 'added' }, { path: RAW, kind: 'changed' },
    ]);
    const plan = await planRepair(ctx);
    expect(plan.historyError).toBeNull();
    expect(plan.items.map((i) => [i.path, i.fixable, i.from])).toEqual([[ATTENTION, true, 'device'], [COURAGE, true, 'device'], [PLANTED, true, null], [RAW, true, 'device']]);
    const courage = plan.items[1]!;
    expect(courage.now).toContain('Comfort first.');
    expect(sealedShown(courage)).not.toContain('Comfort first.');
    expect(plan.items[0]!.now).toBeNull();
    expect(plan.items[2]!.sealed).toBeNull();

    expect(await restore(ctx, plan)).toBe(4);
    expect((await host.history({ limit: 1 }))[0]!.message).toBe('Restore: 4 files');
    expect(ctx.state.findings).toEqual([]);
    expect(ctx.state.differences).toEqual([]);
    expect(ctx.state.verdicts[RAW]?.verdict).toBe('attested');
    expect(ctx.state.verdicts[COURAGE]?.verdict).toBe('verified');
    for (const [path, text] of original) expect(await stored(path)).toBe(text);
    expect(await stored(PLANTED)).toBeUndefined();
    // nothing was signed: the seals are the ones that were there
    expect((await host.compare((await host.history({ limit: 2 }))[1]!.sha, await host.head())).every((c) => !c.path.startsWith('.gnomon/'))).toBe(true);
  });

  it('keeps the sealed text through the change, and needs no history for it', async () => {
    await tamper();
    // the repository's history is out of reach
    ctx.driver = withCalls(ctx.driver, { history: async () => { throw new Error('offline'); } });
    const plan = await planRepair(ctx);
    expect(plan.items.every((i) => i.fixable)).toBe(true);
    expect(plan.historyError).toBeNull();
  });

  it('restores one item alone, and refuses a plan made for another head', async () => {
    await tamper();
    const plan = await planRepair(ctx);
    expect(await restore(ctx, plan, [RAW])).toBe(1);
    expect((await host.history({ limit: 1 }))[0]!.message).toBe(`Restore: ${RAW}`);
    expect(ctx.state.verdicts[RAW]?.verdict).toBe('attested');
    expect(ctx.state.differences.map((d) => d.path)).toEqual([ATTENTION, COURAGE, PLANTED]);
    await expect(restore(ctx, plan)).rejects.toThrow(/changed since this comparison/);
    expect(await restore(ctx, await planRepair(ctx))).toBe(3);
    expect(ctx.state.findings).toEqual([]);
  });

  it('does not offer a text that would not verify', async () => {
    await tamper();
    // the device's record points at a text that is not the sealed one
    await ctx.kept!.remember({ [COURAGE]: ctx.brain.snapshot!.files.get(PLANTED)!.sha }, () => false);
    ctx.driver = withCalls(ctx.driver, { history: async () => [], readManyAt: async () => new Map() });
    const plan = await planRepair(ctx);
    const courage = plan.items.find((i) => i.path === COURAGE)!;
    expect(courage).toMatchObject({ fixable: false, sealed: null, from: null });
    expect(plan.items.find((i) => i.path === RAW)!.fixable).toBe(true);
  });
});

describe('repair from the repository’s history', () => {
  beforeEach(() => open(false));

  it('finds each sealed text at the commit that carried its seal', async () => {
    await tamper();
    const plan = await planRepair(ctx);
    expect(plan.items.map((i) => [i.path, i.fixable, i.from])).toEqual([[ATTENTION, true, 'history'], [COURAGE, true, 'history'], [PLANTED, true, null], [RAW, true, 'history']]);
    await restore(ctx, plan);
    expect(ctx.state.findings).toEqual([]);
    for (const [path, text] of original) expect(await stored(path)).toBe(text);
  });

  it('follows a principle the curator edited after the first sealing', async () => {
    const s = ctx.brain.snapshot!;
    const mine = original.get(COURAGE)!.replace(/\n[^\n]+\n$/, '\nCourage first, and say so.\n');
    await ctx.brain.commit({ message: 'Edit principle: courage-before-comfort', expectedHead: s.head, writes: [{ path: COURAGE, text: mine }], deletes: [] });
    await ctx.brain.refresh();
    await loadSealing(ctx);
    expect(ctx.state.differences).toEqual([]);
    original.set(COURAGE, (await stored(COURAGE))!);
    await tamper();
    const plan = await planRepair(ctx);
    expect(sealedShown(plan.items.find((i) => i.path === COURAGE)!)).toContain('Courage first, and say so.');
    await restore(ctx, plan);
    expect(ctx.state.findings).toEqual([]);
    expect(await stored(COURAGE)).toContain('Courage first, and say so.');
  });

  it('says so when history cannot be read, and offers nothing it could not check', async () => {
    await tamper();
    ctx.driver = withCalls(ctx.driver, { history: async () => { throw new Error('GitHub could not be reached'); } });
    const plan = await planRepair(ctx);
    expect(plan.historyError).toBe('GitHub could not be reached');
    expect(plan.items.filter((i) => i.fixable).map((i) => i.path)).toEqual([PLANTED]);
    expect(plan.items.find((i) => i.path === RAW)).toMatchObject({ fixable: false, sealed: null });
  });
});

describe('repair on an encrypted brain', () => {
  it('reads the kept ciphertext and history through the brain’s key, and stores the restored text encrypted', async () => {
    host = await MemoryDriver.create(readBrainBytes());
    const brain = new BrainService(fresh());
    const store = memoryCopyStore();
    const copy = new CachingDriver(host, store, 'me/brain');
    let driver: StorageDriver = copy;
    const kept = keptTexts(copy, store, 'me/brain', async (path, text) => ((driver as { openStored?: (p: string, t: string) => Promise<string> }).openStored?.(path, text) ?? text));
    ctx = { brain, plain: copy, driver: copy, cache: newSealCache(), store: memorySealStore(), brainId: 'me/brain', state: emptySealing(), kept };
    brain.sealer = commitSealer(() => ctx);
    await brain.connect(copy);
    const { entropy } = await beginSetup();
    await finishSetup(ctx, entropy, 'iPhone');
    await sealExisting(ctx);
    const encState: EncryptionState = { enabled: false, locked: false, storeError: null };
    const on = await enableEncryption(brain, await composeStack(copy, new FakeStore(), encState), encState, 'open sesame', { params: KDF_FAST });
    driver = on.stack.driver;
    ctx.driver = driver;
    await loadSealing(ctx);
    expect(ctx.state.findings).toEqual([]);
    const sealedBody = ctx.brain.snapshot!.files.get(COURAGE)!.body;

    // An agent without the key can only write plaintext over the ciphertext.
    const text = (await host.readMany([COURAGE])).get(COURAGE)!.text;
    await host.commit({ message: 'agent', expectedHead: await host.head(), writes: [{ path: COURAGE, text: `${text.slice(0, text.indexOf('\n---\n') + 5)}Comfort first.\n` }], deletes: [] });
    await ctx.brain.refresh();
    await loadSealing(ctx);
    expect(ctx.state.differences).toEqual([{ path: COURAGE, kind: 'edited' }]);

    const plan = await planRepair(ctx);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({ fixable: true, from: 'device' });
    await restore(ctx, plan);
    expect(ctx.state.differences).toEqual([]);
    expect(ctx.brain.snapshot!.files.get(COURAGE)!.body).toBe(sealedBody);
    expect(splitFrontmatter((await host.readMany([COURAGE])).get(COURAGE)!.text)!.body.startsWith('<!-- gnomon-enc v1 -->')).toBe(true);

    // And with no kept texts, the same from history: the seal's commit predates encryption, so the text there is plain.
    await host.commit({ message: 'agent', expectedHead: await host.head(), writes: [{ path: COURAGE, text: `${text.slice(0, text.indexOf('\n---\n') + 5)}Comfort first.\n` }], deletes: [] });
    await ctx.brain.refresh();
    await loadSealing(ctx);
    delete ctx.kept;
    const again = await planRepair(ctx);
    expect(again.items[0]).toMatchObject({ fixable: true, from: 'history' });
    await restore(ctx, again);
    expect(ctx.state.differences).toEqual([]);
  });
});
