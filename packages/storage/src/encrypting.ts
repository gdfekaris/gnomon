// EncryptingDriver — spec §6.4. Transparent to callers: reads return
// plaintext, commit stores ciphertext. Markdown bodies, and seal files whole
// (schema §11.3); frontmatter, attachments, the scaffold, templates, both
// index files, and the other sealing files stay cleartext.

import type { CommitBatch, FileWrite, ReadResult, TreeEntry } from '@gnomon/core';
import { SEALS_DIR, decryptBody, encryptBody, isEncryptablePath, isEncryptedBody, splitFrontmatter } from '@gnomon/core';
import type { CommitInfo, FileChange, StorageDriver } from './driver';
import type { Keyring } from './keyring';

function join(yaml: string, body: string): string {
  return `---\n${yaml}\n---\n${body}`;
}

export class EncryptingDriver implements StorageDriver {
  constructor(private readonly inner: StorageDriver, private readonly keyring: Keyring) {}

  head(): Promise<string> {
    return this.inner.head();
  }
  list(): Promise<TreeEntry[]> {
    return this.inner.list();
  }
  readBytes(path: string): Promise<{ bytes: Uint8Array; sha: string }> {
    return this.inner.readBytes(path);
  }
  history(opts: { limit: number; path?: string }): Promise<CommitInfo[]> {
    return this.inner.history(opts);
  }
  /** Patches describe stored bytes: an encrypted body shows as its ciphertext line. Frontmatter lines read normally. */
  compare(base: string, head: string): Promise<FileChange[]> {
    return this.inner.compare(base, head);
  }
  revert(commitSha: string, message: string): Promise<{ sha: string }> {
    return this.inner.revert(commitSha, message);
  }
  createRepo(opts: { name: string; private: true }): Promise<{ fullName: string; head: string }> {
    if (!this.inner.createRepo) throw new Error('inner driver cannot create repositories');
    return this.inner.createRepo(opts);
  }

  /** Decrypt a stored text when its body carries the marker; plaintext passes through. The key is fetched only when needed. */
  private async open(path: string, stored: ReadResult): Promise<ReadResult> {
    if (path.startsWith(SEALS_DIR)) {
      if (!isEncryptedBody(stored.text)) return { ...stored, encrypted: false };
      return { text: await decryptBody(await this.keyring.key(), path, stored.text), sha: stored.sha, encrypted: true };
    }
    const split = splitFrontmatter(stored.text);
    if (!split || !isEncryptedBody(split.body)) return { ...stored, encrypted: false };
    const body = await decryptBody(await this.keyring.key(), path, split.body);
    return { text: join(split.yaml, body), sha: stored.sha, encrypted: true };
  }

  async readMany(paths: string[]): Promise<Map<string, ReadResult>> {
    const stored = await this.inner.readMany(paths);
    const out = new Map<string, ReadResult>();
    for (const [path, r] of stored) out.set(path, await this.open(path, r));
    return out;
  }

  /** Encrypt the body of every text write on an encryptable path. A body equal to the stored plaintext keeps its ciphertext. */
  async commit(batch: CommitBatch): Promise<{ sha: string }> {
    const targets = batch.writes.filter((w): w is { path: string; text: string } => 'text' in w && isEncryptablePath(w.path));
    const seals = batch.writes.filter((w): w is { path: string; text: string } => 'text' in w && w.path.startsWith(SEALS_DIR) && !isEncryptedBody(w.text));
    if (targets.length === 0 && seals.length === 0) return this.inner.commit(batch);
    const key = await this.keyring.key();
    const stored = await this.inner.readMany(targets.map((w) => w.path));

    const sealed = new Map<string, string>();
    // A seal file is new in every commit that writes it (schema §11.2), so it is always encrypted fresh, whole.
    for (const w of seals) sealed.set(w.path, await encryptBody(key, w.path, w.text));
    for (const w of targets) {
      const split = splitFrontmatter(w.text);
      if (!split) continue; // not a frontmatter file; the write is refused downstream, store as given
      const current = stored.get(w.path);
      const currentSplit = current ? splitFrontmatter(current.text) : undefined;
      let body: string | undefined;
      if (currentSplit && isEncryptedBody(currentSplit.body)) {
        const plain = await decryptBody(key, w.path, currentSplit.body).catch(() => undefined);
        if (plain === split.body) body = currentSplit.body;
      }
      sealed.set(w.path, join(split.yaml, body ?? (await encryptBody(key, w.path, split.body))));
    }

    const writes: FileWrite[] = batch.writes.map((w) => {
      const text = sealed.get(w.path);
      return text === undefined ? w : { path: w.path, text };
    });
    return this.inner.commit({ ...batch, writes });
  }
}
