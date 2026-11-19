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
  type SealingContext, acceptPrinciples, beginSetup, captureSealer, commitSealer, emptySealing, existingToSeal, finishSetup, loadSealing, memorySealStore, newSealCache, ratifyRule,
  readSealingFiles, reasonable, sealAsMine, sealExisting, sealSourceAsMine, unfoundQuotes, unsealedCaptures,
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
const RAW_5_1 = 'sources/aurelius-meditations-5-1/raw.md'; // filed, awaiting review
const SET_G = 'principles/ps-g8xw/_set.md';
const COURAGE = 'principles/ps-g8xw/courage-before-comfort.md';
const verdict = (ctx: SealingContext, path: string) => ctx.state.verdicts[path]?.verdict;

let plain: MemoryDriver;
let ctx: SealingContext;

beforeEach(async () => {
  plain = await MemoryDriver.create(readBrainBytes());
  const brain = new BrainService(fresh());
  ctx = { brain, plain, driver: plain, cache: newSealCache(), store: memorySealStore(), brainId: 'me/brain', state: emptySealing() };
  brain.captureSealer = captureSealer(() => ctx);
  brain.sealer = commitSealer(() => ctx);
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

  it('seals everything that exists once: captures, the curator’s sources, and the principles', async () => {
    expect(existingToSeal(ctx.state, ctx.brain.snapshot)).toMatchObject({ captures: { length: 4 }, sources: ['aurelius-meditations-4-3', 'didion-why-i-write', 'weil-attention'], manifest: true });
    const n = await sealExisting(ctx, '2026-10-06T10:00:00Z');
    expect(n).toEqual({ captures: 4, sources: 3, manifest: true });
    expect((await plain.history({ limit: 1 }))[0]!.message).toBe('Seal: existing material');
    expect(ctx.state.findings).toEqual([]);
    expect(ctx.state.fullySealed).toBe(true);
    expect(ctx.state.verdicts[K3M]).toEqual({ verdict: 'attested', since: '2026-10-06T10:00:00Z' });
    expect(ctx.state.verdicts[RAW_4_3]).toEqual({ verdict: 'attested', since: '2026-10-06T10:00:00Z' });
    expect(verdict(ctx, 'sources/weil-attention/raw.md')).toBe('attested');
    expect(verdict(ctx, RAW_5_1)).toBe('pending');
    expect([verdict(ctx, SET_G), verdict(ctx, COURAGE)]).toEqual(['verified', 'verified']);
    expect(unsealedCaptures(ctx.state)).toEqual([]);
    expect(ratifyRule(ctx.state, RAW_5_1)).toBe('ok');
    await expect(sealExisting(ctx)).resolves.toEqual({ captures: 0, sources: 0, manifest: false });
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
    expect(ctx.state.verdicts[RAW_4_3]).toEqual({ verdict: 'broken', why: 'its passage differs from the sealed one' });
    expect(verdict(ctx, K3M)).toBe('attested');
    expect(ratifyRule(ctx.state, RAW_4_3)).toBe('broken');
    const r = reasonable(ctx.brain.snapshot, ctx.state);
    expect(r.snapshot!.files.has(RAW_4_3)).toBe(false);
    expect(r.snapshot!.files.has(K3M)).toBe(true);
    // a filing awaiting review is left out too, quietly: only sealed passages are reasoned from
    expect(r.passages).toEqual([{ path: RAW_4_3, verdict: 'broken' }, { path: RAW_5_1, verdict: 'pending' }]);
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

describe('a fully sealed brain: the seals a commit carries (schema §7.20)', () => {
  beforeEach(async () => {
    await sealExisting(ctx);
  });
  const edit = async (path: string, f: (t: string) => string, message: string) => {
    const s = ctx.brain.snapshot!;
    const text = (await plain.readMany([path])).get(path)!.text;
    return ctx.brain.commit({ message, expectedHead: s.head, writes: [{ path, text: f(text) }], deletes: [] });
  };
  const sealCount = async () => [...(await readSealingFiles(plain)).keys()].filter((p) => p.startsWith(SEALS_DIR)).length;

  it('ratifying seals the source in the same commit, and it verifies', async () => {
    const before = await sealCount();
    await edit(RAW_5_1, (t) => t.replace('curated: agent-proposed', 'curated: ratified'), 'Ratify: aurelius-meditations-5-1');
    expect(await sealCount()).toBeGreaterThan(before);
    await loadSealing(ctx);
    expect(ctx.state.findings).toEqual([]);
    expect(verdict(ctx, RAW_5_1)).toBe('verified');
    expect(reasonable(ctx.brain.snapshot, ctx.state).passages).toEqual([]);
  });

  it('editing a principle carries a new manifest; a second edit follows the first', async () => {
    await edit(COURAGE, (t) => `${t}\nA second thought.\n`, 'Edit principle: courage-before-comfort');
    await edit(COURAGE, (t) => `${t}\nA third.\n`, 'Edit principle: courage-before-comfort');
    await loadSealing(ctx);
    expect(ctx.state.findings).toEqual([]);
    expect(ctx.state.differences).toEqual([]);
    expect(verdict(ctx, COURAGE)).toBe('verified');
  });

  it('changing a sealed source’s title replaces its seal; a commit that touches neither carries none', async () => {
    await edit(RAW_4_3, (t) => t.replace(/^title: .*$/m, 'title: On retreat'), 'Edit source: aurelius-meditations-4-3');
    const n = await sealCount();
    await edit('sources/aurelius-meditations-4-3/notes.md', (t) => `${t}\nA note.\n`, 'Edit notes: aurelius-meditations-4-3');
    expect(await sealCount()).toBe(n);
    await loadSealing(ctx);
    expect(ctx.state.findings).toEqual([]);
    expect(ctx.state.verdicts[RAW_4_3]?.verdict).toBe('attested');
  });

  it('a principle changed outside the app shows as changed, refuses the set, blocks edits, and is accepted only on purpose', async () => {
    await agentEdit(COURAGE, (t) => t.replace(/^title: .*$/m, 'title: Comfort before courage'));
    expect(ctx.state.differences).toEqual([{ path: COURAGE, kind: 'edited' }]);
    expect(reasonable(ctx.brain.snapshot, ctx.state).sets).toEqual([{ path: SET_G, verdict: 'broken' }]);
    await expect(edit(COURAGE, (t) => `${t}\nMore.\n`, 'Edit principle: courage-before-comfort')).rejects.toThrow(/differ from what you sealed/);
    // an unrelated commit does not quietly sign the changed tree
    await captureToInbox(ctx.brain, { text: 'Unrelated.\n' });
    await loadSealing(ctx);
    expect(ctx.state.differences).toHaveLength(1);
    await acceptPrinciples(ctx);
    expect((await plain.history({ limit: 1 }))[0]!.message).toBe('Seal: principles');
    expect(ctx.state.findings).toEqual([]);
    expect(verdict(ctx, SET_G)).toBe('verified');
  });

  it('a source marked as the curator’s with no seal is a finding, and is sealed from its page', async () => {
    await agentEdit(RAW_5_1, (t) => t.replace('curated: agent-proposed', 'curated: ratified'));
    expect(ctx.state.findings.map((f) => f.code)).toEqual(['unsealed-source']);
    expect(reasonable(ctx.brain.snapshot, ctx.state).passages.map((p) => p.path)).toEqual([RAW_5_1]);
    await sealSourceAsMine(ctx, 'aurelius-meditations-5-1');
    expect((await plain.history({ limit: 1 }))[0]!.message).toBe('Seal: source aurelius-meditations-5-1');
    expect(ctx.state.findings).toEqual([]);
    expect(verdict(ctx, RAW_5_1)).toBe('attested');
  });

  it('a device with no key for a sealed brain cannot write principles, and says why', async () => {
    await ctx.store.del('me/brain');
    await loadSealing(ctx);
    expect(ctx.state.status).toBe('recover');
    await expect(edit(COURAGE, (t) => `${t}\nMore.\n`, 'Edit principle: courage-before-comfort')).rejects.toThrow(/holds no key/);
  });
});

describe('the quote check (spec §6.5)', () => {
  const given = ['Men seek retreats for themselves, houses in the country, sea-shores, and mountains.\n\n### 1. Courage before comfort'];
  it('passes a quotation found word for word, whatever the quotation marks or spacing', () => {
    expect(unfoundQuotes('He says “men seek retreats   for themselves,” and then: "Courage before comfort".', given)).toEqual([]);
    expect(unfoundQuotes('> Men seek retreats for themselves,\n> houses in the country', given)).toEqual([]);
    expect(unfoundQuotes('"Men seek retreats ... and mountains."', given)).toEqual([]);
  });
  it('names a quotation that is nowhere in what the model was given, and ignores short ones', () => {
    expect(unfoundQuotes('As he wrote, "men seek comfort for themselves" in the "country".', given)).toEqual(['men seek comfort for themselves']);
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
    expect(sealPaths).toHaveLength(8);
    expect(sealPaths.every((p) => isEncryptedBody(stored.get(p)!))).toBe(true);
    expect(isEncryptedBody(stored.get('.gnomon/root.json')!)).toBe(false);

    ctx.driver = on.stack.driver;
    await loadSealing(ctx);
    expect(ctx.state.locked).toBe(false);
    expect(ctx.state.findings).toEqual([]);
    expect(verdict(ctx, K3M)).toBe('attested');

    // A new capture's seal goes through the wrapper as ciphertext, and verifies.
    const r = await captureToInbox(ctx.brain, { text: 'Encrypted and sealed.\n' });
    const sealText = [...(await readSealingFiles(plain))].find(([p]) => p.endsWith('000009.json'))![1];
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
