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

export type FilingState = 'pending' | 'ratified' | 'rejected' | 'changed';

/** Where a filing stands at the snapshot: awaiting review, ratified, reverted, or edited since (the curator made it human). */
export function filingState(snapshot: BrainSnapshot, changes: FileChange[]): FilingState {
  const slug = filingSlug(changes);
  if (!slug) return 'changed';
  const raw = snapshot.files.get(`sources/${slug}/raw.md`);
  if (!raw) return 'rejected';
  if (raw.fm.type !== 'source') return 'changed';
  if (raw.fm.curated === 'agent-proposed') return 'pending';
  if (raw.fm.curated === 'ratified') return 'ratified';
  return 'changed';
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
 * and `updated` only. Proposals and the capture stay as the filing wrote
 * them. Refuses a non-filing and a filing already ratified or changed.
 */
export function buildRatify(snapshot: BrainSnapshot, changes: FileChange[], now: string): CommitBatch {
  const slug = filingSlug(changes);
  if (!slug) throw new Error('not a filing: no added raw.md');
  const writes: FileWrite[] = [];
  for (const c of changes) {
    if (c.status !== 'added') continue;
    const f = snapshot.files.get(c.path);
    if (!f || (f.fm.type !== 'source' && f.fm.type !== 'notes')) continue;
    if (f.fm.curated !== 'agent-proposed') throw new Error(`${c.path} is ${f.fm.curated}, not agent-proposed; this filing was already ratified or edited`);
    const fm = { ...(f.fm as SourceFm | NotesFm), curated: 'ratified' as const, updated: now };
    writes.push({ path: f.path, text: serializeFile({ ...f, fm }) });
  }
  if (!writes.some((w) => w.path === `sources/${slug}/raw.md`)) throw new Error(`sources/${slug}/raw.md is no longer in the brain; this filing was rejected`);
  return withIndexWrites(snapshot, { message: `Ratify: ${slug}`, expectedHead: snapshot.head, writes, deletes: [] });
}
