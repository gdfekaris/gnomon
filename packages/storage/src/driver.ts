// StorageDriver interface, from the technical spec §6.1.

import type { CommitBatch, CommitInfo, FileChange, FileWrite, ReadResult, TreeEntry } from '@gnomon/core';
export type { CommitBatch, CommitInfo, FileChange, FileWrite, ReadResult, TreeEntry };

export interface StorageDriver {
  /** current commit SHA of main */
  head(): Promise<string>;
  /** full recursive tree at head */
  list(): Promise<TreeEntry[]>;
  /** optional: the head and its tree read together, so a snapshot load asks for the head once (spec §6.1) */
  listAt?(): Promise<{ head: string; tree: TreeEntry[] }>;
  /** batched text reads (GraphQL on GitHub) */
  readMany(paths: string[]): Promise<Map<string, ReadResult>>;
  /** optional: text files as they stood at an earlier commit, for repair from history (spec §6.5); a path that commit lacks is absent */
  readManyAt?(commit: string, paths: string[]): Promise<Map<string, ReadResult>>;
  /** one attachment */
  readBytes(path: string): Promise<{ bytes: Uint8Array; sha: string }>;
  /** atomic multi-file commit */
  commit(batch: CommitBatch): Promise<{ sha: string }>;
  history(opts: { limit: number; path?: string }): Promise<CommitInfo[]>;
  compare(base: string, head: string): Promise<FileChange[]>;
  revert(commitSha: string, message: string): Promise<{ sha: string }>;
  createRepo?(opts: { name: string; private: true }): Promise<{ fullName: string; head: string }>;
}
