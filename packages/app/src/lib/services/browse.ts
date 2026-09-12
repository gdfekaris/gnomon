// Browse at scale (tracker, UX block 2026-09-12): the pure parts of the
// Browse screen. Search over frontmatter only (title, author, work, tags,
// slug, year), tag counts and a top few, shelves by author then work, month
// landmarks, and paging. Framework-free so vitest covers it.
import { type BrainFile, type SourceFm, cmpCodepoint } from '@gnomon/core';

export type Source = BrainFile<SourceFm>;
export type Sort = 'newest' | 'oldest' | 'author';
export const PAGE = 50;
export const TOP_TAGS = 12;

/** Lowercase, diacritics stripped, whitespace collapsed: `Émile` and `emile` are the same word. */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
export const terms = (q: string): string[] => normalize(q).split(' ').filter(Boolean);
export const slugOf = (path: string): string => path.split('/')[1] ?? '';

/** Every term must be a substring of the title, author, work, a tag, or the slug; an all-digit term may equal the year. */
export function matches(f: Source, ts: string[]): boolean {
  if (ts.length === 0) return true;
  const hay = [f.fm.title, f.fm.author, f.fm.work ?? '', ...(f.fm.tags ?? []), slugOf(f.path)].map(normalize);
  const year = f.fm.year === undefined ? null : String(f.fm.year);
  return ts.every((t) => hay.some((h) => h.includes(t)) || (year !== null && /^\d+$/.test(t) && t === year));
}

export interface BrowseFilter { q: string; tags: string[] }
export const filterActive = (f: BrowseFilter): boolean => terms(f.q).length > 0 || f.tags.length > 0;

/** The search and the tag filter together; selected tags combine with AND. */
export function filterSources(list: Source[], filter: BrowseFilter): Source[] {
  const ts = terms(filter.q);
  return list.filter((f) => matches(f, ts) && filter.tags.every((t) => (f.fm.tags ?? []).includes(t)));
}

/** Sources per tag over the whole list, alphabetical by tag. */
export function tagCounts(list: Source[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of list) for (const t of new Set(f.fm.tags ?? [])) counts.set(t, (counts.get(t) ?? 0) + 1);
  return new Map([...counts].sort(([a], [b]) => cmpCodepoint(a, b)));
}

/** The `n` most-used tags (ties alphabetical) plus every selected one, most-used first. */
export function topTags(counts: Map<string, number>, selected: string[], n = TOP_TAGS): string[] {
  const byUse = [...counts].sort(([a, ca], [b, cb]) => cb - ca || cmpCodepoint(a, b));
  const top = byUse.slice(0, n).map(([t]) => t);
  for (const t of selected) if (counts.has(t) && !top.includes(t)) top.push(t);
  return top.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || cmpCodepoint(a, b));
}

const byAuthorWorkTitle = (a: Source, b: Source) =>
  cmpCodepoint(a.fm.author, b.fm.author) || cmpCodepoint(a.fm.work ?? '', b.fm.work ?? '') || cmpCodepoint(a.fm.title, b.fm.title) || cmpCodepoint(a.path, b.path);
const byDate = (a: Source, b: Source) => cmpCodepoint(a.fm.created, b.fm.created) || cmpCodepoint(a.path, b.path);

export function sortSources(list: Source[], sort: Sort): Source[] {
  const out = [...list];
  if (sort === 'author') return out.sort(byAuthorWorkTitle);
  out.sort(byDate);
  return sort === 'newest' ? out.reverse() : out;
}

/** "Meditations (180)", "Why I Write (1976)", "1951", or "" — the work and year as the detail line shows them. */
export const workLabel = (fm: SourceFm): string => (fm.work ? `${fm.work}${fm.year ? ` (${fm.year})` : ''}` : fm.year ? String(fm.year) : '');

export interface WorkGroup { work: string | null; label: string; sources: Source[] }
export interface Shelf { author: string; count: number; works: WorkGroup[] }

/** Authors in codepoint order, each with its works in codepoint order (no work first), as the index groups them. */
export function shelves(sorted: Source[]): Shelf[] {
  const out: Shelf[] = [];
  for (const f of sorted) {
    let shelf = out[out.length - 1];
    if (!shelf || shelf.author !== f.fm.author) { shelf = { author: f.fm.author, count: 0, works: [] }; out.push(shelf); }
    shelf.count++;
    const work = f.fm.work ?? null;
    let group = shelf.works[shelf.works.length - 1];
    if (!group || group.work !== work) { group = { work, label: workLabel(f.fm), sources: [] }; shelf.works.push(group); }
    group.sources.push(f);
  }
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "September 2026" from an ISO datetime, by its UTC year and month; locale-independent. */
export function monthOf(created: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(created);
  if (!m) return created;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

export interface MonthGroup { month: string; sources: Source[] }
export function byMonth(sorted: Source[]): MonthGroup[] {
  const out: MonthGroup[] = [];
  for (const f of sorted) {
    const month = monthOf(f.fm.created);
    const last = out[out.length - 1];
    if (last && last.month === month) last.sources.push(f);
    else out.push({ month, sources: [f] });
  }
  return out;
}

/** What Browse renders: a heading (an author shelf, a work, or a month) and the rows under it. */
export interface Group {
  author?: { name: string; count: number; open: boolean };
  work?: { label: string; count: number };
  month?: string;
  rows: Source[];
}

export function shelfGroups(sorted: Source[], isOpen: (author: string) => boolean): Group[] {
  const out: Group[] = [];
  for (const shelf of shelves(sorted)) {
    const open = isOpen(shelf.author);
    const single = shelf.count === 1;
    let first = true;
    for (const w of shelf.works) {
      const g: Group = { rows: open ? w.sources : [] };
      if (first) { g.author = { name: shelf.author, count: shelf.count, open }; first = false; }
      if (open && !single && w.work !== null) g.work = { label: w.label, count: w.sources.length };
      if (g.author || g.rows.length) out.push(g);
    }
    if (first) out.push({ author: { name: shelf.author, count: shelf.count, open }, rows: [] });
  }
  return out;
}

export const monthGroups = (sorted: Source[]): Group[] => byMonth(sorted).map((m) => ({ month: m.month, rows: m.sources }));

/** The first `shown` rows across the groups, headings kept; a group cut to nothing keeps its heading only if it is a shelf. */
export function pageGroups(groups: Group[], shown: number): { groups: Group[]; total: number; left: number } {
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  let budget = shown;
  const out: Group[] = [];
  for (const g of groups) {
    if (budget <= 0 && !g.author) continue;
    const rows = g.rows.slice(0, Math.max(0, budget));
    budget -= rows.length;
    if (rows.length || g.author) out.push({ ...g, rows });
  }
  return { groups: out, total, left: Math.max(0, total - shown) };
}

export const moreLabel = (left: number): string => (left > PAGE ? `Show ${PAGE} more (${left - PAGE} left)` : `Show the last ${left}`);

export const parseTags = (param: string | null): string[] => (param ?? '').split(',').map((t) => t.trim()).filter(Boolean);
export function browseHash(q: string, tags: string[]): string {
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (tags.length) params.set('tag', tags.join(','));
  const s = params.toString();
  return `#/browse${s ? `?${s}` : ''}`;
}
export const authorSlug = (author: string): string => normalize(author).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
