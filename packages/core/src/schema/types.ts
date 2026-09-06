// Core types, verbatim from the technical spec §5 and the schema §4.

import type { Issue } from './issues';

export type CurationState = 'human' | 'agent-proposed' | 'ratified';
export type FileType = 'source' | 'notes' | 'principle' | 'principle-set' | 'inbox' | 'proposal' | 'index';

interface Common {
  type: FileType;
  curated: CurationState;
  created: string;
  updated: string;
  tags?: string[];
}

export interface SourceFm extends Common {
  type: 'source';
  title: string;
  author: string;
  work?: string;
  year?: number;
  locator?: string;
  origin?: string;
  inbox_ref?: string;
  attachment?: string;
}
export interface NotesFm extends Common { type: 'notes'; source: string; }
export interface SetFm extends Common { type: 'principle-set'; order: number; name?: string; curated: 'human'; }
export interface PrincipleFm extends Common {
  type: 'principle';
  title: string;
  set: string;
  order: number;
  grounds: string[];
  related?: string[];
  curated: 'human';
}
export interface InboxFm extends Common {
  type: 'inbox';
  note?: string;
  attachment?: string;
  status: 'unfiled' | 'filed';
  filed_as?: string;
  curated: 'human';
}
export interface ProposalFm extends Common {
  type: 'proposal';
  kind: 'principle' | 'link' | 'tag' | 'amendment';
  title: string;
  target_set?: string;
  target?: string;
  from_source?: string;
  grounds?: string[];
  status: 'open' | 'accepted' | 'declined';
  curated: 'human' | 'agent-proposed';
}
/** Index files carry `type` and nothing else (schema §4.8). */
export interface IndexFm { type: 'index'; }

export type Frontmatter = SourceFm | NotesFm | SetFm | PrincipleFm | InboxFm | ProposalFm | IndexFm;

export interface BrainFile<F extends Frontmatter = Frontmatter> {
  /** repo-relative, e.g. "principles/ps-7k2m/courage.md" */
  path: string;
  /** blob SHA at the snapshot commit */
  sha: string;
  fm: F;
  /** markdown body, decrypted if applicable */
  body: string;
  /** body was stored as ciphertext */
  encrypted: boolean;
}

/** One text read, as `StorageDriver.readMany` returns it (spec §6.1). `encrypted` is set by the encrypting driver. */
export interface ReadResult { text: string; sha: string; encrypted?: boolean; }

/** One blob in the repository tree at a commit (spec §6.1). Directories are not listed. */
export interface TreeEntry { path: string; sha: string; size: number; }

/** An attached file; bytes are fetched on demand (spec §5, §6.1). */
export interface Attachment { path: string; sha: string; size: number; }

export interface BrainSnapshot {
  head: string;
  /** every frontmatter-bearing .md file that parsed; see `issues` for the rest */
  files: Map<string, BrainFile>;
  /** every non-markdown, non-dot file in the tree; validation decides whether it belongs */
  attachments: Map<string, Attachment>;
  /**
   * Refusals from files that failed to parse and are therefore absent from
   * `files`. An extension to spec §5 so a snapshot can say why it is
   * incomplete; cross-file rules are validateSnapshot's job.
   */
  issues: Issue[];
  /** sorted by order */
  sets: BrainFile<SetFm>[];
  /** sorted by order */
  principlesOf: (setSlug: string) => BrainFile<PrincipleFm>[];
  byType: <T extends FileType>(t: T) => BrainFile<Extract<Frontmatter, { type: T }>>[];
}

/** One file in a commit: text for markdown, bytes for attachments (spec §6.1). */
export type FileWrite = { path: string; text: string } | { path: string; bytes: Uint8Array };

/** An atomic multi-file commit against a known head (spec §6.1). */
export interface CommitBatch {
  message: string;
  /** optimistic concurrency; the driver fails with HeadMovedError if stale */
  expectedHead: string;
  writes: FileWrite[];
  deletes: string[];
}
