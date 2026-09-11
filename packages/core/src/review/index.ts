// review — spec §9, schema §5, §7.7. Recognise a filing commit from history
// and compare output, build the one-commit ratification, and describe what
// a filing introduced for the review view. Rejection is a driver revert.

import type { BrainFile, BrainSnapshot, CommitBatch, CommitInfo, FileChange, FileWrite, NotesFm, SourceFm } from '../schema/types';
import { serializeFile } from '../schema/serialize';
import { withIndexWrites } from '../index/index';

/** The source slug a filing introduced, from its added raw.md; undefined when the changes are not a filing. */
export function filingSlug(changes: FileChange[]): string | undefined {
  const raw = changes.find((c) => c.status === 'added' && /^sources\/[^/]+\/raw\.md$/.test(c.path));
  return raw?.path.split('/')[1];
}

/** Spec §9: message prefix `File: ` and at least one added raw.md. */
export function isFilingCommit(info: CommitInfo, changes: FileChange[]): boolean {
  return info.message.startsWith('File: ') && filingSlug(changes) !== undefined;
}

export const rejectMessage = (slug: string): string => `Reject: ${slug}`;

/**
 * Where a filing stands: awaiting review while any of its source or notes
 * files is still agent-proposed; ratified once the source was approved as
 * delivered; yours once the curator edited the source, which is a stronger
 * approval than ratifying (schema §5: human outranks ratified); rejected
 * once the revert removed it.
 */
export type FilingState = 'pending' | 'ratified' | 'rejected' | 'yours';

/** The source and notes files a filing added, as they stand in the snapshot. */
function filingFiles(snapshot: BrainSnapshot, changes: FileChange[]): BrainFile<SourceFm | NotesFm>[] {
  const out: BrainFile<SourceFm | NotesFm>[] = [];
  for (const c of changes) {
    if (c.status !== 'added') continue;
    const f = snapshot.files.get(c.path);
    if (f && (f.fm.type === 'source' || f.fm.type === 'notes')) out.push(f as BrainFile<SourceFm | NotesFm>);
  }
  return out;
}

export function filingState(snapshot: BrainSnapshot, changes: FileChange[]): FilingState {
  const slug = filingSlug(changes);
  if (!slug) return 'yours';
  const raw = snapshot.files.get(`sources/${slug}/raw.md`);
  if (!raw) return 'rejected';
  if (raw.fm.type !== 'source') return 'yours';
  // Editing one file (the notes, say) makes that file human and leaves the other agent-proposed: still awaiting review for the rest.
  if (filingFiles(snapshot, changes).some((f) => f.fm.curated === 'agent-proposed')) return 'pending';
  return raw.fm.curated === 'ratified' ? 'ratified' : 'yours';
}

/** What a filing introduced, grouped for the review view (proposal §9 decision 3). */
export interface FilingReview {
  slug: string;
  /** added markdown files, rendered in full from the snapshot */
  added: BrainFile[];
  /** added attachments: name and size */
  attachments: Array<{ path: string; size: number }>;
  /** the capture's `+` lines only */
  capture: { path: string; addedLines: string[] } | null;
}

export function reviewFiling(snapshot: BrainSnapshot, changes: FileChange[]): FilingReview {
  const slug = filingSlug(changes);
  if (!slug) throw new Error('not a filing: no added raw.md');
  const added: BrainFile[] = [];
  const attachments: FilingReview['attachments'] = [];
  let capture: FilingReview['capture'] = null;
  for (const c of changes) {
    if (c.status === 'added' && c.path.endsWith('.md')) {
      const f = snapshot.files.get(c.path);
      if (f) added.push(f);
    } else if (c.status === 'added') {
      const a = snapshot.attachments.get(c.path);
      attachments.push({ path: c.path, size: a?.size ?? 0 });
    } else if (c.status === 'modified' && c.path.startsWith('inbox/')) {
      const lines = (c.patch ?? '').split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
      capture = { path: c.path, addedLines: lines };
    }
  }
  return { slug, added, attachments, capture };
}

/**
 * Spec §9 ratify: one commit that flips `curated` from agent-proposed to
 * ratified on the filing's added source and notes files, touching `curated`
 * and `updated` only. A file the curator already edited is human and is
 * left alone: editing approved it more strongly than ratifying would. So a
 * filing whose notes were edited first still ratifies its source, and one
 * whose source was edited first still ratifies its notes. Proposals and the
 * capture stay as the filing wrote them. Refuses a non-filing, a rejected
 * filing, and one with nothing left to ratify.
 */
export function buildRatify(snapshot: BrainSnapshot, changes: FileChange[], now: string): CommitBatch {
  const slug = filingSlug(changes);
  if (!slug) throw new Error('not a filing: no added raw.md');
  if (!snapshot.files.get(`sources/${slug}/raw.md`)) throw new Error(`sources/${slug}/raw.md is no longer in the brain; this filing was rejected`);
  const writes: FileWrite[] = [];
  for (const f of filingFiles(snapshot, changes)) {
    if (f.fm.curated !== 'agent-proposed') continue;
    const fm = { ...(f.fm as SourceFm | NotesFm), curated: 'ratified' as const, updated: now };
    writes.push({ path: f.path, text: serializeFile({ ...f, fm }) });
  }
  if (writes.length === 0) throw new Error(`sources/${slug} has nothing left to ratify; this filing was already ratified or edited`);
  return withIndexWrites(snapshot, { message: `Ratify: ${slug}`, expectedHead: snapshot.head, writes, deletes: [] });
}
