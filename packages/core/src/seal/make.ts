// Making seals — schema §11.5, §11.7. A seal is made at commit time: its seq
// follows the greater of the device's stored head and the highest seal of its
// key in the tree, so a crash between commit and store cannot fork a chain.
import { decryptBody, encryptBody, isEncryptedBody } from '../crypto/body';
import { bodyBytes, canonicalJson, digest, signedBytes, utf8 } from './encoding';
import type { Signer } from './keys';
import {
  type ContentSealPayload, type ClearSealPayload, type ManifestEntry, type ManifestSet, type PrinciplesSealPayload, SEALS_DIR, type SealAttachment, type SealPayload, type SourceSealPayload,
  checkSealPayload, parseSealPath, parseSigned, sealPath, signedFile,
} from './records';

export interface Head { seq: number; digest: string }
/** Per key id, the highest seal a device or verifier has accepted (schema §11.6). */
export type Heads = Record<string, Head>;

/** What a content seal says about a capture: digests of its body, note, and attachment (schema §11.1). */
export interface SealContent { body: string; note?: string; attachment: SealAttachment | null }

export async function sealContent(c: { stem: string; body: string; note?: string | undefined; attachment?: string | undefined }, attachmentBytes?: Uint8Array): Promise<SealContent> {
  let attachment: SealAttachment | null = null;
  if (c.attachment !== undefined) {
    if (!attachmentBytes) throw new Error(`the capture ${c.stem} has an attachment; its bytes are needed to seal it`);
    attachment = { name: c.attachment, digest: await digest(attachmentBytes) };
  }
  const out: SealContent = { body: await digest(bodyBytes(c.body)), attachment };
  if (c.note !== undefined) out.note = await digest(utf8(c.note));
  return out;
}

/** Digest of a seal: of its signed bytes (schema §11.3). */
export const sealDigest = (payload: SealPayload): Promise<string> => digest(signedBytes('seal', payload));

/** The next `seq` and `prev` for `key`, from the stored head and the tree's seal files (plaintext). */
export async function sealPosition(gnomon: ReadonlyMap<string, string>, key: string, stored?: Head): Promise<{ seq: number; prev: string | null }> {
  let top: { seq: number; path: string } | undefined;
  for (const path of gnomon.keys()) {
    const at = parseSealPath(path);
    if (at?.key === key && at.seq > (top?.seq ?? 0)) top = { seq: at.seq, path };
  }
  let best = stored;
  if (top && top.seq > (stored?.seq ?? 0)) {
    const parsed = parseSigned(gnomon.get(top.path)!);
    const payload = typeof parsed === 'string' ? parsed : checkSealPayload(parsed.payload);
    if (typeof payload === 'string') throw new Error(`${top.path} cannot be extended: ${payload}`);
    best = { seq: top.seq, digest: await sealDigest(payload) };
  }
  return best ? { seq: best.seq + 1, prev: best.digest } : { seq: 1, prev: null };
}

/** A frontmatter text value as a seal carries it (schema §11.1): a string, an integer in plain decimal, null when absent. */
export const textValue = (v: unknown): string | null => (v === undefined || v === null ? null : String(v));

/** What a source seal says about a source (schema §11.5): its text, its file, the capture it came from, and its attribution. */
export interface SourceContent { body: string; attachment: SealAttachment | null; stem: string | null; title: string | null; author: string | null; work: string | null; year: string | null }
export interface SourceFields { slug: string; body: string; attachment?: string | undefined; inboxRef?: string | undefined; title?: unknown; author?: unknown; work?: unknown; year?: unknown }

export async function sourceContent(s: SourceFields, attachmentBytes?: Uint8Array): Promise<SourceContent> {
  let attachment: SealAttachment | null = null;
  if (s.attachment !== undefined) {
    if (!attachmentBytes) throw new Error(`the source ${s.slug} has an attachment; its bytes are needed to seal it`);
    attachment = { name: s.attachment, digest: await digest(attachmentBytes) };
  }
  return { body: await digest(bodyBytes(s.body)), attachment, stem: s.inboxRef ?? null, title: textValue(s.title), author: textValue(s.author), work: textValue(s.work), year: textValue(s.year) };
}

/** Descriptor digest of a set (schema §11.1): its name and its description. */
export const descriptorDigest = async (set: { name?: unknown; body: string }): Promise<string> =>
  digest(utf8(canonicalJson({ body: await digest(bodyBytes(set.body)), name: textValue(set.name) })));

export interface PrincipleFields { title?: unknown; body: string; grounds?: readonly string[] | undefined; related?: readonly string[] | undefined }
/** Principle digest (schema §11.1): title, body, related, and each ground bound to its source's sealed body (null when the source has no seal). */
export const principleDigest = async (p: PrincipleFields, groundBody: (slug: string) => string | null): Promise<string> =>
  digest(
    utf8(
      canonicalJson({
        body: await digest(bodyBytes(p.body)),
        grounds: (p.grounds ?? []).map((slug) => ({ body: groundBody(slug), slug })),
        related: [...(p.related ?? [])],
        title: textValue(p.title),
      }),
    ),
  );

export interface ManifestBody { sets: ManifestSet[]; reserve: ManifestEntry[] }
export interface TreeSet { slug: string; order: number; name?: unknown; body: string }
export interface TreePrinciple extends PrincipleFields { set: string; slug: string; order?: number | undefined }
export const RESERVE_SET = '_reserve';

/** The manifest of a principles tree as it stands (schema §11.5): sets and their principles by `order`, the reserve by slug. */
export async function buildManifest(sets: readonly TreeSet[], principles: readonly TreePrinciple[], groundBody: (slug: string) => string | null): Promise<ManifestBody> {
  const entry = async (p: TreePrinciple): Promise<ManifestEntry> => ({ slug: p.slug, digest: await principleDigest(p, groundBody) });
  const byOrder = <T extends { order?: number | undefined; slug: string }>(a: T, b: T) => (a.order ?? 0) - (b.order ?? 0) || (a.slug < b.slug ? -1 : 1);
  const out: ManifestBody = { sets: [], reserve: [] };
  for (const s of [...sets].sort(byOrder))
    out.sets.push({ slug: s.slug, descriptor: await descriptorDigest(s), principles: await Promise.all(principles.filter((p) => p.set === s.slug).sort(byOrder).map(entry)) });
  out.reserve = await Promise.all(principles.filter((p) => p.set === RESERVE_SET).sort((a, b) => (a.slug < b.slug ? -1 : 1)).map(entry));
  return out;
}

export type SealRequest =
  | { kind: 'capture' | 'attest'; stem: string; at: string; content: SealContent }
  | { kind: 'clear'; stem: string; at: string; filed_as: string | null }
  | { kind: 'source'; slug: string; basis: 'ratify' | 'create' | 'attest'; since?: string; at: string; content: SourceContent; replaces: string | null }
  | { kind: 'principles'; at: string; manifest: ManifestBody; replaces: string | null };

/** A signed seal file at its path, and the head it makes. */
export async function makeSeal(signer: Signer, req: SealRequest, pos: { seq: number; prev: string | null }): Promise<{ path: string; text: string; head: Head }> {
  const base = { v: 1 as const, at: req.at, key: signer.keyId, seq: pos.seq, prev: pos.prev };
  let payload: SealPayload;
  if (req.kind === 'clear') payload = { ...base, kind: 'clear', stem: req.stem, filed_as: req.filed_as } satisfies ClearSealPayload;
  else if (req.kind === 'source') {
    if ((req.basis === 'attest') !== (req.since !== undefined)) throw new Error('a source seal carries `since` exactly when its basis is attest');
    payload = { ...base, kind: 'source', slug: req.slug, basis: req.basis, ...(req.since === undefined ? {} : { since: req.since }), ...req.content, replaces: req.replaces } satisfies SourceSealPayload;
  } else if (req.kind === 'principles') payload = { ...base, kind: 'principles', sets: req.manifest.sets, reserve: req.manifest.reserve, replaces: req.replaces } satisfies PrinciplesSealPayload;
  else payload = { ...base, kind: req.kind, stem: req.stem, body: req.content.body, ...(req.content.note === undefined ? {} : { note: req.content.note }), attachment: req.content.attachment } satisfies ContentSealPayload;
  const sig = await signer.sign(signedBytes('seal', payload));
  return { path: sealPath(signer.keyId, pos.seq), text: signedFile(payload, sig), head: { seq: pos.seq, digest: await sealDigest(payload) } };
}

const isSealFile = (path: string) => path.startsWith(SEALS_DIR);

/** Seal files decrypted with the brain key (schema §11.3); every other file unchanged. */
export async function decryptSealFiles(key: CryptoKey, gnomon: ReadonlyMap<string, string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const [path, text] of gnomon) out.set(path, isSealFile(path) && isEncryptedBody(text) ? await decryptBody(key, path, text) : text);
  return out;
}

/** The writes that store every plaintext seal file as ciphertext, for the encryption plans (spec §6.4). */
export async function encryptSealFiles(key: CryptoKey, gnomon: ReadonlyMap<string, string>): Promise<Array<{ path: string; text: string }>> {
  const out: Array<{ path: string; text: string }> = [];
  for (const [path, text] of gnomon) if (isSealFile(path) && !isEncryptedBody(text)) out.push({ path, text: await encryptBody(key, path, text) });
  return out;
}
