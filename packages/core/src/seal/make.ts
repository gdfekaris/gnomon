// Making seals — schema §11.5, §11.7. A seal is made at commit time: its seq
// follows the greater of the device's stored head and the highest seal of its
// key in the tree, so a crash between commit and store cannot fork a chain.
import { decryptBody, encryptBody, isEncryptedBody } from '../crypto/body';
import { bodyBytes, digest, signedBytes, utf8 } from './encoding';
import type { Signer } from './keys';
import { type ContentSealPayload, type ClearSealPayload, SEALS_DIR, type SealAttachment, type SealPayload, checkSealPayload, parseSealPath, parseSigned, sealPath, signedFile } from './records';

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

export type SealRequest =
  | { kind: 'capture' | 'attest'; stem: string; at: string; content: SealContent }
  | { kind: 'clear'; stem: string; at: string; filed_as: string | null };

/** A signed seal file at its path, and the head it makes. */
export async function makeSeal(signer: Signer, req: SealRequest, pos: { seq: number; prev: string | null }): Promise<{ path: string; text: string; head: Head }> {
  const base = { v: 1 as const, stem: req.stem, at: req.at, key: signer.keyId, seq: pos.seq, prev: pos.prev };
  const payload: SealPayload =
    req.kind === 'clear'
      ? ({ ...base, kind: 'clear', filed_as: req.filed_as } satisfies ClearSealPayload)
      : ({ ...base, kind: req.kind, body: req.content.body, ...(req.content.note === undefined ? {} : { note: req.content.note }), attachment: req.content.attachment } satisfies ContentSealPayload);
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
