// buildSnapshot: the parsed file map at a known commit (spec §4, §5). Pure;
// the storage driver supplies the tree and the texts, this turns them into
// a BrainSnapshot. Files that fail to parse are reported in `issues` and
// left out, so a brain with one broken file still loads.

import type { Attachment, BrainFile, BrainSnapshot, FileType, Frontmatter, PrincipleFm, ReadResult, SetFm, TreeEntry } from './types';
import { type Issue, refusal } from './issues';
import { isExemptPath, isFrontmatterPath, pathInfo } from './paths';
import { tryParseFile } from './parse';

export interface SnapshotInput {
  /** commit SHA */
  head: string;
  /** every blob at `head` */
  tree: TreeEntry[];
  /** text of every frontmatter-bearing path in `tree`, as `readMany` returns it */
  texts: Map<string, ReadResult>;
  /** default for files whose read result carries no `encrypted` flag */
  encrypted?: boolean;
}

const byPath = <T extends { path: string }>(a: T, b: T) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const byOrder = <T extends { fm: { order: number }; path: string }>(a: T, b: T) => a.fm.order - b.fm.order || byPath(a, b);

export function buildSnapshot(input: SnapshotInput): BrainSnapshot {
  const files = new Map<string, BrainFile>();
  const attachments = new Map<string, Attachment>();
  const issues: Issue[] = [];

  for (const entry of [...input.tree].sort(byPath)) {
    if (isFrontmatterPath(entry.path)) {
      const got = input.texts.get(entry.path);
      if (!got) {
        issues.push(refusal(entry.path, 'file.unreadable', 'listed in the tree but its text was not read'));
        continue;
      }
      const encrypted = got.encrypted ?? input.encrypted;
      const opts = encrypted === undefined ? { sha: got.sha } : { sha: got.sha, encrypted };
      const result = tryParseFile(entry.path, got.text, opts);
      if (result.ok) files.set(entry.path, result.file);
      else issues.push(...result.issues);
    } else if (!entry.path.endsWith('.md') && !isExemptPath(entry.path)) {
      attachments.set(entry.path, { path: entry.path, sha: entry.sha, size: entry.size });
    }
  }

  const typed = new Map<FileType, BrainFile[]>();
  for (const f of files.values()) {
    const list = typed.get(f.fm.type) ?? [];
    list.push(f);
    typed.set(f.fm.type, list);
  }

  const sets = ((typed.get('principle-set') ?? []) as BrainFile<SetFm>[]).sort(byOrder);

  const principlesBySet = new Map<string, BrainFile<PrincipleFm>[]>();
  for (const f of (typed.get('principle') ?? []) as BrainFile<PrincipleFm>[]) {
    const slug = pathInfo(f.path)!.folder!;
    const list = principlesBySet.get(slug) ?? [];
    list.push(f);
    principlesBySet.set(slug, list);
  }
  for (const list of principlesBySet.values()) list.sort(byOrder);

  return {
    head: input.head,
    files,
    attachments,
    issues,
    sets,
    principlesOf: (setSlug) => principlesBySet.get(setSlug) ?? [],
    byType: <T extends FileType>(t: T) =>
      (typed.get(t) ?? []) as BrainFile<Extract<Frontmatter, { type: T }>>[],
  };
}
