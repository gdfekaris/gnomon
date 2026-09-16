// sets — spec §7.3; schema §7.1–§7.4 (sets) and §7.9 (principles). Pure
// functions from (snapshot, params) to a CommitBatch. Files never move:
// ordering lives in `order`, labels in `name`, and a slug is forever.

import type { BrainFile, BrainSnapshot, CommitBatch, FileWrite, PrincipleFm, SetFm } from '../schema/types';
import { isSetSlug, randomAlphabet } from '../schema/identifiers';
import { RESERVE_SLUG } from '../schema/paths';
import { serializeFile } from '../schema/serialize';
import { parseLinks } from '../links/index';
import { setLabel, withIndexWrites } from '../index/index';

export interface Dangling { path: string; ref: string; }

// ---------------------------------------------------------------- helpers

const write = (file: BrainFile, prev?: BrainFile, now?: string): FileWrite => ({
  path: file.path,
  text: prev && now ? serializeFile(file, { prev, now }) : serializeFile(file),
});

function setOf(s: BrainSnapshot, slug: string): BrainFile<SetFm> {
  const set = s.sets.find((f) => f.path === `principles/${slug}/_set.md`);
  if (!set) throw new Error(`no principle set '${slug}'`);
  return set;
}

function principleAt(s: BrainSnapshot, path: string): BrainFile<PrincipleFm> {
  const f = s.files.get(path);
  if (!f || f.fm.type !== 'principle') throw new Error(`no principle at '${path}'`);
  return f as BrainFile<PrincipleFm>;
}

/** Drop undefined entries so optional fields are absent rather than present-and-undefined. */
function withoutUndefined<T>(o: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/** Bodies, `related`, and proposal targets that point into `paths`, reported for the curator (schema §7.4 step 3). */
function danglingInto(s: BrainSnapshot, targets: Set<string>, deleted: Set<string>, setSlug?: string): Dangling[] {
  const out: Dangling[] = [];
  for (const f of s.files.values()) {
    if (deleted.has(f.path) || f.fm.type === 'index') continue;
    if (f.fm.type === 'principle') {
      for (const r of f.fm.related ?? []) if (targets.has(`principles/${r}.md`)) out.push({ path: f.path, ref: r });
    }
    if (f.fm.type === 'proposal') {
      if (setSlug !== undefined && f.fm.target_set === setSlug) out.push({ path: f.path, ref: setSlug });
      if (f.fm.target !== undefined && f.fm.kind !== 'tag' && targets.has(`principles/${f.fm.target}.md`)) out.push({ path: f.path, ref: f.fm.target });
    }
    for (const link of parseLinks(f.body, f.path)) {
      if (targets.has(link.path)) out.push({ path: f.path, ref: link.path.replace(/\.md$/, '') });
    }
  }
  return out;
}

// ---------------------------------------------------------------- sets

/** A fresh `ps-xxxx` slug that collides with nothing in `existing` (schema §3.2). */
export function newSetSlug(existing: Set<string>, random?: (n: number) => Uint8Array): string {
  for (;;) {
    const slug = `ps-${randomAlphabet(4, random)}`;
    if (!existing.has(slug)) return slug;
  }
}

export interface CreateSetParams { name?: string; body?: string; now: string; slug?: string; }

/** Schema §7.1. Returns the batch and the slug it drew. */
export function createSet(s: BrainSnapshot, p: CreateSetParams): { batch: CommitBatch; slug: string } {
  const existing = new Set(s.sets.map((f) => f.path.split('/')[1]!));
  const slug = p.slug ?? newSetSlug(existing);
  if (!isSetSlug(slug) || existing.has(slug)) throw new Error(`set slug '${slug}' is malformed or taken`);
  const fm = withoutUndefined<SetFm>({ type: 'principle-set', order: s.sets.length + 1, name: p.name, curated: 'human', created: p.now, updated: p.now });
  const file: BrainFile<SetFm> = { path: `principles/${slug}/_set.md`, sha: '', fm, body: p.body ?? '', encrypted: false };
  const batch: CommitBatch = { message: `Create principle set: ${setLabel(fm)}`, expectedHead: s.head, writes: [write(file)], deletes: [] };
  return { batch: withIndexWrites(s, batch), slug };
}

export interface UpdateSetParams { name?: string | null; body?: string; now: string; }

/** Schema §7.2 (rename) and the set description editor. `name: null` removes the sub-name. */
export function updateSet(s: BrainSnapshot, slug: string, p: UpdateSetParams): CommitBatch {
  const prev = setOf(s, slug);
  const fm: SetFm = { ...prev.fm };
  if (p.name === null) delete fm.name;
  else if (p.name !== undefined) fm.name = p.name;
  const next: BrainFile<SetFm> = { ...prev, fm, body: p.body ?? prev.body };
  const batch: CommitBatch = { message: `Update principle set: ${setLabel(fm)}`, expectedHead: s.head, writes: [write(next, prev, p.now)], deletes: [] };
  return withIndexWrites(s, batch);
}

/** Schema §7.3. `orderedSlugs` is every set, in its new order; only sets whose order changed are rewritten. */
export function reorderSets(s: BrainSnapshot, orderedSlugs: string[], now: string): CommitBatch {
  const current = s.sets.map((f) => f.path.split('/')[1]!);
  if ([...orderedSlugs].sort().join() !== [...current].sort().join()) throw new Error('orderedSlugs must be a permutation of the existing sets');
  const writes: FileWrite[] = [];
  orderedSlugs.forEach((slug, i) => {
    const prev = setOf(s, slug);
    if (prev.fm.order !== i + 1) writes.push(write({ ...prev, fm: { ...prev.fm, order: i + 1 } }, prev, now));
  });
  return withIndexWrites(s, { message: 'Reorder principle sets', expectedHead: s.head, writes, deletes: [] });
}

/** Schema §7.4. Removes the folder, renumbers later sets, and reports what now dangles. The last set cannot be deleted. */
export function deleteSet(s: BrainSnapshot, slug: string, now: string): { batch: CommitBatch; dangling: Dangling[] } {
  const set = setOf(s, slug);
  if (s.sets.length === 1) throw new Error('the last remaining set cannot be deleted');
  const principles = s.principlesOf(slug);
  const deletes = [set.path, ...principles.map((f) => f.path)];
  const deleted = new Set(deletes);
  const writes: FileWrite[] = [];
  for (const other of s.sets) {
    if (other.fm.order > set.fm.order) writes.push(write({ ...other, fm: { ...other.fm, order: other.fm.order - 1 } }, other, now));
  }
  const targets = new Set(principles.map((f) => f.path));
  targets.add(set.path);
  const dangling = danglingInto(s, targets, deleted, slug);
  const batch = withIndexWrites(s, { message: `Delete principle set: ${setLabel(set.fm)}`, expectedHead: s.head, writes, deletes });
  return { batch, dangling };
}

// ---------------------------------------------------------------- principles

/** A principle slug from its title (schema §3.3): lowercase ASCII, digits, hyphens, 3–60 chars. */
export function slugify(title: string): string {
  let slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length > 60) slug = slug.slice(0, 60).replace(/-+$/, '');
  if (slug.length < 3) slug = slug ? `${slug}-principle` : 'principle';
  return slug;
}

/** `slug`, or `slug-2`, `slug-3`, … until it is free within the set. */
export function uniquePrincipleSlug(s: BrainSnapshot, setSlug: string, slug: string): string {
  const taken = new Set(s.principlesOf(setSlug).map((f) => f.path.split('/')[2]!.replace(/\.md$/, '')));
  if (!taken.has(slug)) return slug;
  for (let n = 2; ; n++) {
    const base = slug.slice(0, 60 - `-${n}`.length).replace(/-+$/, '');
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export interface CreatePrincipleParams {
  setSlug: string;
  title: string;
  body: string;
  grounds: string[];
  related?: string[];
  tags?: string[];
  now: string;
}

/** Schema §7.9 create: appended at order N+1, `curated: human`, message `Add principle: {title}`. With `setSlug: '_reserve'` the principle is written into the reserve, with no order (§7.14). */
export function createPrinciple(s: BrainSnapshot, p: CreatePrincipleParams): { batch: CommitBatch; path: string } {
  const reserve = p.setSlug === RESERVE_SLUG;
  if (!reserve) setOf(s, p.setSlug);
  const slug = uniquePrincipleSlug(s, p.setSlug, slugify(p.title));
  const path = `principles/${p.setSlug}/${slug}.md`;
  const fm = withoutUndefined<PrincipleFm>({
    type: 'principle', title: p.title, set: p.setSlug, order: reserve ? undefined : s.principlesOf(p.setSlug).length + 1,
    grounds: p.grounds, related: p.related, tags: p.tags, curated: 'human', created: p.now, updated: p.now,
  });
  const file: BrainFile<PrincipleFm> = { path, sha: '', fm, body: p.body, encrypted: false };
  const batch: CommitBatch = { message: `Add principle: ${p.title}`, expectedHead: s.head, writes: [write(file)], deletes: [] };
  return { batch: withIndexWrites(s, batch), path };
}

export interface UpdatePrincipleParams {
  title?: string;
  body?: string;
  grounds?: string[];
  related?: string[] | null;
  tags?: string[] | null;
  now: string;
}

/** The principle editor (US-6). The path, set, and order never change here; `null` removes an optional list. */
export function updatePrinciple(s: BrainSnapshot, path: string, p: UpdatePrincipleParams): CommitBatch {
  const prev = principleAt(s, path);
  const fm: PrincipleFm = { ...prev.fm };
  if (p.title !== undefined) fm.title = p.title;
  if (p.grounds !== undefined) fm.grounds = p.grounds;
  if (p.related === null) delete fm.related;
  else if (p.related !== undefined) fm.related = p.related;
  if (p.tags === null) delete fm.tags;
  else if (p.tags !== undefined) fm.tags = p.tags;
  const next: BrainFile<PrincipleFm> = { ...prev, fm, body: p.body ?? prev.body };
  const batch: CommitBatch = { message: `Edit principle: ${fm.title}`, expectedHead: s.head, writes: [write(next, prev, p.now)], deletes: [] };
  return withIndexWrites(s, batch);
}

/** Schema §7.9 reorder. `orderedSlugs` is every principle of the set in its new order; only moved files are rewritten. */
export function reorderPrinciples(s: BrainSnapshot, setSlug: string, orderedSlugs: string[], now: string): CommitBatch {
  const current = s.principlesOf(setSlug);
  const bySlug = new Map(current.map((f) => [f.path.split('/')[2]!.replace(/\.md$/, ''), f]));
  if ([...orderedSlugs].sort().join() !== [...bySlug.keys()].sort().join()) throw new Error(`orderedSlugs must be a permutation of the principles of '${setSlug}'`);
  const writes: FileWrite[] = [];
  orderedSlugs.forEach((slug, i) => {
    const prev = bySlug.get(slug)!;
    if (prev.fm.order !== i + 1) writes.push(write({ ...prev, fm: { ...prev.fm, order: i + 1 } }, prev, now));
  });
  return withIndexWrites(s, { message: `Reorder principles: ${setLabel(setOf(s, setSlug).fm)}`, expectedHead: s.head, writes, deletes: [] });
}

/** Schema §7.9 delete: removes the file, closes the gap in `order`, and reports dangling `related` refs, proposal targets, and body links. In the reserve there is no order to close. */
export function deletePrinciple(s: BrainSnapshot, path: string, now: string): { batch: CommitBatch; dangling: Dangling[] } {
  const target = principleAt(s, path);
  const writes: FileWrite[] = [];
  if (target.fm.set !== RESERVE_SLUG) {
    for (const other of s.principlesOf(target.fm.set)) {
      if (other.fm.order! > target.fm.order!) writes.push(write({ ...other, fm: { ...other.fm, order: other.fm.order! - 1 } }, other, now));
    }
  }
  const dangling = danglingInto(s, new Set([path]), new Set([path]));
  const batch = withIndexWrites(s, { message: `Delete principle: ${target.fm.title}`, expectedHead: s.head, writes, deletes: [path] });
  return { batch, dangling };
}

// ---------------------------------------------------------------- the reserve (schema §7.14)

/** The copy of `source` that lands at `path`: same title, grounds, related, tags, and body; a new file, so `created` is now. */
function copyPrinciple(source: BrainFile<PrincipleFm>, path: string, set: string, order: number | undefined, now: string): BrainFile<PrincipleFm> {
  const fm = withoutUndefined<PrincipleFm>({
    type: 'principle', title: source.fm.title, set, order, grounds: source.fm.grounds, related: source.fm.related, tags: source.fm.tags,
    curated: 'human', created: now, updated: now,
  });
  return { path, sha: '', fm, body: source.body, encrypted: false };
}

/**
 * Reserve, first half: copy a set's principle into the reserve, without an
 * order, message `Reserve principle: {title}`. The second half is
 * `deletePrinciple` on the original against the snapshot this commit
 * produces; the two commits are how a file changes folder (schema §1
 * rule 1). A slug taken in the reserve gets `-2` as in `createPrinciple`.
 */
export function reservePrinciple(s: BrainSnapshot, path: string, now: string): { batch: CommitBatch; path: string } {
  const source = principleAt(s, path);
  if (source.fm.set === RESERVE_SLUG) throw new Error(`'${path}' is already in the reserve`);
  const slug = uniquePrincipleSlug(s, RESERVE_SLUG, path.split('/')[2]!.replace(/\.md$/, ''));
  const target = `principles/${RESERVE_SLUG}/${slug}.md`;
  const file = copyPrinciple(source, target, RESERVE_SLUG, undefined, now);
  const batch: CommitBatch = { message: `Reserve principle: ${source.fm.title}`, expectedHead: s.head, writes: [write(file)], deletes: [] };
  return { batch: withIndexWrites(s, batch), path: target };
}

/**
 * Place, first half: copy a reserve principle into a set at order N+1,
 * message `Place principle: {title} in {set label}`. The second half is
 * `deletePrinciple` on the reserve copy. Also accepts a principle already
 * in a set, which is the copy-to-another-set case with a clearer message.
 */
export function placePrinciple(s: BrainSnapshot, path: string, setSlug: string, now: string): { batch: CommitBatch; path: string } {
  const source = principleAt(s, path);
  const set = setOf(s, setSlug);
  if (source.fm.set === setSlug) throw new Error(`'${path}' is already in ${setLabel(set.fm)}`);
  const slug = uniquePrincipleSlug(s, setSlug, path.split('/')[2]!.replace(/\.md$/, ''));
  const target = `principles/${setSlug}/${slug}.md`;
  const file = copyPrinciple(source, target, setSlug, s.principlesOf(setSlug).length + 1, now);
  const batch: CommitBatch = { message: `Place principle: ${source.fm.title} in ${setLabel(set.fm)}`, expectedHead: s.head, writes: [write(file)], deletes: [] };
  return { batch: withIndexWrites(s, batch), path: target };
}
