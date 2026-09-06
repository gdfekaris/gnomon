// filing — spec §7.6, §8.5; schema §3.1, §7.6. The only code path that
// writes a raw.md, so the passage can only ever be a copy of the capture.

import type { BrainFile, BrainSnapshot, CommitBatch, FileWrite, InboxFm, NotesFm, SourceFm } from '../schema/types';
import { isSourceSlug } from '../schema/identifiers';
import { serializeFile } from '../schema/serialize';
import { slugify } from '../sets/index';
import { type ProposalParams, buildProposal, nextProposalId } from '../proposals/index';

/** Source metadata a filer determines from the capture (spec §8.5). Blank fields are left out, never guessed. */
export interface SourceMeta {
  title: string;
  author: string;
  work?: string;
  year?: number;
  locator?: string;
  origin?: string;
  tags?: string[];
  /** a slug the filer proposes; derived from author and title when absent */
  slug?: string;
}

export interface FilingOptions {
  /** the capture's attachment bytes, required when the capture declares one */
  attachmentBytes?: Uint8Array;
  now: string;
}

/** Schema §3.1: author surname plus a short title fragment. */
export function proposeSourceSlug(author: string, title: string): string {
  const cleaned = author.replace(/\(.*?\)/g, '').trim();
  const surname = cleaned.includes(',') ? cleaned.split(',')[0]! : (cleaned.split(/\s+/).filter(Boolean).pop() ?? '');
  const head = slugify(surname).replace(/-principle$|^principle$/, '') || 'unknown';
  const fragment = slugify(title).split('-').filter((w) => w !== 'principle').slice(0, 4).join('-');
  const slug = [head, fragment].filter(Boolean).join('-').slice(0, 60).replace(/-+$/, '');
  return slug.length >= 3 ? slug : `${slug}-source`.slice(0, 60);
}

/** `slug`, or `slug-2`, `slug-3`, … until no source folder claims it. */
export function uniqueSourceSlug(s: BrainSnapshot, slug: string): string {
  const taken = new Set(s.byType('source').map((f) => f.path.split('/')[1]!));
  for (const f of s.byType('notes')) taken.add(f.path.split('/')[1]!);
  for (const a of s.attachments.keys()) if (a.startsWith('sources/')) taken.add(a.split('/')[1]!);
  if (!taken.has(slug)) return slug;
  for (let n = 2; ; n++) {
    const candidate = `${slug.slice(0, 60 - `-${n}`.length).replace(/-+$/, '')}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Schema §7.6, one capture: raw.md (body copied), original.<ext> (bytes copied), notes.md, proposals, capture marked filed. */
export function buildFiling(s: BrainSnapshot, capture: BrainFile<InboxFm>, meta: SourceMeta, proposals: ProposalParams[], opts: FilingOptions): CommitBatch {
  if (capture.fm.status === 'filed') throw new Error(`${capture.path} is already filed as '${capture.fm.filed_as}'`);
  const stem = capture.path.slice('inbox/'.length, -3);

  const proposed = meta.slug ?? proposeSourceSlug(meta.author, meta.title);
  if (!isSourceSlug(proposed)) throw new Error(`source slug '${proposed}' is malformed`);
  const slug = uniqueSourceSlug(s, proposed);

  const writes: FileWrite[] = [];

  let attachment: string | undefined;
  if (capture.fm.attachment !== undefined) {
    if (!opts.attachmentBytes) throw new Error(`${capture.path} has an attachment; its bytes are required to file it`);
    attachment = `original.${capture.fm.attachment.slice(capture.fm.attachment.lastIndexOf('.') + 1)}`;
  }

  const raw: Record<string, unknown> = {
    type: 'source', title: meta.title, author: meta.author, work: meta.work, year: meta.year, locator: meta.locator, origin: meta.origin,
    inbox_ref: stem, attachment, tags: meta.tags, curated: 'agent-proposed', created: opts.now, updated: opts.now,
  };
  for (const k of Object.keys(raw)) if (raw[k] === undefined) delete raw[k];
  writes.push({ path: `sources/${slug}/raw.md`, text: serializeFile({ path: `sources/${slug}/raw.md`, sha: '', fm: raw as unknown as SourceFm, body: capture.body, encrypted: false }) });

  if (attachment !== undefined) writes.push({ path: `sources/${slug}/${attachment}`, bytes: opts.attachmentBytes! });

  const notes: NotesFm = { type: 'notes', source: slug, curated: 'agent-proposed', created: opts.now, updated: opts.now };
  writes.push({ path: `sources/${slug}/notes.md`, text: serializeFile({ path: `sources/${slug}/notes.md`, sha: '', fm: notes, body: '', encrypted: false }) });

  const drawn: string[] = [];
  for (const p of proposals) {
    const id = nextProposalId(s, opts.now, drawn);
    drawn.push(id);
    const target = p.target ?? (p.kind === 'tag' ? slug : undefined);
    writes.push(buildProposal({ ...p, ...(target !== undefined ? { target } : {}), id, from_source: slug, curated: 'agent-proposed', now: opts.now }));
  }

  const marked: BrainFile<InboxFm> = { ...capture, fm: { ...capture.fm, status: 'filed', filed_as: slug } };
  writes.push({ path: capture.path, text: serializeFile(marked) });

  return { message: `File: ${slug}`, expectedHead: s.head, writes, deletes: [] };
}
