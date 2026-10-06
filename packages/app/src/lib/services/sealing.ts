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
  type BrainFile, type BrainSnapshot, type CommitBatch, type EnrollPayload, type InboxFm, KEYS_DIR, type Heads, type PinnedRoot, ROOT_PATH, SEALS_DIR, type SealFinding,
  type SealVerdict, applyBatch, cryptoKeySigner, deriveRoot, digest, entropyToPhrase, fingerprint, generateDeviceKey, keyRecords, makeEnrollment, makeRevocation, makeSeal,
  newEntropy, nowUtc, parseRequestFile, parseRootRecord, phraseToEntropy, requestPath, rootFile, sealContent, sealInputFromSnapshot, sealPosition, tryParseFile, verifySeals,
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
  /** schema §11.6 at the last verified head: per capture and source path */
  verdicts: Record<string, SealVerdict>;
  /** findings about the seal record itself; any one is a banner on every screen */
  findings: SealFinding[];
  /** seal files are still ciphertext (an encrypted brain, locked): nothing was verified */
  locked: boolean;
  /** the head the verdicts belong to, or null before the first verification */
  verifiedHead: string | null;
  /** sources that name no capture (made by hand, or filed before `inbox_ref`): nothing can seal them */
  uncapturable: string[];
}

export const emptySealing = (): SealingState => ({ status: 'off', root: null, device: null, keys: [], requests: [], error: null, verdicts: {}, findings: [], locked: false, verifiedHead: null, uncapturable: [] });

/** What a session keeps between runs: the last sealing files read, attachment digests by blob sha, and a run counter that drops stale results. */
export interface SealCache { files: Map<string, string>; digests: Map<string, string>; run: number }
export const newSealCache = (): SealCache => ({ files: new Map(), digests: new Map(), run: 0 });

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
export async function loadSealing(ctx: SealingContext): Promise<void> {
  const run = ++ctx.cache.run;
  try {
    const files = await readFiles(ctx);
    const record = await ctx.store.get(ctx.brainId);
    const next = await describeSealing(files, record);
    const s = ctx.brain.snapshot;
    let verified: Pick<SealingState, 'verdicts' | 'findings' | 'locked' | 'verifiedHead' | 'uncapturable'> = { verdicts: {}, findings: [], locked: false, verifiedHead: null, uncapturable: [] };
    if (record && s && (next.status === 'on' || next.status === 'unenrolled')) {
      const input = sealInputFromSnapshot(s, files, (path) => attachmentDigest(ctx, s, path));
      const r = await verifySeals(input, record.root, record.heads);
      verified = {
        verdicts: Object.fromEntries(r.verdicts),
        findings: r.findings,
        locked: r.locked,
        verifiedHead: s.head,
        uncapturable: s.byType('source').filter((f) => !f.fm.inbox_ref).map((f) => f.path),
      };
      if (r.heads && run === ctx.cache.run) {
        const fresh = await ctx.store.get(ctx.brainId);
        if (fresh && fresh.keyId === record.keyId) await ctx.store.set(ctx.brainId, { ...fresh, heads: { ...fresh.heads, ...r.heads } });
      }
    }
    if (run !== ctx.cache.run) return;
    ctx.cache.files = files;
    Object.assign(ctx.state, next, verified);
  } catch (e) {
    if (run !== ctx.cache.run) return;
    Object.assign(ctx.state, emptySealing(), { error: e instanceof Error ? e.message : String(e) });
  }
}

/** An attachment's digest (schema §11.1), read once per blob and kept by its sha for the session. */
async function attachmentDigest(ctx: SealingContext, s: BrainSnapshot, path: string): Promise<string | undefined> {
  const a = s.attachments.get(path);
  if (!a) return undefined;
  const known = a.sha ? ctx.cache.digests.get(a.sha) : undefined;
  if (known) return known;
  const d = await digest((await ctx.plain.readBytes(path)).bytes);
  if (a.sha) ctx.cache.digests.set(a.sha, d);
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

/** Seal every unsealed capture once, as it stands (schema §7.20, decision D6): `Seal: <n> existing captures`. */
export async function sealExisting(ctx: SealingContext, at = nowUtc()): Promise<number> {
  const dev = await deviceSigner(ctx);
  if (!dev) throw new Error(NOT_HERE);
  const s = ctx.brain.snapshot;
  if (!s || ctx.state.verifiedHead !== s.head) throw new Error('the brain is still being verified; try again in a moment');
  const stems = unsealedCaptures(ctx.state);
  if (stems.length === 0) return 0;
  const files = new Map(ctx.cache.files);
  const made: Array<Awaited<ReturnType<typeof makeSeal>>> = [];
  let stored = dev.record.heads[dev.record.keyId];
  for (const stem of stems) {
    const m = await attestSeal(ctx, dev.signer, s, stem, files, stored, at);
    files.set(m.path, m.text);
    stored = m.head;
    made.push(m);
  }
  await commit(ctx, { message: `Seal: ${stems.length} existing capture${stems.length === 1 ? '' : 's'}`, writes: made.map((m) => ({ path: m.path, text: m.text })), deletes: [] });
  await advance(ctx, dev.record.keyId, made);
  await loadSealing(ctx);
  return stems.length;
}

/** What ratifying a filing's source is allowed to do, by its verdict (decision D2): go, refuse, or seal the capture first. */
export function ratifyRule(state: SealingState, rawPath: string): 'ok' | 'broken' | 'seal-first' {
  if (state.status !== 'on') return state.verdicts[rawPath]?.verdict === 'broken' ? 'broken' : 'ok';
  const v = state.verdicts[rawPath]?.verdict;
  if (v === 'broken') return 'broken';
  return v === 'unsealed' ? 'seal-first' : 'ok';
}

/** The snapshot reasoning works from: broken passages left out (decision D3). The same snapshot when nothing is broken. */
export function withoutBroken(s: BrainSnapshot | null, verdicts: Record<string, SealVerdict>): BrainSnapshot | null {
  if (!s) return s;
  const broken = Object.entries(verdicts).filter(([p, v]) => v.verdict === 'broken' && p.startsWith('sources/') && s.files.has(p)).map(([p]) => p);
  if (broken.length === 0) return s;
  return applyBatch(s, { message: '', expectedHead: s.head, writes: [], deletes: broken });
}
