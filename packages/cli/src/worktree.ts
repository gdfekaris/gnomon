// WorkingTreeDriver — spec §13. Reads and writes a brain on the local
// filesystem and makes no commits: the agent or the user commits. When the
// tree is a git checkout, the file list honours .gitignore and the head is
// the HEAD commit; otherwise every file is listed and the head is 'worktree'.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { CommitBatch, ReadResult, TreeEntry } from '@gnomon/core';
import { HeadMovedError, NotFoundError, StorageError, type CommitInfo, type FileChange, type StorageDriver } from '@gnomon/storage';

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export class WorkingTreeDriver implements StorageDriver {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  /** Run git in the tree; undefined when git is unavailable or the tree is not a repository. */
  git(args: string[]): string | undefined {
    if (!existsSync(join(this.root, '.git'))) return undefined;
    try {
      return execFileSync('git', args, { cwd: this.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return undefined;
    }
  }

  get isGit(): boolean {
    return this.git(['rev-parse', '--git-dir']) !== undefined;
  }

  async head(): Promise<string> {
    return this.git(['rev-parse', 'HEAD'])?.trim() ?? 'worktree';
  }

  private paths(): string[] {
    const listed = this.git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
    if (listed !== undefined) return listed.split('\0').filter((p) => p !== '' && existsSync(join(this.root, p))).sort(cmp);
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === '.git' || name === 'node_modules') continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else out.push(relative(this.root, full).split('\\').join('/'));
      }
    };
    walk(this.root);
    return out.sort(cmp);
  }

  async list(): Promise<TreeEntry[]> {
    return this.paths().map((path) => ({ path, sha: '', size: statSync(join(this.root, path)).size }));
  }

  async readMany(paths: string[]): Promise<Map<string, ReadResult>> {
    const out = new Map<string, ReadResult>();
    for (const path of paths) {
      const full = join(this.root, path);
      if (existsSync(full) && statSync(full).isFile()) out.set(path, { text: readFileSync(full, 'utf8'), sha: '' });
    }
    return out;
  }

  async readBytes(path: string): Promise<{ bytes: Uint8Array; sha: string }> {
    const full = join(this.root, path);
    if (!existsSync(full)) throw new NotFoundError(path);
    return { bytes: new Uint8Array(readFileSync(full)), sha: '' };
  }

  /** Writes files in place. No commit is made; the head does not move. */
  async commit(batch: CommitBatch): Promise<{ sha: string }> {
    const head = await this.head();
    if (batch.expectedHead !== head) throw new HeadMovedError(batch.expectedHead, head);
    for (const path of batch.deletes) rmSync(join(this.root, path), { force: true });
    for (const w of batch.writes) {
      const full = join(this.root, w.path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, 'text' in w ? w.text : w.bytes);
    }
    return { sha: head };
  }

  /** The committed text of a tracked path, or undefined when untracked or not a git checkout. */
  committedText(path: string): string | undefined {
    return this.git(['show', `HEAD:${path}`]);
  }

  /** Tracked paths whose working-tree content differs from HEAD (modified or deleted). */
  modifiedSinceHead(): string[] {
    const out = this.git(['diff', '--name-only', '-z', 'HEAD', '--']);
    return out === undefined ? [] : out.split('\0').filter(Boolean).sort(cmp);
  }

  /** Paths with uncommitted changes of any kind, as `git status --porcelain` reports them. */
  uncommitted(): string[] {
    const out = this.git(['status', '--porcelain', '-z']);
    return out === undefined ? [] : out.split('\0').filter(Boolean).map((l) => l.slice(3));
  }

  async history(): Promise<CommitInfo[]> {
    throw new StorageError('history is not available on a working tree');
  }
  async compare(): Promise<FileChange[]> {
    throw new StorageError('compare is not available on a working tree');
  }
  async revert(): Promise<{ sha: string }> {
    throw new StorageError('revert is not available on a working tree; use git revert');
  }
}
