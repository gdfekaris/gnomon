// Enabling, disabling, and re-keying encryption on a brain — spec §6.4
// "Enabling encryption on an existing brain", Phase 4 block 2. Each is one
// commit built from a snapshot whose bodies are readable: every eligible
// body rewritten as ciphertext (or plaintext) plus the config written (or
// removed), under the snapshot's head, so a head that moved is refused with
// nothing written. These batches carry stored bytes, so they go through
// the plain driver, never the encrypting wrapper, and the app's per-write
// rules do not apply to them.

import type { BrainSnapshot, CommitBatch, FileWrite } from '../schema/types';
import { serializeFile } from '../schema/serialize';
import { splitFrontmatter } from '../schema/parse';
import { ENCRYPTION_CONFIG_PATH, type EncryptionConfig, encryptBody, isEncryptablePath, isEncryptedBody } from './body';
import { serializeEncryptionConfig } from './passphrase';

/** Bodies that are ciphertext in this snapshot: loaded without a key, they carry the marker. */
export function encryptedBodyCount(s: BrainSnapshot): number {
  let n = 0;
  for (const f of s.files.values()) if (isEncryptedBody(f.body)) n++;
  return n;
}

function readable(s: BrainSnapshot): void {
  const n = encryptedBodyCount(s);
  if (n) throw new Error(`${n} bodies are still ciphertext: unlock the brain before enabling, disabling, or re-keying`);
}

const join = (yaml: string, body: string): string => `---\n${yaml}\n---\n${body}`;

export interface EncryptOptions {
  /** rewrite bodies that are already encrypted too, under the new key (a passphrase change) */
  rekey?: boolean;
}

/**
 * Every eligible body rewritten as ciphertext under `key`, plus
 * `.gnomon/encryption.json`, in one commit. Bodies already encrypted under
 * the current key are left alone unless `rekey`. Message `Encrypt: {n}
 * files`, or `Change passphrase` when re-keying.
 */
export async function planEncrypt(s: BrainSnapshot, key: CryptoKey, config: EncryptionConfig, opts: EncryptOptions = {}): Promise<CommitBatch> {
  readable(s);
  const writes: FileWrite[] = [];
  for (const f of s.files.values()) {
    if (!isEncryptablePath(f.path)) continue;
    if (f.encrypted && !opts.rekey) continue;
    const split = splitFrontmatter(serializeFile(f))!;
    writes.push({ path: f.path, text: join(split.yaml, await encryptBody(key, f.path, split.body)) });
  }
  writes.push({ path: ENCRYPTION_CONFIG_PATH, text: serializeEncryptionConfig(config) });
  const n = writes.length - 1;
  return { message: opts.rekey ? 'Change passphrase' : `Encrypt: ${n} file${n === 1 ? '' : 's'}`, expectedHead: s.head, writes, deletes: [] };
}

/** Every encrypted body rewritten as the plaintext the snapshot holds, and the config removed, in one commit. Message `Decrypt: {n} files`. */
export function planDecrypt(s: BrainSnapshot): CommitBatch {
  readable(s);
  const writes: FileWrite[] = [];
  for (const f of s.files.values()) {
    if (!f.encrypted) continue;
    writes.push({ path: f.path, text: serializeFile(f) });
  }
  const n = writes.length;
  return { message: `Decrypt: ${n} file${n === 1 ? '' : 's'}`, expectedHead: s.head, writes, deletes: [ENCRYPTION_CONFIG_PATH] };
}

/** A passphrase change: every eligible body under the new key and the new config, one commit. */
export const planRekey = (s: BrainSnapshot, newKey: CryptoKey, newConfig: EncryptionConfig): Promise<CommitBatch> => planEncrypt(s, newKey, newConfig, { rekey: true });
