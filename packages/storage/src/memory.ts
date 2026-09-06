// MemoryDriver — spec §6.3. An in-memory StorageDriver with the GitHub
// driver's semantics: expectedHead checks, atomic multi-file commits,
// git-compatible blob SHAs, history, compare, and revert with conflict
// detection. Used by unit tests, the driver contract suite, and the in-app
// demo brain.

import type { CommitBatch, ReadResult, TreeEntry } from '@gnomon/core';
import type { CommitInfo, FileChange, StorageDriver } from './driver';
import { HeadMovedError, NotFoundError, RevertConflictError, StorageError } from './errors';

interface Blob { sha: string; bytes: Uint8Array; }
interface Commit { sha: string; message: string; date: string; parents: string[]; tree: Map<string, Blob>; }

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** git's blob id: sha1("blob <size>\0<bytes>"), so memory and GitHub agree on every SHA. */
export async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const header = enc.encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(header.length + bytes.length);
  all.set(header);
  all.set(bytes, header.length);
  return hex(await crypto.subtle.digest('SHA-1', all));
}

async function treeSha(tree: Map<string, Blob>): Promise<string> {
  const lines = [...tree.keys()].sort().map((p) => `${p} ${tree.get(p)!.sha}`).join('\n');
  return hex(await crypto.subtle.digest('SHA-1', enc.encode(lines)));
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function isText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** A minimal unified-style patch: one hunk, `-` and `+` lines from an LCS line diff. Enough for the review view (spec §9). */
export function linePatch(before: string, after: string): string {
  const a = before === '' ? [] : before.replace(/\n$/, '').split('\n');
  const b = after === '' ? [] : after.replace(/\n$/, '').split('\n');
  const n = a.length, m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: string[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { out.push(` ${a[i]}`); i++; j++; }
    else if (j < m && (i >= n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) { out.push(`+${b[j]}`); j++; }
    else { out.push(`-${a[i]}`); i++; }
  }
  return `@@ -1,${n} +1,${m} @@\n${out.join('\n')}${out.length ? '\n' : ''}`;
}

export interface MemoryDriverOptions {
  /** clock for commit dates; injectable for deterministic tests */
  now?: () => string;
}

export class MemoryDriver implements StorageDriver {
  private commits: Commit[] = [];
  private readonly now: () => string;

  private constructor(opts: MemoryDriverOptions) {
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  /** A driver whose first commit holds `seed` (text or bytes per path). */
  static async create(seed: Map<string, string | Uint8Array> = new Map(), opts: MemoryDriverOptions = {}, message = 'Initial commit'): Promise<MemoryDriver> {
    const d = new MemoryDriver(opts);
    const tree = new Map<string, Blob>();
    for (const [path, content] of seed) {
      const bytes = typeof content === 'string' ? enc.encode(content) : content;
      tree.set(path, { sha: await gitBlobSha(bytes), bytes });
    }
    await d.append(tree, message, []);
    return d;
  }

  private get tip(): Commit {
    const c = this.commits[this.commits.length - 1];
    if (!c) throw new StorageError('repository has no commits');
    return c;
  }

  private commitAt(sha: string): Commit {
    const c = this.commits.find((x) => x.sha === sha);
    if (!c) throw new NotFoundError(sha);
    return c;
  }

  private async append(tree: Map<string, Blob>, message: string, parents: string[]): Promise<Commit> {
    const date = this.now();
    const body = `tree ${await treeSha(tree)}\n${parents.map((p) => `parent ${p}\n`).join('')}date ${date}\nseq ${this.commits.length}\n\n${message}`;
    const sha = hex(await crypto.subtle.digest('SHA-1', enc.encode(body)));
    const commit: Commit = { sha, message, date, parents, tree };
    this.commits.push(commit);
    return commit;
  }

  async head(): Promise<string> {
    return this.tip.sha;
  }

  async list(): Promise<TreeEntry[]> {
    return [...this.tip.tree].map(([path, b]) => ({ path, sha: b.sha, size: b.bytes.length })).sort((a, b) => cmp(a.path, b.path));
  }

  async readMany(paths: string[]): Promise<Map<string, ReadResult>> {
    const out = new Map<string, ReadResult>();
    for (const path of paths) {
      const b = this.tip.tree.get(path);
      if (b && isText(b.bytes)) out.set(path, { text: new TextDecoder().decode(b.bytes), sha: b.sha });
    }
    return out;
  }

  async readBytes(path: string): Promise<{ bytes: Uint8Array; sha: string }> {
    const b = this.tip.tree.get(path);
    if (!b) throw new NotFoundError(path);
    return { bytes: b.bytes.slice(), sha: b.sha };
  }

  async commit(batch: CommitBatch): Promise<{ sha: string }> {
    const head = this.tip;
    if (batch.expectedHead !== head.sha) throw new HeadMovedError(batch.expectedHead, head.sha);
    const tree = new Map(head.tree);
    for (const path of batch.deletes) {
      if (!tree.has(path)) throw new StorageError(`cannot delete '${path}': not in the tree`);
      tree.delete(path);
    }
    for (const w of batch.writes) {
      const bytes = 'text' in w ? enc.encode(w.text) : w.bytes.slice();
      tree.set(w.path, { sha: await gitBlobSha(bytes), bytes });
    }
    const c = await this.append(tree, batch.message, [head.sha]);
    return { sha: c.sha };
  }

  async history(opts: { limit: number; path?: string }): Promise<CommitInfo[]> {
    const out: CommitInfo[] = [];
    for (let i = this.commits.length - 1; i >= 0 && out.length < opts.limit; i--) {
      const c = this.commits[i]!;
      if (opts.path !== undefined) {
        const parent = c.parents[0] ? this.commitAt(c.parents[0]) : undefined;
        const before = parent?.tree.get(opts.path)?.sha;
        const after = c.tree.get(opts.path)?.sha;
        if (before === after) continue;
      }
      out.push({ sha: c.sha, message: c.message, date: c.date, parents: [...c.parents] });
    }
    return out;
  }

  async compare(base: string, head: string): Promise<FileChange[]> {
    const a = this.commitAt(base).tree;
    const b = this.commitAt(head).tree;
    const changes: FileChange[] = [];
    for (const path of [...new Set([...a.keys(), ...b.keys()])].sort(cmp)) {
      const x = a.get(path);
      const y = b.get(path);
      if (x && y && x.sha === y.sha) continue;
      const status: FileChange['status'] = !x ? 'added' : !y ? 'removed' : 'modified';
      const change: FileChange = { path, status };
      const textual = (x === undefined || isText(x.bytes)) && (y === undefined || isText(y.bytes));
      if (textual) change.patch = linePatch(x ? new TextDecoder().decode(x.bytes) : '', y ? new TextDecoder().decode(y.bytes) : '');
      changes.push(change);
    }
    return changes;
  }

  /** Spec §6.2: restore the parent's blob for every path the commit touched; refuse if any of them has since changed. */
  async revert(commitSha: string, message: string): Promise<{ sha: string }> {
    const target = this.commitAt(commitSha);
    if (target.parents.length !== 1) throw new StorageError(`cannot revert ${commitSha}: it has ${target.parents.length} parents`);
    const parent = this.commitAt(target.parents[0]!);
    const head = this.tip;
    const touched = [...new Set([...parent.tree.keys(), ...target.tree.keys()])].filter((p) => parent.tree.get(p)?.sha !== target.tree.get(p)?.sha).sort(cmp);
    const conflicts = touched.filter((p) => head.tree.get(p)?.sha !== target.tree.get(p)?.sha);
    if (conflicts.length) throw new RevertConflictError(conflicts);
    const tree = new Map(head.tree);
    for (const p of touched) {
      const before = parent.tree.get(p);
      if (before) tree.set(p, before);
      else tree.delete(p);
    }
    const c = await this.append(tree, message, [head.sha]);
    return { sha: c.sha };
  }

  /** Spec §6.2 shape: a fresh repository with an auto-generated README, like GitHub's auto_init. */
  async createRepo(opts: { name: string; private: true }): Promise<{ fullName: string; head: string }> {
    this.commits = [];
    const readme = enc.encode(`# ${opts.name}\n`);
    const tree = new Map<string, Blob>([['README.md', { sha: await gitBlobSha(readme), bytes: readme }]]);
    const c = await this.append(tree, 'Initial commit', []);
    return { fullName: `memory/${opts.name}`, head: c.sha };
  }
}
