// CachingDriver — spec §6.6. A local copy of the brain's stored text under
// any driver: the tree at the last head it saw, and every text blob by its
// git id. It sits directly over the plain driver, below the encrypting
// wrapper, so what it keeps is what the git host keeps: ciphertext on an
// encrypted brain. A blob id names its bytes, so a cached blob is never
// stale; only the head and the tree are ever asked for again.
//
// `copyOnly` is the same brain read from the copy alone, never the host: how
// the app opens with no network and reloads after its own commit without a
// round trip. Its writes, history, and attachments still go to the host.

import type { CommitBatch, ReadResult, TreeEntry } from '@gnomon/core';
import type { CommitInfo, FileChange, StorageDriver } from './driver';
import { NetworkError } from './errors';
import { gitBlobSha } from './memory';

/** A small async key-value store: IndexedDB in the app, a Map in tests. */
export interface CopyStore {
  get(key: string): Promise<unknown>;
  getMany(keys: string[]): Promise<unknown[]>;
  setMany(entries: Array<[string, unknown]>): Promise<void>;
  delMany(keys: string[]): Promise<void>;
  keys(): Promise<string[]>;
}

export function memoryCopyStore(): CopyStore {
  const m = new Map<string, unknown>();
  return {
    get: async (k) => m.get(k),
    getMany: async (ks) => ks.map((k) => m.get(k)),
    setMany: async (es) => void es.forEach(([k, v]) => m.set(k, v)),
    delMany: async (ks) => void ks.forEach((k) => m.delete(k)),
    keys: async () => [...m.keys()],
  };
}

interface Meta { head: string; tree: TreeEntry[] }

/** `list` answers from the last listing for this long, so the readers that follow a load ask the host nothing more. */
export const LISTING_FRESH_MS = 3000;

const enc = new TextEncoder();

export class NotInCopyError extends NetworkError {
  override name = 'NotInCopyError';
}

export class CachingDriver implements StorageDriver {
  private meta: Meta | null | undefined;
  /** when the tree was last read from the host or advanced by an own commit; null when it has not been, or no longer holds */
  private freshAt: number | null = null;
  private readonly compares = new Map<string, FileChange[]>();

  /** `id` names the brain in the store, so two brains never share a key. */
  constructor(private readonly inner: StorageDriver, private readonly store: CopyStore, private readonly id: string, private readonly now: () => number = Date.now) {}

  private key(kind: 'meta' | 'b' | 'c', rest = ''): string {
    return `${this.id}|${kind}|${rest}`;
  }

  private async loadMeta(): Promise<Meta | null> {
    if (this.meta === undefined) this.meta = ((await this.store.get(this.key('meta'))) as Meta | undefined) ?? null;
    return this.meta;
  }

  private async saveMeta(meta: Meta): Promise<void> {
    this.meta = meta;
    this.freshAt = this.now();
    await this.store.setMany([[this.key('meta'), meta]]);
  }

  /** Whether a copy exists to open from. */
  async hasCopy(): Promise<boolean> {
    return (await this.loadMeta()) !== null;
  }

  /** The head of the copy, or null when there is none. */
  async copyHead(): Promise<string | null> {
    return (await this.loadMeta())?.head ?? null;
  }

  /** This brain read from the copy alone; a read the copy cannot answer is a NotInCopyError. */
  readonly copyOnly: StorageDriver = {
    head: async () => (await this.fromCopy()).head,
    list: async () => (await this.fromCopy()).tree,
    listAt: () => this.fromCopy(),
    readMany: (paths) => this.read(paths, true),
    readBytes: (path) => this.readBytes(path),
    commit: (batch) => this.commit(batch),
    history: (opts) => this.history(opts),
    compare: (base, head) => this.compare(base, head),
    revert: (sha, message) => this.revert(sha, message),
  };

  /** Drop this brain's copy from the store. */
  async forget(): Promise<void> {
    const prefix = `${this.id}|`;
    await this.store.delMany((await this.store.keys()).filter((k) => k.startsWith(prefix)));
    this.meta = null;
    this.freshAt = null;
    this.compares.clear();
  }

  /** Drop blobs the current tree no longer names. Run once in a while; the copy is correct without it. */
  async prune(): Promise<number> {
    const meta = await this.loadMeta();
    if (!meta) return 0;
    const prefix = this.key('b');
    const live = new Set(meta.tree.map((e) => prefix + e.sha));
    const dead = (await this.store.keys()).filter((k) => k.startsWith(prefix) && !live.has(k));
    if (dead.length) await this.store.delMany(dead);
    return dead.length;
  }

  // ---------------------------------------------------------------- reads

  head(): Promise<string> {
    return this.inner.head();
  }

  private async fromCopy(): Promise<Meta> {
    const meta = await this.loadMeta();
    if (!meta) throw new NotInCopyError('there is no local copy of this brain yet');
    return meta;
  }

  /** Always asks the host: this is what a load or a refresh calls, and a refresh must never be answered from memory. */
  async listAt(): Promise<{ head: string; tree: TreeEntry[] }> {
    const listed = this.inner.listAt ? await this.inner.listAt() : { head: await this.inner.head(), tree: await this.inner.list() };
    await this.saveMeta(listed);
    return listed;
  }

  /**
   * The tree alone, for the readers that follow a load (the encryption config,
   * the sealing files): answered from the listing just made when there is
   * one, so they read the same tree the snapshot was built from and ask the
   * host nothing more.
   */
  async list(): Promise<TreeEntry[]> {
    if (this.meta && this.freshAt !== null && this.now() - this.freshAt < LISTING_FRESH_MS) return this.meta.tree;
    return (await this.listAt()).tree;
  }

  readMany(paths: string[]): Promise<Map<string, ReadResult>> {
    return this.read(paths, false);
  }

  private async read(paths: string[], offline: boolean): Promise<Map<string, ReadResult>> {
    const out = new Map<string, ReadResult>();
    if (paths.length === 0) return out;
    // A copy not checked against the host since it was opened or invalidated is checked first: its tree may be behind.
    const meta = offline ? await this.fromCopy() : this.meta && this.freshAt !== null ? this.meta : await this.listAt();
    const shaOf = new Map(meta.tree.map((e) => [e.path, e.sha]));
    const known = paths.filter((p) => shaOf.has(p));
    const texts = await this.store.getMany(known.map((p) => this.key('b', shaOf.get(p)!)));
    const missing: string[] = [];
    known.forEach((p, i) => {
      const text = texts[i];
      if (typeof text === 'string') out.set(p, { text, sha: shaOf.get(p)! });
      else missing.push(p);
    });
    // A path the copy's tree does not name may still exist at the host's head when the copy is behind; ask.
    const unknown = paths.filter((p) => !shaOf.has(p));
    if (offline) {
      if (missing.length) throw new NotInCopyError(`the local copy does not hold ${missing[0]}`);
      return out;
    }
    const ask = [...missing, ...unknown];
    if (ask.length === 0) return out;
    const got = await this.inner.readMany(ask);
    const put: Array<[string, unknown]> = [];
    for (const [p, r] of got) {
      out.set(p, r);
      put.push([this.key('b', r.sha), r.text]);
    }
    if (put.length) await this.store.setMany(put);
    return out;
  }

  readBytes(path: string): Promise<{ bytes: Uint8Array; sha: string }> {
    return this.inner.readBytes(path);
  }

  history(opts: { limit: number; path?: string }): Promise<CommitInfo[]> {
    return this.inner.history(opts);
  }

  /** The changes between two commits never change, so each pair is asked for once and kept. */
  async compare(base: string, head: string): Promise<FileChange[]> {
    const pair = `${base}...${head}`;
    const held = this.compares.get(pair) ?? ((await this.store.get(this.key('c', pair))) as FileChange[] | undefined);
    if (held) {
      this.compares.set(pair, held);
      return held;
    }
    const changes = await this.inner.compare(base, head);
    this.compares.set(pair, changes);
    await this.store.setMany([[this.key('c', pair), changes]]);
    return changes;
  }

  // ---------------------------------------------------------------- writes

  /** Commit through the inner driver, then bring the copy to the new head from the batch itself: blob ids are computed, not fetched. */
  async commit(batch: CommitBatch): Promise<{ sha: string }> {
    let result: { sha: string };
    try {
      result = await this.inner.commit(batch);
    } catch (e) {
      // A refused commit (a moved head above all) means the listing held here may be behind.
      this.freshAt = null;
      throw e;
    }
    const meta = await this.loadMeta();
    if (!meta || meta.head !== batch.expectedHead) {
      // The copy was not at the commit's parent, so its tree cannot be advanced; the next listing asks the host.
      this.freshAt = null;
      return result;
    }
    const tree = new Map(meta.tree.map((e) => [e.path, e]));
    const put: Array<[string, unknown]> = [];
    for (const w of batch.writes) {
      const bytes = 'text' in w ? enc.encode(w.text) : w.bytes;
      const sha = await gitBlobSha(bytes);
      tree.set(w.path, { path: w.path, sha, size: bytes.length });
      if ('text' in w) put.push([this.key('b', sha), w.text]);
    }
    for (const path of batch.deletes) tree.delete(path);
    if (put.length) await this.store.setMany(put);
    await this.saveMeta({ head: result.sha, tree: [...tree.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) });
    return result;
  }

  async revert(commitSha: string, message: string): Promise<{ sha: string }> {
    const result = await this.inner.revert(commitSha, message);
    // What a revert restores is the host's to say; the next listing asks.
    this.freshAt = null;
    return result;
  }

  async createRepo(opts: { name: string; private: true }): Promise<{ fullName: string; head: string }> {
    if (!this.inner.createRepo) throw new Error('inner driver cannot create repositories');
    return this.inner.createRepo(opts);
  }
}
