// The reserve (schema §7.14; tracker "Feature block: the Reserve"): the pure
// parts of the Sets screen's reserve section and the two-commit operations.
// Reserving and placing are each a copy commit then a delete commit, since
// files never move; BrainService applies the first locally, so the second
// is built against the head the first produced. Framework-free.

import {
  type BrainFile, type BrainSnapshot, type Dangling, type PrincipleFm, type SourceFm, RESERVE_SLUG, cmpCodepoint, deletePrinciple, nowUtc,
  placePrinciple, reservePrinciple,
} from '@gnomon/core';
import type { BrainService } from './brain';
import { normalize, terms } from './browse';

export type Principle = BrainFile<PrincipleFm>;
export type ReserveSort = 'newest' | 'az';

function snap(brain: BrainService): BrainSnapshot {
  const s = brain.snapshot;
  if (!s) throw new Error('no brain is connected');
  return s;
}

export interface Moved { path: string; dangling: Dangling[]; }

/** Take a set's principle into the reserve: `Reserve principle:` then `Delete principle:`, two commits (schema §7.14). */
export async function reserve(brain: BrainService, path: string): Promise<Moved> {
  const first = reservePrinciple(snap(brain), path, nowUtc());
  await brain.commit(first.batch);
  const second = deletePrinciple(snap(brain), path, nowUtc());
  await brain.commit(second.batch);
  return { path: first.path, dangling: second.dangling };
}

/** Put a reserve principle into a set at N+1: `Place principle:` then `Delete principle:` on the reserve copy. */
export async function place(brain: BrainService, path: string, setSlug: string): Promise<Moved> {
  const first = placePrinciple(snap(brain), path, setSlug, nowUtc());
  await brain.commit(first.batch);
  const second = deletePrinciple(snap(brain), path, nowUtc());
  await brain.commit(second.batch);
  return { path: first.path, dangling: second.dangling };
}

// ---------------------------------------------------------------- search over every principle

export const principleSlug = (path: string): string => path.split('/')[2]?.replace(/\.md$/, '') ?? '';
export const inReserve = (p: Principle): boolean => p.fm.set === RESERVE_SLUG;

/** The words a principle can be found by: its title, its tags, its slug, and its grounds' titles and authors. */
export function haystack(p: Principle, s: BrainSnapshot): string[] {
  const out = [p.fm.title, principleSlug(p.path), ...(p.fm.tags ?? [])];
  for (const g of p.fm.grounds) {
    const src = s.files.get(`sources/${g}/raw.md`);
    if (src?.fm.type === 'source') out.push((src.fm as SourceFm).title, (src.fm as SourceFm).author);
  }
  return out.map(normalize);
}

/** Every term must be a substring of something in the haystack. No terms means everything matches. */
export function principleMatches(p: Principle, ts: string[], s: BrainSnapshot): boolean {
  if (ts.length === 0) return true;
  const hay = haystack(p, s);
  return ts.every((t) => hay.some((h) => h.includes(t)));
}

export interface PrincipleFilter { q: string; tags: string[] }
export const principleFilterActive = (f: PrincipleFilter): boolean => terms(f.q).length > 0 || f.tags.length > 0;

/** The search and, for the reserve, the tag chips; selected tags combine with AND. */
export function filterPrinciples(list: Principle[], filter: PrincipleFilter, s: BrainSnapshot): Principle[] {
  const ts = terms(filter.q);
  return list.filter((p) => principleMatches(p, ts, s) && filter.tags.every((t) => (p.fm.tags ?? []).includes(t)));
}

/** Newest first is the snapshot's own order (most recently reserved, by `created` then path); A–Z is by title. */
export function sortReserve(list: Principle[], sort: ReserveSort): Principle[] {
  const out = [...list];
  if (sort === 'az') out.sort((a, b) => cmpCodepoint(normalize(a.fm.title), normalize(b.fm.title)) || cmpCodepoint(a.path, b.path));
  return out;
}

/** "12 of 240 in reserve" under a filter, "240 in reserve" otherwise. */
export const reserveCount = (shown: number, total: number, filtered: boolean): string => (filtered ? `${shown} of ${total} in reserve` : `${total} in reserve`);
