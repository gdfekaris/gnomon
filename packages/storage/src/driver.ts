// StorageDriver interface, verbatim from the technical spec §6.1.

import type { CommitBatch, FileWrite, ReadResult, TreeEntry } from '@gnomon/core';
export type { CommitBatch, FileWrite, ReadResult, TreeEntry };
export interface CommitInfo { sha: string; message: string; date: string; parents: string[]; }
export interface FileChange { path: string; status: 'added' | 'modified' | 'removed'; patch?: string; }

export interface StorageDriver {
  /** current commit SHA of main */
  head(): Promise<string>;
  /** full recursive tree at head */
  list(): Promise<TreeEntry[]>;
  /** batched text reads (GraphQL on GitHub) */
  readMany(paths: string[]): Promise<Map<string, ReadResult>>;
  /** one attachment */
  readBytes(path: string): Promise<{ bytes: Uint8Array; sha: string }>;
  /** atomic multi-file commit */
  commit(batch: CommitBatch): Promise<{ sha: string }>;
  history(opts: { limit: number; path?: string }): Promise<CommitInfo[]>;
  compare(base: string, head: string): Promise<FileChange[]>;
  revert(commitSha: string, message: string): Promise<{ sha: string }>;
  createRepo?(opts: { name: string; private: true }): Promise<{ fullName: string; head: string }>;
}
