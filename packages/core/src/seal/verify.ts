// Verification — schema §11.6, step by step. Pure over its input: the
// captures and sources with plaintext bodies, every file under .gnomon/ with
// seal files decrypted, and a way to digest an attachment. The caller holds
// the pinned root and heads, which never come from the brain.
import { isEncryptedBody } from '../crypto/body';
import type { BrainSnapshot } from '../schema/types';
import { bodyBytes, digest, signedBytes, utf8 } from './encoding';
import { type SealAlg, verifySignature } from './keys';
import { type Head, type Heads, sealDigest } from './make';
import {
  type ClearSealPayload, type ContentSealPayload, type EnrollPayload, KEYS_DIR, REQUESTS_DIR, ROOT_PATH, type RevokePayload, SEALS_DIR, type SealPayload,
  checkEnrollPayload, checkRevokePayload, checkSealPayload, parseRootRecord, parseSealPath, parseSigned,
} from './records';

export interface SealCapture { path: string; stem: string; body: string; note?: string | undefined; attachment?: string | undefined }
export interface SealSource { path: string; inboxRef?: string | undefined; body: string; attachment?: string | undefined }
export interface SealInput {
  captures: SealCapture[];
  sources: SealSource[];
  /** every file under `.gnomon/`, path → text, seal files decrypted */
  gnomon: ReadonlyMap<string, string>;
  /** the digest (schema §11.1) of the attachment at a path, or undefined when it does not exist */
  attachmentDigest(path: string): Promise<string | undefined>;
}
export interface PinnedRoot { id: string; pub: string }

export type FindingCode =
  | 'root-replaced' | 'key-record-invalid' | 'unknown-key' | 'seal-invalid' | 'chain-gap' | 'chain-broken' | 'rolled-back' | 'sealed-after-revocation' | 'sealed-capture-deleted';
export interface SealFinding { code: FindingCode; path: string; detail: string }
export type SealVerdict =
  | { verdict: 'verified' }
  | { verdict: 'attested'; since: string }
  | { verdict: 'unsealed' }
  | { verdict: 'broken'; why: string };
export interface SealResult {
  /** seal files or bodies are still ciphertext: nothing was verified */
  locked: boolean;
  findings: SealFinding[];
  /** by capture path and source `raw.md` path */
  verdicts: Map<string, SealVerdict>;
  /** the heads to pin; null unless there is no finding and nothing broken (step 6) */
  heads: Heads | null;
}

/** The input for a snapshot whose bodies are decrypted; attachments are digested by the caller. */
export function sealInputFromSnapshot(s: BrainSnapshot, gnomon: ReadonlyMap<string, string>, attachmentDigest: (path: string) => Promise<string | undefined>): SealInput {
  const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
  return {
    captures: s.byType('inbox').map((f) => ({ path: f.path, stem: f.path.slice('inbox/'.length, -'.md'.length), body: f.body, note: str(f.fm.note), attachment: f.fm.attachment })),
    sources: s.byType('source').map((f) => ({ path: f.path, inboxRef: f.fm.inbox_ref, body: f.body, attachment: f.fm.attachment })),
    gnomon,
    attachmentDigest,
  };
}

interface SealRec { path: string; seq: number; payload?: SealPayload; digest?: string; valid: boolean }

const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);
const extOf = (name: string) => name.slice(name.lastIndexOf('.') + 1);

export async function verifySeals(input: SealInput, root: PinnedRoot, pinned: Heads = {}): Promise<SealResult> {
  const findings: SealFinding[] = [];
  const find = (code: FindingCode, path: string, detail: string) => findings.push({ code, path, detail });
  const lockedResult: SealResult = { locked: true, findings: [], verdicts: new Map(), heads: null };
  for (const [path, text] of input.gnomon) if (path.startsWith(SEALS_DIR) && isEncryptedBody(text)) return lockedResult;
  if ([...input.captures, ...input.sources].some((f) => isEncryptedBody(f.body))) return lockedResult;

  // 1. Keys.
  const rootText = input.gnomon.get(ROOT_PATH);
  if (rootText !== undefined) {
    const r = parseRootRecord(rootText);
    if (!r || r.id !== root.id || r.pub !== root.pub) find('root-replaced', ROOT_PATH, 'it does not name the pinned root');
  }
  const keyPaths = [...input.gnomon.keys()].filter((p) => p.startsWith(KEYS_DIR) && !p.startsWith(REQUESTS_DIR)).sort();
  const enrolled = new Map<string, EnrollPayload>();
  const revoked = new Map<string, RevokePayload>();
  const rootSigned = async (kind: 'enroll' | 'revoke', payload: { root: string }, sig: string) =>
    payload.root === root.id && (await verifySignature('ed25519', root.pub, sig, signedBytes(kind, payload)));
  for (const path of keyPaths.filter((p) => !p.endsWith('.revoked.json'))) {
    const parsed = parseSigned(input.gnomon.get(path)!);
    const e = typeof parsed === 'string' ? parsed : await checkEnrollPayload(parsed.payload);
    if (typeof e === 'string') find('key-record-invalid', path, e);
    else if (path !== `${KEYS_DIR}${e.key}.json`) find('key-record-invalid', path, 'its name is not its key id');
    else if (!(await rootSigned('enroll', e, (parsed as { sig: string }).sig))) find('key-record-invalid', path, 'the pinned root did not sign it');
    else enrolled.set(e.key, e);
  }
  for (const path of keyPaths.filter((p) => p.endsWith('.revoked.json'))) {
    const parsed = parseSigned(input.gnomon.get(path)!);
    const r = typeof parsed === 'string' ? parsed : checkRevokePayload(parsed.payload);
    if (typeof r === 'string') find('key-record-invalid', path, r);
    else if (path !== `${KEYS_DIR}${r.key}.revoked.json`) find('key-record-invalid', path, 'its name is not its key id');
    else if (!enrolled.has(r.key)) find('key-record-invalid', path, 'it revokes a key that is not enrolled');
    else if (!(await rootSigned('revoke', r, (parsed as { sig: string }).sig))) find('key-record-invalid', path, 'the pinned root did not sign it');
    else revoked.set(r.key, r);
  }

  // 2. Seals.
  const folders = new Map<string, Map<number, SealRec>>();
  for (const path of [...input.gnomon.keys()].filter((p) => p.startsWith(SEALS_DIR)).sort()) {
    const at = parseSealPath(path);
    if (!at) {
      find('seal-invalid', path, 'it is not at a seal path');
      continue;
    }
    const rec: SealRec = { path, seq: at.seq, valid: false };
    const parsed = parseSigned(input.gnomon.get(path)!);
    const payload = typeof parsed === 'string' ? parsed : checkSealPayload(parsed.payload);
    if (typeof payload === 'string') find('seal-invalid', path, payload);
    else {
      rec.payload = payload;
      rec.digest = await sealDigest(payload);
      const key = enrolled.get(at.key);
      if (payload.key !== at.key || payload.seq !== at.seq) find('seal-invalid', path, 'its key or seq disagrees with its path');
      else if (!key) {
        // reported once for the folder below
      } else if (!(await verifySignature(key.alg as SealAlg, key.pub, (parsed as { sig: string }).sig, signedBytes('seal', payload)))) find('seal-invalid', path, 'its signature does not verify');
      else rec.valid = true;
    }
    if (!folders.has(at.key)) folders.set(at.key, new Map());
    folders.get(at.key)!.set(at.seq, rec);
  }
  for (const key of folders.keys()) if (!enrolled.has(key)) find('unknown-key', `${SEALS_DIR}${key}/`, 'no enrolled key signed these seals');

  // 3. Chains.
  for (const [key, recs] of folders) {
    if (!enrolled.has(key)) continue;
    const n = Math.max(...recs.keys());
    for (let seq = 1; seq <= n; seq++) if (!recs.has(seq)) find('chain-gap', `${SEALS_DIR}${key}/`, `seal ${seq} of ${n} is missing`);
    for (const rec of recs.values()) {
      if (!rec.payload) continue;
      if (rec.seq === 1 ? rec.payload.prev !== null : recs.has(rec.seq - 1) && rec.payload.prev !== recs.get(rec.seq - 1)!.digest) find('chain-broken', rec.path, 'its prev does not name the seal before it');
    }
    const r = revoked.get(key);
    if (r) {
      for (const rec of recs.values())
        if (rec.seq > r.last_seq && rec.payload) {
          rec.valid = false;
          find('sealed-after-revocation', rec.path, 'its key was revoked before it');
        }
      if (r.last_seq > 0 && recs.get(r.last_seq)?.digest !== r.last) find('rolled-back', `${SEALS_DIR}${key}/`, `seal ${r.last_seq} differs from the one its revocation names`);
    }
  }
  for (const [key, h] of Object.entries(pinned)) {
    if (folders.get(key)?.get(h.seq)?.digest !== h.digest) find('rolled-back', `${SEALS_DIR}${key}/`, `seal ${h.seq} is missing or differs from the one this verifier accepted`);
  }

  // 4. Content.
  const content = new Map<string, ContentSealPayload[]>();
  const clears = new Map<string, ClearSealPayload[]>();
  const invalidStems = new Set<string>();
  for (const recs of folders.values())
    for (const rec of recs.values()) {
      if (!rec.payload) continue;
      if (!rec.valid) invalidStems.add(rec.payload.stem);
      else if (rec.payload.kind === 'clear') clears.set(rec.payload.stem, [...(clears.get(rec.payload.stem) ?? []), rec.payload]);
      else content.set(rec.payload.stem, [...(content.get(rec.payload.stem) ?? []), rec.payload]);
    }
  const capByStem = new Map(input.captures.map((c) => [c.stem, c]));
  const srcByStem = new Map<string, SealSource[]>();
  for (const s of input.sources) if (s.inboxRef !== undefined) srcByStem.set(s.inboxRef, [...(srcByStem.get(s.inboxRef) ?? []), s]);
  const broken = new Map<string, string>();
  const attachmentProblem = async (declared: string | undefined, want: ContentSealPayload['attachment'], path: (name: string) => string, name: (n: string) => string) => {
    if (want === null) return declared === undefined ? undefined : 'it gained an attachment';
    if (declared !== name(want.name)) return 'its attachment field differs from the sealed one';
    const d = await input.attachmentDigest(path(declared));
    return d === undefined ? 'its attached file is missing' : d !== want.digest ? 'its attached file differs from the sealed one' : undefined;
  };
  for (const [stem, seals] of content) {
    const cap = capByStem.get(stem);
    for (const seal of seals) {
      if (cap && !broken.has(cap.path)) {
        const why =
          (await digest(bodyBytes(cap.body))) !== seal.body
            ? 'its passage differs from the sealed one'
            : (cap.note !== undefined) !== (seal.note !== undefined)
              ? 'its note was added or removed'
              : cap.note !== undefined && (await digest(utf8(cap.note))) !== seal.note
                ? 'its note differs from the sealed one'
                : await attachmentProblem(cap.attachment, seal.attachment, (n) => `inbox/${n}`, (n) => n);
        if (why) broken.set(cap.path, why);
      }
      for (const src of srcByStem.get(stem) ?? []) {
        if (broken.has(src.path)) continue;
        const why =
          (await digest(bodyBytes(src.body))) !== seal.body
            ? 'its passage differs from the sealed capture'
            : await attachmentProblem(src.attachment, seal.attachment, (n) => `${dirOf(src.path)}${n}`, (n) => `original.${extOf(n)}`);
        if (why) broken.set(src.path, why);
      }
    }
    if (!cap) {
      const tombs = clears.get(stem) ?? [];
      if (tombs.length === 0) find('sealed-capture-deleted', `inbox/${stem}.md`, 'a sealed capture is gone and no tombstone says the curator cleared it');
      for (const t of tombs)
        if (t.filed_as !== null && !(srcByStem.get(stem) ?? []).some((s) => s.path === `sources/${t.filed_as}/raw.md`))
          find('sealed-capture-deleted', `sources/${t.filed_as}/raw.md`, 'the source a cleared capture was filed as is gone');
    }
  }

  // 5. Verdicts.
  const verdicts = new Map<string, SealVerdict>();
  const verdictFor = (path: string, stem: string | undefined): SealVerdict => {
    if (stem === undefined) return { verdict: 'unsealed' };
    const why = broken.get(path);
    if (why) return { verdict: 'broken', why };
    if (invalidStems.has(stem)) return { verdict: 'broken', why: 'a seal naming it is invalid' };
    const seals = content.get(stem) ?? [];
    if (seals.some((s) => s.kind === 'capture')) return { verdict: 'verified' };
    const attests = seals.map((s) => s.at).sort();
    return attests.length ? { verdict: 'attested', since: attests[0]! } : { verdict: 'unsealed' };
  };
  for (const c of input.captures) verdicts.set(c.path, verdictFor(c.path, c.stem));
  for (const s of input.sources) verdicts.set(s.path, verdictFor(s.path, s.inboxRef));

  // 6. Heads.
  findings.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  let heads: Heads | null = null;
  if (findings.length === 0 && ![...verdicts.values()].some((v) => v.verdict === 'broken')) {
    heads = {};
    for (const [key, recs] of folders) {
      const n = Math.max(...recs.keys());
      heads[key] = { seq: n, digest: recs.get(n)!.digest! } satisfies Head;
    }
  }
  return { locked: false, findings, verdicts, heads };
}
