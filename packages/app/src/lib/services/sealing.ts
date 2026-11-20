// Sealing on the phone — spec §6.5, schema §7.20 and §11; Phase 5 blocks S3
// and S4. Keys: setting up sealing (the recovery phrase, the root, this
// device's key), recovering on another device from the phrase, enrolling a
// desktop key from its request, revoking a key, forgetting this device's key.
// Seals: one on every capture this device commits, "Seal as mine" for a
// capture without one, sealing every existing capture once, and verification
// of the whole brain after every load, whose verdicts the screens show. The root exists only for the moment it
// signs and is wiped at once; the phrase is never stored. This device's key is
// non-extractable and lives in IndexedDB beside the pinned root and heads
// (spec §10.3), never in the localStorage mirror. Framework-free: it writes
// into a plain state object handed to it, so it runs under vitest.

import {
  type BrainFile, type BrainSnapshot, type CommitBatch, type EnrollPayload, type InboxFm, KEYS_DIR, type Heads, type ManifestBody, type PinnedRevocations, type PinnedRoot,
  type PrinciplesDifference, type PrinciplesSealPayload, ROOT_PATH, SEALS_DIR, type SealFinding, type SealResult, type SealVerdict, type SourceContent, type SourceFm,
  type SourceSealPayload, applyBatch, buildManifest, canonicalJson, cryptoKeySigner, deriveRoot, digest, entropyToPhrase, fingerprint, generateDeviceKey, isEncryptedBody,
  keyRecords, makeEnrollment, makeRevocation, makeSeal, newEntropy, nowUtc, parseRequestFile, parseRootRecord, phraseToEntropy, requestPath, rootFile, sealContent,
  sealInputFromSnapshot, sealPosition, sourceContent, tryParseFile, usable, verifySeals,
} from '@gnomon/core';
import { LockedError, type StorageDriver } from '@gnomon/storage';
import type { BrainService } from './brain';

/** What this device keeps for one brain (spec §10.3, `seal.<owner>/<name>`). */
export interface DeviceRecord {
  key: CryptoKey;
  keyId: string;
  alg: 'ed25519' | 'p256';
  pub: string;
  label: string;
  root: PinnedRoot;
  heads: Heads;
  /** the revocations this device has accepted (schema §11.6); absent on a record made before version 2 */
  revocations?: PinnedRevocations;
}

export interface SealStore {
  get(brainId: string): Promise<DeviceRecord | undefined>;
  set(brainId: string, record: DeviceRecord): Promise<void>;
  del(brainId: string): Promise<void>;
}

/** IndexedDB through idb-keyval: a non-extractable CryptoKey structured-clones there and nowhere else. */
export function idbSealStore(kv: { get<T>(k: string): Promise<T | undefined>; set(k: string, v: unknown): Promise<void>; del(k: string): Promise<void> }): SealStore {
  return { get: (id) => kv.get<DeviceRecord>(`seal.${id}`), set: (id, r) => kv.set(`seal.${id}`, r), del: (id) => kv.del(`seal.${id}`) };
}

/** The demo brain lives only in the tab, so its device key does too. */
export function memorySealStore(): SealStore {
  const m = new Map<string, DeviceRecord>();
  return { get: async (id) => m.get(id), set: async (id, r) => void m.set(id, r), del: async (id) => void m.delete(id) };
}

export interface SealKeyView { key: string; label: string; alg: string; device: 'phone' | 'fido'; at: string; fingerprint: string; thisDevice: boolean; revoked: boolean }
export interface SealRequestView { key: string; label: string; at: string; fingerprint: string }

/**
 * Where sealing stands on this brain, for this device:
 * `off` — not set up; `on` — this device holds an enrolled key under the root it pinned;
 * `recover` — set up, and this device has no key: the phrase adds one;
 * `unenrolled` — this device holds a key the brain no longer enrolls (or has revoked);
 * `mismatch` — the brain's root record is not the root this device pinned.
 */
export interface SealingState {
  status: 'off' | 'on' | 'recover' | 'unenrolled' | 'mismatch';
  /** the root's fingerprint: the pinned one when this device has a key, else the brain's (unverified) record */
  root: string | null;
  device: { keyId: string; label: string; alg: string; fingerprint: string } | null;
  keys: SealKeyView[];
  requests: SealRequestView[];
  /** a sealing file that did not read, in its own words */
  error: string | null;
  /** schema §11.6 at the last verified head: per capture, source, set, and principle path */
  verdicts: Record<string, SealVerdict>;
  /** the brain holds a principles manifest: unsealed is a finding and only sealed material is reasoned from */
  fullySealed: boolean;
  /** how the principles differ from what was sealed, each also a finding */
  differences: PrinciplesDifference[];
  /** findings about the seal record itself; any one is a banner on every screen */
  findings: SealFinding[];
  /** seal files are still ciphertext (an encrypted brain, locked): nothing was verified */
  locked: boolean;
  /** the head the verdicts belong to, or null before the first verification */
  verifiedHead: string | null;
}

export const emptySealing = (): SealingState => ({
  status: 'off', root: null, device: null, keys: [], requests: [], error: null, verdicts: {}, fullySealed: false, differences: [], findings: [], locked: false, verifiedHead: null,
});

/** What a session keeps between runs: the last sealing files read, attachment digests by blob sha, and a run counter that drops stale results. */
export interface SealCache {
  files: Map<string, string>;
  digests: Map<string, string>;
  run: number;
  /** told of each new attachment digest, so a device can keep them across launches */
  onDigest?: (sha: string, digest: string) => void;
  /** the current seal per source and the current manifest at the last verification, kept up to date by this device's own commits: what a replacement names */
  current?: SealResult['current'];
  /** the brain's seal files hold a principles manifest (read, not verified): writes to sources and principles must carry seals */
  sealedTree?: boolean;
  /** the verification in flight, so a commit can wait for it */
  verifying?: Promise<void>;
}
export const newSealCache = (): SealCache => ({ files: new Map(), digests: new Map(), run: 0 });

/**
 * The texts as they last verified against their seals, kept on this device
 * (spec §6.5, §10.3): what repair restores from. `remember` records the
 * stored form of every file that verifies now, and forgets a path only when
 * `gone` says the brain let go of it properly; a file found changed keeps
 * the record of its last good text.
 */
export interface KeptTexts {
  remember(good: Record<string, string>, gone: (path: string) => boolean): Promise<void>;
  /** the kept text of a path as the brain reads it (decrypted), or undefined when this device holds none */
  text(path: string): Promise<string | undefined>;
}

export interface SealingContext {
  brain: BrainService;
  /** the plain driver: stored bytes, as GitHub has them */
  plain: StorageDriver;
  /** the session's driver: the encrypting wrapper on an encrypted brain, which reads seal files as plaintext */
  driver: StorageDriver;
  cache: SealCache;
  store: SealStore;
  /** names the brain in the store: `owner/name`, or `demo` */
  brainId: string;
  state: SealingState;
  /** absent where the brain keeps no copy on this device (the demo brain): repair then reads the repository's history */
  kept?: KeptTexts;
}

/** Every file under `.gnomon/` that sealing reads: the root record, keys, requests, seals. */
export async function readSealingFiles(plain: StorageDriver): Promise<Map<string, string>> {
  const paths = (await plain.list()).map((e) => e.path).filter((p) => p === ROOT_PATH || p.startsWith(KEYS_DIR) || p.startsWith(SEALS_DIR));
  if (paths.length === 0) return new Map();
  const got = await plain.readMany(paths);
  return new Map([...got].map(([p, r]) => [p, r.text]));
}

/** Work out the state from the brain's sealing files and this device's record. */
export async function describeSealing(files: ReadonlyMap<string, string>, record: DeviceRecord | undefined): Promise<SealingState> {
  const out = emptySealing();
  const rootText = files.get(ROOT_PATH);
  const rootRec = rootText === undefined ? undefined : parseRootRecord(rootText);
  if (rootText !== undefined && !rootRec) out.error = `${ROOT_PATH} does not read as a root record`;
  if (!rootRec && !record) return out;
  if (!record) {
    out.status = 'recover';
    out.root = rootRec ? fingerprint(rootRec.id) : null;
    return out;
  }
  out.root = fingerprint(record.root.id);
  out.device = { keyId: record.keyId, label: record.label, alg: record.alg, fingerprint: fingerprint(record.keyId) };
  if (!rootRec || rootRec.id !== record.root.id || rootRec.pub !== record.root.pub) {
    out.status = 'mismatch';
    return out;
  }
  const { enrolled, revoked, findings } = await keyRecords(files, record.root);
  if (findings.length) out.error = findings.map((f) => `${f.path}: ${f.detail}`).join('; ');
  out.keys = [...enrolled.values()]
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.key < b.key ? -1 : 1))
    .map((e: EnrollPayload) => ({ key: e.key, label: e.label, alg: e.alg, device: e.device, at: e.at, fingerprint: fingerprint(e.key), thisDevice: e.key === record.keyId, revoked: revoked.has(e.key) }));
  for (const [path, text] of files) {
    if (!path.startsWith(`${KEYS_DIR}requests/`)) continue;
    const r = await parseRequestFile(path, text);
    if (typeof r === 'string') out.error = [out.error, `${path}: ${r}`].filter(Boolean).join('; ');
    else if (!enrolled.has(r.key)) out.requests.push({ key: r.key, label: r.label, at: r.at, fingerprint: fingerprint(r.key) });
  }
  out.status = enrolled.has(record.keyId) && !revoked.has(record.keyId) ? 'on' : 'unenrolled';
  return out;
}

/** The sealing files as plaintext through the session's driver; ciphertext through the plain one when the brain is locked. */
async function readFiles(ctx: SealingContext): Promise<Map<string, string>> {
  try {
    return await readSealingFiles(ctx.driver);
  } catch (e) {
    if (e instanceof LockedError) return readSealingFiles(ctx.plain);
    throw e;
  }
}

/**
 * Read the brain's sealing files and this device's record, set the state, and
 * verify the loaded snapshot against the pinned root and heads (schema §11.6),
 * moving the pins forward on a clean result. Never throws: a failure is the
 * state's error. A run overtaken by a newer one leaves the state to it.
 */
export function loadSealing(ctx: SealingContext): Promise<void> {
  const p = runSealing(ctx);
  ctx.cache.verifying = p;
  return p;
}

/** Whether any seal file is a principles manifest: read without verifying, to know that this brain expects seals on its writes. */
function holdsManifest(files: ReadonlyMap<string, string>): boolean {
  for (const [path, text] of files) {
    if (!path.startsWith(SEALS_DIR) || isEncryptedBody(text)) continue;
    try {
      if ((JSON.parse(text) as { payload?: { kind?: unknown } }).payload?.kind === 'principles') return true;
    } catch {
      // not a seal file this device can read; verification reports it
    }
  }
  return false;
}

async function runSealing(ctx: SealingContext): Promise<void> {
  const run = ++ctx.cache.run;
  try {
    const files = await readFiles(ctx);
    const record = await ctx.store.get(ctx.brainId);
    const next = await describeSealing(files, record);
    const s = ctx.brain.snapshot;
    let verified: Pick<SealingState, 'verdicts' | 'findings' | 'locked' | 'verifiedHead' | 'fullySealed' | 'differences'> = { verdicts: {}, findings: [], locked: false, verifiedHead: null, fullySealed: false, differences: [] };
    let current: SealResult['current'] | undefined;
    if (record && s && (next.status === 'on' || next.status === 'unenrolled')) {
      const input = sealInputFromSnapshot(s, files, (path) => attachmentDigest(ctx, s, path));
      const r = await verifySeals(input, record.root, record.heads, record.revocations ?? {});
      verified = { verdicts: Object.fromEntries(r.verdicts), findings: r.findings, locked: r.locked, verifiedHead: s.head, fullySealed: r.fullySealed, differences: r.differences };
      if (!r.locked) current = r.current;
      if (!r.locked && ctx.kept && run === ctx.cache.run) await keep(ctx.kept, s, r).catch(() => undefined);
      if (r.heads && run === ctx.cache.run) {
        const fresh = await ctx.store.get(ctx.brainId);
        if (fresh && fresh.keyId === record.keyId) await ctx.store.set(ctx.brainId, { ...fresh, heads: { ...fresh.heads, ...r.heads }, revocations: { ...fresh.revocations, ...r.revocations } });
      }
    }
    if (run !== ctx.cache.run) return;
    ctx.cache.files = files;
    ctx.cache.sealedTree = holdsManifest(files);
    if (current) ctx.cache.current = current;
    else delete ctx.cache.current;
    Object.assign(ctx.state, next, verified);
  } catch (e) {
    if (run !== ctx.cache.run) return;
    Object.assign(ctx.state, emptySealing(), { error: e instanceof Error ? e.message : String(e) });
  }
}

/** Record the stored form of everything that verifies now; a path is forgotten only when it is gone and nothing reports it missing. */
async function keep(kept: KeptTexts, s: BrainSnapshot, r: SealResult): Promise<void> {
  const good: Record<string, string> = {};
  for (const [path, v] of r.verdicts) {
    const sha = s.files.get(path)?.sha;
    if (sha && (v.verdict === 'verified' || v.verdict === 'attested' || v.verdict === 'pending')) good[path] = sha;
  }
  const named = new Set([...r.findings.map((f) => f.path), ...r.differences.map((d) => d.path)]);
  await kept.remember(good, (path) => !s.files.has(path) && !named.has(path));
}

/** An attachment's digest (schema §11.1), read once per blob and kept by its sha for the session. */
export async function attachmentDigest(ctx: SealingContext, s: BrainSnapshot, path: string): Promise<string | undefined> {
  const a = s.attachments.get(path);
  if (!a) return undefined;
  const known = a.sha ? ctx.cache.digests.get(a.sha) : undefined;
  if (known) return known;
  const d = await digest((await ctx.plain.readBytes(path)).bytes);
  if (a.sha) {
    ctx.cache.digests.set(a.sha, d);
    ctx.cache.onDigest?.(a.sha, d);
  }
  return d;
}

/** A name for a key in commit messages and lists: one line, at most 40 characters. */
export function cleanLabel(label: string): string {
  const one = label.replace(/\s+/g, ' ').trim().slice(0, 40).trim();
  if (!one) throw new Error('give this key a name, such as "iPhone"');
  return one;
}

/** A sensible default name for this device's key. */
export function defaultLabel(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  return 'This browser';
}

/** Three distinct word positions (0-based, ascending) the setup asks back. */
export function confirmPositions(random: (n: number) => number = (n) => crypto.getRandomValues(new Uint32Array(1))[0]! % n): number[] {
  const picked = new Set<number>();
  while (picked.size < 3) picked.add(random(24));
  return [...picked].sort((a, b) => a - b);
}

export const wordsMatch = (words: string[], positions: number[], answers: string[]): boolean =>
  positions.every((p, i) => (answers[i] ?? '').trim().toLowerCase() === words[p]);

/** Draw the root's entropy, its 24 words, and the root's fingerprint for the paper card. The caller keeps them only until setup finishes. */
export async function beginSetup(): Promise<{ entropy: Uint8Array; words: string[]; fingerprint: string }> {
  const entropy = newEntropy();
  const root = await deriveRoot(entropy);
  root.wipe();
  return { entropy, words: await entropyToPhrase(entropy), fingerprint: fingerprint(root.keyId) };
}

/** A new device key, its enrollment signed by the root, and the record to keep. The root is wiped before this returns. */
async function enrollThisDevice(entropy: Uint8Array, label: string, at: string): Promise<{ record: DeviceRecord; writes: Array<{ path: string; text: string }> }> {
  const root = await deriveRoot(entropy);
  try {
    const { privateKey, signer } = await generateDeviceKey();
    const e = await makeEnrollment(root, { alg: signer.alg, pub: signer.pub, label, at });
    const record: DeviceRecord = { key: privateKey, keyId: signer.keyId, alg: signer.alg as 'ed25519' | 'p256', pub: signer.pub, label, root: { id: root.keyId, pub: root.pub }, heads: {} };
    return { record, writes: [rootFile(root), { path: e.path, text: e.text }] };
  } finally {
    root.wipe();
  }
}

/** Schema §7.20 Set up sealing: `root.json` and this device's enrollment, one commit; then the device keeps its key and pins the root. */
export async function finishSetup(ctx: SealingContext, entropy: Uint8Array, label: string, at = nowUtc()): Promise<void> {
  const name = cleanLabel(label);
  try {
    const files = await readSealingFiles(ctx.plain);
    if (files.has(ROOT_PATH)) throw new Error('this brain already has sealing set up; add this device with the recovery phrase instead');
    const { record, writes } = await enrollThisDevice(entropy, name, at);
    await commit(ctx, { message: 'Set up sealing', writes, deletes: [] });
    await ctx.store.set(ctx.brainId, record);
  } finally {
    entropy.fill(0);
  }
  await loadSealing(ctx);
}

/** The root a typed phrase derives, checked against `expected` (a key id); throws in words a person can act on. */
async function rootFromPhrase(phrase: string, expected: string, mismatch: string) {
  const entropy = await phraseToEntropy(phrase);
  const root = await deriveRoot(entropy);
  entropy.fill(0);
  if (root.keyId !== expected) {
    root.wipe();
    throw new Error(`${mismatch} The phrase gives the root ${fingerprint(root.keyId)}; this brain's is ${fingerprint(expected)}.`);
  }
  return root;
}

/** Add this device to a sealed brain from the recovery phrase (spec §6.5): derive the root, check it is this brain's, enroll a fresh key. */
export async function recoverDevice(ctx: SealingContext, phrase: string, label: string, at = nowUtc()): Promise<void> {
  const name = cleanLabel(label);
  const files = await readSealingFiles(ctx.plain);
  const rootRec = files.has(ROOT_PATH) ? parseRootRecord(files.get(ROOT_PATH)!) : undefined;
  if (!rootRec) throw new Error('this brain has no sealing set up to recover');
  const root = await rootFromPhrase(phrase, rootRec.id, 'This phrase is not this brain’s recovery phrase. Check each word; if they are all right, the brain’s root record was replaced, and that is worth looking into first.');
  try {
    const { privateKey, signer } = await generateDeviceKey();
    const e = await makeEnrollment(root, { alg: signer.alg, pub: signer.pub, label: name, at });
    await commit(ctx, { message: `Enroll key: ${name}`, writes: [{ path: e.path, text: e.text }], deletes: [] });
    await ctx.store.set(ctx.brainId, { key: privateKey, keyId: signer.keyId, alg: signer.alg as 'ed25519' | 'p256', pub: signer.pub, label: name, root: { id: root.keyId, pub: root.pub }, heads: {} });
  } finally {
    root.wipe();
  }
  await loadSealing(ctx);
}

async function pinned(ctx: SealingContext): Promise<DeviceRecord> {
  const record = await ctx.store.get(ctx.brainId);
  if (!record) throw new Error('this device holds no sealing key for this brain');
  return record;
}

/** Enroll a desktop key from its request (schema §7.20): the curator has compared the fingerprints; the phrase signs. */
export async function enrollRequest(ctx: SealingContext, key: string, phrase: string, at = nowUtc()): Promise<void> {
  const record = await pinned(ctx);
  const files = await readSealingFiles(ctx.plain);
  const path = requestPath(key);
  const text = files.get(path);
  if (text === undefined) throw new Error('that request is no longer in the brain');
  const req = await parseRequestFile(path, text);
  if (typeof req === 'string') throw new Error(`the request does not read: ${req}`);
  const root = await rootFromPhrase(phrase, record.root.id, 'This phrase is not this brain’s recovery phrase.');
  try {
    const e = await makeEnrollment(root, { alg: 'sk-ed25519', pub: req.pub, label: req.label, at });
    await commit(ctx, { message: `Enroll key: ${req.label}`, writes: [{ path: e.path, text: e.text }], deletes: [path] });
  } finally {
    root.wipe();
  }
  await loadSealing(ctx);
}

/** What a revocation of `key` would keep: the last seal this device accepted from it, else the newest one in the brain. */
export async function revocationPoint(ctx: SealingContext, key: string): Promise<{ last_seq: number; last: string | null }> {
  const record = await pinned(ctx);
  const head = record.heads[key];
  if (head) return { last_seq: head.seq, last: head.digest };
  const pos = await sealPosition(await readSealingFiles(ctx.plain), key);
  return { last_seq: pos.seq - 1, last: pos.prev };
}

/** Revoke another device's key (schema §7.20): seals it made up to the point named stay valid; any later one is refused. */
export async function revokeKey(ctx: SealingContext, key: string, phrase: string, at = nowUtc()): Promise<void> {
  const record = await pinned(ctx);
  if (key === record.keyId) throw new Error('this device cannot revoke its own key; forget it here, and revoke it from another device');
  const files = await readSealingFiles(ctx.plain);
  const { enrolled, revoked } = await keyRecords(files, record.root);
  const e = enrolled.get(key);
  if (!e) throw new Error('that key is not enrolled in this brain');
  if (revoked.has(key)) throw new Error(`${e.label} is already revoked`);
  const point = await revocationPoint(ctx, key);
  const root = await rootFromPhrase(phrase, record.root.id, 'This phrase is not this brain’s recovery phrase.');
  try {
    const r = await makeRevocation(root, { key, ...point, at });
    await commit(ctx, { message: `Revoke key: ${e.label}`, writes: [{ path: r.path, text: r.text }], deletes: [] });
  } finally {
    root.wipe();
  }
  await loadSealing(ctx);
}

/** Drop this device's key and pins for this brain. Nothing in the brain changes; the phrase adds the device back. */
export async function forgetDeviceKey(ctx: SealingContext): Promise<void> {
  await ctx.store.del(ctx.brainId);
  await loadSealing(ctx);
}

async function commit(ctx: SealingContext, b: { message: string; writes: Array<{ path: string; text: string }>; deletes: string[] }): Promise<void> {
  const head = ctx.brain.head;
  if (!head) throw new Error('no brain is connected');
  await ctx.brain.commit({ message: b.message, expectedHead: head, writes: b.writes, deletes: b.deletes });
}

/**
 * This device's signer for the brain, or null when it cannot seal. `atLaunch` is for capture: the app opens on
 * Capture, and a capture made before the first verification has finished must still be sealed, so there the
 * device's own record is enough unless the state already says the key is not trusted here. Its stored head keeps
 * the chain right before the brain's seal files have been read.
 */
async function deviceSigner(ctx: SealingContext, atLaunch = false) {
  const st = ctx.state.status;
  if (atLaunch ? st === 'mismatch' || st === 'unenrolled' : st !== 'on') return null;
  const record = await ctx.store.get(ctx.brainId);
  if (!record) return null;
  return { record, signer: await cryptoKeySigner(record.key, record.alg, record.pub) };
}

/** Remember the head a committed seal made, and the seal itself, so the next one follows it. */
async function advance(ctx: SealingContext, keyId: string, seals: Array<{ path: string; text: string; head: { seq: number; digest: string } }>): Promise<void> {
  const last = seals[seals.length - 1];
  if (!last) return;
  const fresh = await ctx.store.get(ctx.brainId);
  if (fresh && fresh.keyId === keyId) await ctx.store.set(ctx.brainId, { ...fresh, heads: { ...fresh.heads, [keyId]: last.head } });
  for (const x of seals) ctx.cache.files.set(x.path, x.text);
}

/** Adds this device's seal to a `Capture:` batch (schema §7.5), and records it once the commit lands. */
export interface CaptureSealer {
  seal(batch: CommitBatch): Promise<{ batch: CommitBatch; committed(): Promise<void> } | null>;
}

/** The sealer for the connected brain; `ctx` is read at each capture, so a capture made before sealing is on simply goes unsealed. */
export function captureSealer(ctx: () => SealingContext | null): CaptureSealer {
  return {
    async seal(batch) {
      const c = ctx();
      if (!c) return null;
      const dev = await deviceSigner(c, true);
      if (!dev) return null;
      const md = batch.writes.find((w): w is { path: string; text: string } => 'text' in w && /^inbox\/[^/]+\.md$/.test(w.path));
      if (!md) return null;
      const parsed = tryParseFile(md.path, md.text);
      if (!parsed.ok || parsed.file.fm.type !== 'inbox') return null;
      const file = parsed.file as BrainFile<InboxFm>;
      const stem = md.path.slice('inbox/'.length, -'.md'.length);
      const bytes = file.fm.attachment ? batch.writes.find((w): w is { path: string; bytes: Uint8Array } => 'bytes' in w && w.path === `inbox/${file.fm.attachment}`)?.bytes : undefined;
      const content = await sealContent({ stem, body: file.body, note: file.fm.note, attachment: file.fm.attachment }, bytes);
      const made = await makeSeal(dev.signer, { kind: 'capture', stem, at: file.fm.created, content }, await sealPosition(c.cache.files, dev.record.keyId, dev.record.heads[dev.record.keyId]));
      return {
        batch: { ...batch, writes: [...batch.writes, { path: made.path, text: made.text }] },
        committed: () => advance(c, dev.record.keyId, [made]),
      };
    },
  };
}

/** The `attest` seal for a capture in the snapshot (schema §11.5), made after the curator was shown its whole text. */
async function attestSeal(ctx: SealingContext, signer: Awaited<ReturnType<typeof cryptoKeySigner>>, s: BrainSnapshot, stem: string, files: ReadonlyMap<string, string>, stored: { seq: number; digest: string } | undefined, at: string) {
  const f = s.files.get(`inbox/${stem}.md`) as BrainFile<InboxFm> | undefined;
  if (!f || f.fm.type !== 'inbox') throw new Error(`there is no capture ${stem}`);
  const bytes = f.fm.attachment ? (await ctx.plain.readBytes(`inbox/${f.fm.attachment}`)).bytes : undefined;
  const content = await sealContent({ stem, body: f.body, note: f.fm.note, attachment: f.fm.attachment }, bytes);
  return makeSeal(signer, { kind: 'attest', stem, at, content }, await sealPosition(files, signer.keyId, stored));
}

const NOT_HERE = 'this device cannot seal: set up sealing, or add this device with the recovery phrase, in Settings';

/** "Seal as mine" (schema §7.20): one `attest` seal for a capture that has no valid seal; `Seal: <stem>`. */
export async function sealAsMine(ctx: SealingContext, stem: string, at = nowUtc()): Promise<void> {
  const dev = await deviceSigner(ctx);
  if (!dev) throw new Error(NOT_HERE);
  const v = ctx.state.verdicts[`inbox/${stem}.md`]?.verdict;
  if (v === 'verified' || v === 'attested') throw new Error('this capture is already sealed');
  if (v === 'broken') throw new Error('this capture does not match its seal; sealing it again would hide that');
  const s = ctx.brain.snapshot;
  if (!s) throw new Error('no brain is connected');
  const made = await attestSeal(ctx, dev.signer, s, stem, ctx.cache.files, dev.record.heads[dev.record.keyId], at);
  await commit(ctx, { message: `Seal: ${stem}`, writes: [{ path: made.path, text: made.text }], deletes: [] });
  await advance(ctx, dev.record.keyId, [made]);
  await loadSealing(ctx);
}

/** The captures with no seal at the last verification, by stem. */
export const unsealedCaptures = (state: SealingState): string[] =>
  Object.entries(state.verdicts)
    .filter(([p, v]) => p.startsWith('inbox/') && v.verdict === 'unsealed')
    .map(([p]) => p.slice('inbox/'.length, -'.md'.length))
    .sort();

const CANNOT_SIGN = 'This brain is sealed, and this device holds no key for it. Add this device with the recovery phrase in Settings → Sealing, then try again.';
const TREE_CHANGED = 'The principles differ from what you sealed. Review the differences in Settings → Sealing before changing them.';
export const STILL_VERIFYING = 'The brain is still being verified; try again in a moment.';

const RAW = /^sources\/([^/]+)\/raw\.md$/;
const sameManifest = (a: ManifestBody, b: ManifestBody): boolean => canonicalJson({ sets: a.sets, reserve: a.reserve }) === canonicalJson({ sets: b.sets, reserve: b.reserve });
const CONTENT_KEYS = ['body', 'attachment', 'stem', 'title', 'author', 'work', 'year'] as const;
const sameContent = (a: SourceContent, b: SourceContent): boolean => CONTENT_KEYS.every((k) => canonicalJson(a[k]) === canonicalJson(b[k]));

/** What a source seal would say about a source in a snapshot (schema §11.5); its attachment digested once per blob. */
async function contentOf(ctx: SealingContext, s: BrainSnapshot, slug: string): Promise<SourceContent | undefined> {
  const f = s.files.get(`sources/${slug}/raw.md`) as BrainFile<SourceFm> | undefined;
  if (!f || f.fm.type !== 'source') return undefined;
  const c = await sourceContent({ slug, body: f.body, inboxRef: f.fm.inbox_ref, title: f.fm.title, author: f.fm.author, work: f.fm.work, year: f.fm.year });
  if (f.fm.attachment !== undefined) {
    const d = await attachmentDigest(ctx, s, `sources/${slug}/${f.fm.attachment}`);
    if (!d) throw new Error(`the attached file of ${slug} could not be read, so it cannot be sealed`);
    c.attachment = { name: f.fm.attachment, digest: d };
  }
  return c;
}

/** The manifest of a snapshot's principles tree, each ground bound to the body its source's seal names. */
function manifestOf(s: BrainSnapshot, groundBody: (slug: string) => string | null): Promise<ManifestBody> {
  const input = sealInputFromSnapshot(s, new Map(), async () => undefined);
  return buildManifest(input.sets ?? [], input.principles ?? [], groundBody);
}

type Made = Awaited<ReturnType<typeof makeSeal>>;
/** Seals made one after another by one device, each following the last in its chain. */
function sealChain(ctx: SealingContext, dev: NonNullable<Awaited<ReturnType<typeof deviceSigner>>>) {
  const files = new Map(ctx.cache.files);
  let stored = dev.record.heads[dev.record.keyId];
  const made: Made[] = [];
  return {
    made,
    async add(req: Parameters<typeof makeSeal>[1]): Promise<Made> {
      const m = await makeSeal(dev.signer, req, await sealPosition(files, dev.record.keyId, stored));
      files.set(m.path, m.text);
      stored = m.head;
      made.push(m);
      return m;
    },
  };
}

/** After a commit that carried seals: move the device's head, and remember which seals are now the current ones. */
async function landed(ctx: SealingContext, keyId: string, made: Made[]): Promise<void> {
  await advance(ctx, keyId, made);
  const cur = ctx.cache.current;
  for (const m of made) {
    const payload = (JSON.parse(m.text) as { payload: SourceSealPayload | PrinciplesSealPayload | { kind: 'capture' | 'attest' | 'clear' } }).payload;
    if (payload.kind === 'principles') {
      ctx.cache.sealedTree = true;
      if (cur) cur.manifest = { digest: m.head.digest, payload };
    } else if (payload.kind === 'source' && cur) cur.sources.set(payload.slug, { digest: m.head.digest, payload });
  }
}

/**
 * Adds the seals a commit must carry (schema §7.20, §11.7): a `source` seal
 * when a source is ratified or created by hand (from the day sealing is
 * set up, so that what the curator ratifies is never left unsealed), a
 * replacement when a sealed field of a sealed source changes, and a new
 * `principles` manifest whenever the tree, or what a ground is bound to,
 * differs from the current one. It never signs over a state it did not
 * check: a source or a tree that already differs from its seal before the
 * commit is refused, not re-sealed.
 */
export interface CommitSealer {
  seal(batch: CommitBatch, before: BrainSnapshot): Promise<{ batch: CommitBatch; committed(): Promise<void> } | null>;
}

export function commitSealer(getCtx: () => SealingContext | null): CommitSealer {
  return {
    async seal(batch, before) {
      const ctx = getCtx();
      if (!ctx) return null;
      const paths = [...batch.writes.map((w) => w.path), ...batch.deletes];
      const touchesTree = paths.some((p) => p.startsWith('principles/') && !p.endsWith('/_index.md') && p !== 'principles/_index.md');
      const raws = batch.writes.map((w) => RAW.exec(w.path)?.[1]).filter((x): x is string => x !== undefined);
      if (!touchesTree && raws.length === 0) return null;
      await ctx.cache.verifying;
      // Before the brain is fully sealed a device that can sign still seals what it ratifies; one that cannot is not refused yet.
      const sealedTree = ctx.cache.sealedTree === true;
      const dev = await deviceSigner(ctx);
      if (!dev) {
        if (sealedTree) throw new Error(CANNOT_SIGN);
        return null;
      }
      const cur = ctx.cache.current;
      if (!cur || (sealedTree && !cur.manifest)) {
        if (sealedTree) throw new Error(STILL_VERIFYING);
        return null;
      }
      const after = applyBatch(before, batch);
      const chain = sealChain(ctx, dev);
      const at = nowUtc();
      const newBody = new Map<string, string>();

      for (const slug of raws) {
        const now = cur.sources.get(slug);
        const next = await contentOf(ctx, after, slug);
        if (!next) continue;
        const was = await contentOf(ctx, before, slug);
        const fmOf = (s: BrainSnapshot) => (s.files.get(`sources/${slug}/raw.md`) as BrainFile<SourceFm> | undefined)?.fm.curated;
        if (now) {
          if (!was || !sameContent(was, now.payload)) throw new Error(`${slug} does not match its seal, so it cannot be changed. Settings → Sealing says what differs.`);
          if (sameContent(next, now.payload)) continue;
          if (next.body !== now.payload.body) throw new Error(`the passage of ${slug} is sealed and cannot be changed`);
          await chain.add({ kind: 'source', slug, basis: now.payload.basis, ...(now.payload.since === undefined ? {} : { since: now.payload.since }), at, content: next, replaces: now.digest });
        } else if (fmOf(after) === 'ratified' && fmOf(before) !== 'ratified') {
          if (ctx.state.verdicts[`sources/${slug}/raw.md`]?.verdict === 'broken') throw new Error(`${slug} does not match its sealed capture, so it cannot be ratified`);
          await chain.add({ kind: 'source', slug, basis: 'ratify', at, content: next, replaces: null });
          newBody.set(slug, next.body);
        } else if (!was && fmOf(after) === 'human') {
          await chain.add({ kind: 'source', slug, basis: 'create', at, content: next, replaces: null });
          newBody.set(slug, next.body);
        }
      }

      if (cur.manifest) {
        const bound = (slug: string) => cur.sources.get(slug)?.payload.body ?? null;
        const stands = sameManifest(await manifestOf(before, bound), cur.manifest.payload);
        if (!stands && touchesTree) throw new Error(TREE_CHANGED);
        if (stands) {
          const next = await manifestOf(after, (slug) => newBody.get(slug) ?? bound(slug));
          if (!sameManifest(next, cur.manifest.payload)) await chain.add({ kind: 'principles', at, manifest: next, replaces: cur.manifest.digest });
        }
      }
      if (chain.made.length === 0) return null;
      return {
        batch: { ...batch, writes: [...batch.writes, ...chain.made.map((m) => ({ path: m.path, text: m.text }))] },
        committed: () => landed(ctx, dev.record.keyId, chain.made),
      };
    },
  };
}

/** What "Seal everything that exists" would seal now: unsealed captures, the curator's sources with no seal, and the principles when there is no manifest yet. */
export function existingToSeal(state: SealingState, s: BrainSnapshot | null): { captures: string[]; sources: string[]; sets: number; principles: number; manifest: boolean } {
  const sources = !s
    ? []
    : s
        .byType('source')
        .filter((f) => (f.fm.curated === 'ratified' || f.fm.curated === 'human') && ['unsealed', 'pending'].includes(state.verdicts[f.path]?.verdict ?? ''))
        .map((f) => f.path.split('/')[1]!)
        .sort();
  return { captures: unsealedCaptures(state), sources, sets: s?.sets.length ?? 0, principles: s?.byType('principle').length ?? 0, manifest: !state.fullySealed };
}

/**
 * "Seal everything that exists" (schema §7.20), once: an `attest` seal for
 * each unsealed capture, a `source` seal for each of the curator's sources
 * that has none, and the first principles manifest; `Seal: existing
 * material`. Refused while anything is broken or the seal record has a
 * finding, since sealing then would sign over it.
 */
export async function sealExisting(ctx: SealingContext, at = nowUtc()): Promise<{ captures: number; sources: number; manifest: boolean }> {
  const dev = await deviceSigner(ctx);
  if (!dev) throw new Error(NOT_HERE);
  const s = ctx.brain.snapshot;
  if (!s || ctx.state.verifiedHead !== s.head || !ctx.cache.current) throw new Error(STILL_VERIFYING);
  if (ctx.state.findings.length || Object.values(ctx.state.verdicts).some((v) => v.verdict === 'broken')) throw new Error('Something in this brain does not match its seal. Resolve what is listed above first; sealing now would sign over it.');
  const todo = existingToSeal(ctx.state, s);
  if (todo.captures.length === 0 && todo.sources.length === 0 && !todo.manifest) return { captures: 0, sources: 0, manifest: false };
  const chain = sealChain(ctx, dev);
  const cur = ctx.cache.current;
  for (const stem of todo.captures) {
    const f = s.files.get(`inbox/${stem}.md`) as BrainFile<InboxFm>;
    const bytes = f.fm.attachment ? (await ctx.plain.readBytes(`inbox/${f.fm.attachment}`)).bytes : undefined;
    await chain.add({ kind: 'attest', stem, at, content: await sealContent({ stem, body: f.body, note: f.fm.note, attachment: f.fm.attachment }, bytes) });
  }
  const newBody = new Map<string, string>();
  for (const slug of todo.sources) {
    const content = (await contentOf(ctx, s, slug))!;
    await chain.add({ kind: 'source', slug, basis: 'attest', since: at, at, content, replaces: null });
    newBody.set(slug, content.body);
  }
  const bound = (slug: string) => newBody.get(slug) ?? cur.sources.get(slug)?.payload.body ?? null;
  if (todo.manifest) await chain.add({ kind: 'principles', at, manifest: await manifestOf(s, bound), replaces: null });
  else if (cur.manifest && newBody.size) {
    // a source sealed now binds the grounds that name it, so the manifest follows, provided the tree still stands
    if (sameManifest(await manifestOf(s, (slug) => cur.sources.get(slug)?.payload.body ?? null), cur.manifest.payload)) {
      const next = await manifestOf(s, bound);
      if (!sameManifest(next, cur.manifest.payload)) await chain.add({ kind: 'principles', at, manifest: next, replaces: cur.manifest.digest });
    }
  }
  await commit(ctx, { message: 'Seal: existing material', writes: chain.made.map((m) => ({ path: m.path, text: m.text })), deletes: [] });
  await landed(ctx, dev.record.keyId, chain.made);
  await loadSealing(ctx);
  return { captures: todo.captures.length, sources: todo.sources.length, manifest: todo.manifest };
}

/** "Accept as mine" (schema §7.20): sign the principles tree as it stands, after the curator was shown every difference; `Seal: principles`. */
export async function acceptPrinciples(ctx: SealingContext, at = nowUtc()): Promise<void> {
  const dev = await deviceSigner(ctx);
  if (!dev) throw new Error(NOT_HERE);
  const s = ctx.brain.snapshot;
  const cur = ctx.cache.current;
  if (!s || ctx.state.verifiedHead !== s.head || !cur) throw new Error(STILL_VERIFYING);
  if (!cur.manifest) throw new Error('the principles have not been sealed yet; seal everything that exists first');
  if (ctx.state.differences.length === 0) throw new Error('the principles already match what you sealed');
  const chain = sealChain(ctx, dev);
  await chain.add({ kind: 'principles', at, manifest: await manifestOf(s, (slug) => cur.sources.get(slug)?.payload.body ?? null), replaces: cur.manifest.digest });
  await commit(ctx, { message: 'Seal: principles', writes: chain.made.map((m) => ({ path: m.path, text: m.text })), deletes: [] });
  await landed(ctx, dev.record.keyId, chain.made);
  await loadSealing(ctx);
}

/** "Seal as mine" for a source (schema §7.20): one `source` seal for a source that has none, after the curator was shown its text and attribution; `Seal: source <slug>`. */
export async function sealSourceAsMine(ctx: SealingContext, slug: string, at = nowUtc()): Promise<void> {
  const dev = await deviceSigner(ctx);
  if (!dev) throw new Error(NOT_HERE);
  const s = ctx.brain.snapshot;
  const cur = ctx.cache.current;
  if (!s || ctx.state.verifiedHead !== s.head || !cur) throw new Error(STILL_VERIFYING);
  const v = ctx.state.verdicts[`sources/${slug}/raw.md`]?.verdict;
  if (v === 'verified' || v === 'attested') throw new Error('this source is already sealed');
  if (v === 'broken') throw new Error('this source does not match its seal; sealing it again would hide that');
  const content = await contentOf(ctx, s, slug);
  if (!content) throw new Error(`there is no source ${slug}`);
  const chain = sealChain(ctx, dev);
  await chain.add({ kind: 'source', slug, basis: 'attest', since: at, at, content, replaces: null });
  const bound = (g: string) => cur.sources.get(g)?.payload.body ?? null;
  if (cur.manifest && sameManifest(await manifestOf(s, bound), cur.manifest.payload)) {
    const next = await manifestOf(s, (g) => (g === slug ? content.body : bound(g)));
    if (!sameManifest(next, cur.manifest.payload)) await chain.add({ kind: 'principles', at, manifest: next, replaces: cur.manifest.digest });
  }
  await commit(ctx, { message: `Seal: source ${slug}`, writes: chain.made.map((m) => ({ path: m.path, text: m.text })), deletes: [] });
  await landed(ctx, dev.record.keyId, chain.made);
  await loadSealing(ctx);
}

/**
 * What ratifying a filing's source is allowed to do, by its verdict
 * (decision D2): go, refuse, or seal the capture first. `pending` (the
 * text is the sealed capture's) goes; an unsealed one that names a capture
 * has that capture sealed first, after the curator read it.
 */
export function ratifyRule(state: SealingState, rawPath: string): 'ok' | 'broken' | 'seal-first' {
  if (state.status !== 'on') return state.verdicts[rawPath]?.verdict === 'broken' ? 'broken' : 'ok';
  const v = state.verdicts[rawPath]?.verdict;
  if (v === 'broken') return 'broken';
  return v === 'unsealed' ? 'seal-first' : 'ok';
}

export interface LeftOut { path: string; verdict: SealVerdict['verdict'] }
/**
 * What reasoning may work from (schema §8, §11.6). On a fully sealed
 * brain: the snapshot without passages whose source is not verified or
 * attested, and the sets that do not verify as a whole, which the screen
 * refuses. Before that: the snapshot without broken passages, as before
 * version 2. The same snapshot when nothing is left out.
 */
export function reasonable(s: BrainSnapshot | null, state: SealingState): { snapshot: BrainSnapshot | null; passages: LeftOut[]; sets: LeftOut[] } {
  if (!s || state.verifiedHead === null) return { snapshot: s, passages: [], sets: [] };
  const u = usable({ verdicts: new Map(Object.entries(state.verdicts)), fullySealed: state.fullySealed } as SealResult);
  const passages = u.excluded.filter((x) => x.path.startsWith('sources/') && s.files.has(x.path));
  const sets = u.excluded.filter((x) => x.path.startsWith('principles/') && s.files.has(x.path));
  if (passages.length === 0) return { snapshot: s, passages, sets };
  return { snapshot: applyBatch(s, { message: '', expectedHead: s.head, writes: [], deletes: passages.map((p) => p.path) }), passages, sets };
}

/** Quotations in a reply that are found word for word in none of the texts given (spec §6.5): a string match, nothing more. */
export function unfoundQuotes(reply: string, given: string[]): string[] {
  const fold = (t: string) => t.replace(/[‘’‚‛]/g, "'").replace(/[“”„‟«»]/g, '"').replace(/[‐-―]/g, '-').replace(/[*_`>]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const hay = given.map(fold);
  const spans = new Set<string>();
  for (const m of reply.matchAll(/["“„«]([^"“”„«»\n]{12,})["”»]/g)) spans.add(m[1]!.trim());
  for (const block of reply.split(/\n{2,}/)) {
    const lines = block.split('\n');
    if (lines.every((l) => l.startsWith('>'))) spans.add(lines.map((l) => l.replace(/^>\s?/, '')).join(' ').trim());
  }
  const out: string[] = [];
  for (const span of spans) {
    const needle = fold(span).replace(/^["']+|["'.,;:!?]+$/g, '').replace(/\s*(\.\.\.|…)\s*/g, '\u0000');
    if (needle.length < 12) continue;
    const parts = needle.split('\u0000').filter((p) => p.length >= 8);
    if (parts.length && !hay.some((h) => parts.every((p) => h.includes(p)))) out.push(span);
  }
  return out;
}
