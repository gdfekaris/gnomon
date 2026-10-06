// Sealing records — schema §11.2, §11.4, §11.5: the payload shapes, strict
// parsing (a field out of place is a malformed record, never ignored), the
// paths, and building signed files.
import { isEncryptedBody } from '../crypto/body';
import { isInboxStem, isSourceSlug } from '../schema/identifiers';
import { DIGEST, signedBytes } from './encoding';
import { SEAL_ALGS, type SealAlg, type Signer, keyId } from './keys';

export const GNOMON_DIR = '.gnomon/';
export const ROOT_PATH = '.gnomon/root.json';
export const KEYS_DIR = '.gnomon/keys/';
export const REQUESTS_DIR = '.gnomon/keys/requests/';
export const SEALS_DIR = '.gnomon/seals/';

export const enrollmentPath = (key: string): string => `${KEYS_DIR}${key}.json`;
export const revocationPath = (key: string): string => `${KEYS_DIR}${key}.revoked.json`;
export const requestPath = (key: string): string => `${REQUESTS_DIR}${key}.json`;
export const sealPath = (key: string, seq: number): string => `${SEALS_DIR}${key}/${String(seq).padStart(6, '0')}.json`;
/** Key and seq of a seal path, or undefined when the path is not one (schema §11.2). */
export function parseSealPath(path: string): { key: string; seq: number } | undefined {
  const m = /^\.gnomon\/seals\/([0-9a-f]{32})\/(\d{6,})\.json$/.exec(path);
  if (!m) return undefined;
  const seq = Number(m[2]);
  return seq >= 1 && Number.isSafeInteger(seq) && sealPath(m[1]!, seq) === path ? { key: m[1]!, seq } : undefined;
}

const KEY_ID = /^[0-9a-f]{32}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export interface RootRecord { v: 1; alg: 'ed25519'; pub: string; id: string }
export interface EnrollPayload { v: 1; kind: 'enroll'; key: string; alg: SealAlg; pub: string; label: string; device: 'phone' | 'fido'; at: string; root: string }
export interface RevokePayload { v: 1; kind: 'revoke'; key: string; last_seq: number; last: string | null; at: string; root: string }
export interface RequestPayload { v: 1; kind: 'request'; key: string; alg: 'sk-ed25519'; pub: string; label: string; at: string }
export interface SealAttachment { name: string; digest: string }
export type ContentSealPayload = { v: 1; kind: 'capture' | 'attest'; stem: string; body: string; note?: string; attachment: SealAttachment | null; at: string; key: string; seq: number; prev: string | null };
export type ClearSealPayload = { v: 1; kind: 'clear'; stem: string; filed_as: string | null; at: string; key: string; seq: number; prev: string | null };
export type SealPayload = ContentSealPayload | ClearSealPayload;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isCount = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;

/** The fields present are exactly `required` plus any of `optional`; else the offending field. */
function fieldsProblem(o: Obj, required: string[], optional: string[] = []): string | undefined {
  for (const k of required) if (!(k in o)) return `it lacks \`${k}\``;
  for (const k of Object.keys(o)) if (!required.includes(k) && !optional.includes(k)) return `it has an unexpected field \`${k}\``;
  return undefined;
}

/** `{payload, sig}` from a signed file's text, or why not. */
export function parseSigned(text: string): { payload: Obj; sig: string } | string {
  if (isEncryptedBody(text)) return 'it is encrypted';
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return 'it is not JSON';
  }
  if (!isObj(v)) return 'it is not a JSON object';
  const bad = fieldsProblem(v, ['payload', 'sig']);
  if (bad) return bad;
  if (!isObj(v.payload) || !isStr(v.sig)) return 'its payload or sig has the wrong type';
  return { payload: v.payload, sig: v.sig };
}

export function checkSealPayload(p: Obj): SealPayload | string {
  if (p.v !== 1) return 'its `v` is not 1';
  const common = ['v', 'kind', 'stem', 'at', 'key', 'seq', 'prev'];
  const bad = p.kind === 'clear' ? fieldsProblem(p, [...common, 'filed_as']) : p.kind === 'capture' || p.kind === 'attest' ? fieldsProblem(p, [...common, 'body', 'attachment'], ['note']) : 'its `kind` is unknown';
  if (bad) return bad;
  if (!isStr(p.stem) || !isInboxStem(p.stem)) return 'its `stem` is not a capture stem';
  if (!isStr(p.at) || !DATETIME.test(p.at)) return 'its `at` is not a UTC datetime';
  if (!isStr(p.key) || !KEY_ID.test(p.key)) return 'its `key` is not a key id';
  if (!isCount(p.seq, 1)) return 'its `seq` is not a positive integer';
  if (p.seq === 1 ? p.prev !== null : !(isStr(p.prev) && DIGEST.test(p.prev))) return 'its `prev` does not fit its `seq`';
  if (p.kind === 'clear') {
    if (!(p.filed_as === null || (isStr(p.filed_as) && isSourceSlug(p.filed_as)))) return 'its `filed_as` is not a source slug or null';
    return p as unknown as ClearSealPayload;
  }
  if (!isStr(p.body) || !DIGEST.test(p.body)) return 'its `body` is not a digest';
  if ('note' in p && !(isStr(p.note) && DIGEST.test(p.note))) return 'its `note` is not a digest';
  if (p.attachment !== null) {
    const a = p.attachment;
    if (!isObj(a) || fieldsProblem(a, ['name', 'digest']) || !isStr(a.name) || !isStr(a.digest) || !DIGEST.test(a.digest)) return 'its `attachment` is malformed';
    if (!a.name.startsWith(`${p.stem}.`) || !/^[a-z0-9]+$/i.test(a.name.slice(p.stem.length + 1))) return 'its attachment name does not belong to its stem';
  }
  return p as unknown as ContentSealPayload;
}

export async function checkEnrollPayload(p: Obj): Promise<EnrollPayload | string> {
  const bad = fieldsProblem(p, ['v', 'kind', 'key', 'alg', 'pub', 'label', 'device', 'at', 'root']);
  if (bad) return bad;
  if (p.v !== 1 || p.kind !== 'enroll') return 'it is not an enrollment';
  if (!SEAL_ALGS.includes(p.alg as SealAlg) || !isStr(p.pub)) return 'its key is malformed';
  if ((p.device === 'fido') !== (p.alg === 'sk-ed25519') || (p.device !== 'fido' && p.device !== 'phone')) return 'its `device` does not fit its `alg`';
  if (!isStr(p.label) || p.label.trim() === '' || !isStr(p.at) || !DATETIME.test(p.at) || !isStr(p.root) || !KEY_ID.test(p.root)) return 'its label, date, or root is malformed';
  let id: string;
  try {
    id = await keyId(p.alg as SealAlg, p.pub);
  } catch {
    return 'its `pub` is not a key of its `alg`';
  }
  if (p.key !== id) return 'its `key` is not the id of its `pub`';
  return p as unknown as EnrollPayload;
}

export function checkRevokePayload(p: Obj): RevokePayload | string {
  const bad = fieldsProblem(p, ['v', 'kind', 'key', 'last_seq', 'last', 'at', 'root']);
  if (bad) return bad;
  if (p.v !== 1 || p.kind !== 'revoke') return 'it is not a revocation';
  if (!isStr(p.key) || !KEY_ID.test(p.key) || !isCount(p.last_seq, 0)) return 'its key or `last_seq` is malformed';
  if (p.last_seq === 0 ? p.last !== null : !(isStr(p.last) && DIGEST.test(p.last))) return 'its `last` does not fit its `last_seq`';
  if (!isStr(p.at) || !DATETIME.test(p.at) || !isStr(p.root) || !KEY_ID.test(p.root)) return 'its date or root is malformed';
  return p as unknown as RevokePayload;
}

export function parseRootRecord(text: string): RootRecord | undefined {
  try {
    const v: unknown = JSON.parse(text);
    if (!isObj(v) || fieldsProblem(v, ['v', 'alg', 'pub', 'id']) || v.v !== 1 || v.alg !== 'ed25519' || !isStr(v.pub) || !isStr(v.id)) return undefined;
    return v as unknown as RootRecord;
  } catch {
    return undefined;
  }
}

const signedFile = (payload: object, sig: string): string => `${JSON.stringify({ payload, sig }, null, 2)}\n`;

export function rootFile(root: Pick<Signer, 'pub' | 'keyId'>): { path: string; text: string } {
  return { path: ROOT_PATH, text: `${JSON.stringify({ v: 1, alg: 'ed25519', pub: root.pub, id: root.keyId }, null, 2)}\n` };
}

export async function makeEnrollment(root: Signer, k: { alg: SealAlg; pub: string; label: string; at: string }): Promise<{ path: string; text: string; payload: EnrollPayload }> {
  const payload: EnrollPayload = { v: 1, kind: 'enroll', key: await keyId(k.alg, k.pub), alg: k.alg, pub: k.pub, label: k.label, device: k.alg === 'sk-ed25519' ? 'fido' : 'phone', at: k.at, root: root.keyId };
  return { path: enrollmentPath(payload.key), text: signedFile(payload, await root.sign(signedBytes('enroll', payload))), payload };
}

export async function makeRevocation(root: Signer, r: { key: string; last_seq: number; last: string | null; at: string }): Promise<{ path: string; text: string }> {
  const payload: RevokePayload = { v: 1, kind: 'revoke', key: r.key, last_seq: r.last_seq, last: r.last, at: r.at, root: root.keyId };
  return { path: revocationPath(r.key), text: signedFile(payload, await root.sign(signedBytes('revoke', payload))) };
}

export async function makeRequest(k: { pub: string; label: string; at: string }): Promise<{ path: string; text: string; key: string }> {
  const key = await keyId('sk-ed25519', k.pub);
  const payload: RequestPayload = { v: 1, kind: 'request', key, alg: 'sk-ed25519', pub: k.pub, label: k.label, at: k.at };
  return { path: requestPath(key), text: `${JSON.stringify({ payload }, null, 2)}\n`, key };
}

export { signedFile };
