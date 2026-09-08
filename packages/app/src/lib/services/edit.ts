// Editors with curation enforcement (US-4, US-5, US-6, US-7). Framework-free
// helpers the editor screen calls; every save is one commit through
// BrainService, whose validateBatch refuses anything the schema forbids. A
// raw.md body and an attachment have no editor anywhere.

import {
  type BrainFile, type BrainSnapshot, type NotesFm, type PrincipleFm, type SourceFm, createPrinciple, groundsDrift, nowUtc,
  renderDualLink, serializeFile, updatePrinciple, withIndexWrites,
} from '@gnomon/core';
import type { BrainService } from './brain';

function snap(brain: BrainService): BrainSnapshot {
  const s = brain.snapshot;
  if (!s) throw new Error('no brain is connected');
  return s;
}

export const slugOfSource = (path: string) => path.split('/')[1]!;

/** `slug` on its own line under the Grounding passages heading, added if missing. */
export function appendGroundingLink(body: string, fromPath: string, slug: string): string {
  const link = `- ${renderDualLink(fromPath, `sources/${slug}/raw.md`, 'raw')}`;
  const trimmed = body.replace(/\s+$/, '');
  if (/\*\*Grounding passages:\*\*/.test(trimmed)) return `${trimmed}\n${link}\n`;
  return `${trimmed ? `${trimmed}\n\n` : ''}**Grounding passages:**\n\n${link}\n`;
}

/** Schema §9 drift, for a body being edited (not yet saved). */
export function driftOf(path: string, body: string, grounds: string[]) {
  const stub = { path, sha: '', encrypted: false, body, fm: { type: 'principle', title: '', set: '', order: 1, grounds, curated: 'human', created: '', updated: '' } } as BrainFile<PrincipleFm>;
  return groundsDrift(stub);
}

export interface PrincipleFields { title: string; body: string; grounds: string[]; related: string[]; tags: string[]; }

export async function createPrincipleIn(brain: BrainService, setSlug: string, f: PrincipleFields): Promise<string> {
  const { batch, path } = createPrinciple(snap(brain), {
    setSlug, title: f.title.trim(), body: f.body, grounds: f.grounds,
    ...(f.related.length ? { related: f.related } : {}), ...(f.tags.length ? { tags: f.tags } : {}), now: nowUtc(),
  });
  await brain.commit(batch);
  return path;
}

export async function savePrinciple(brain: BrainService, path: string, f: PrincipleFields): Promise<void> {
  await brain.commit(updatePrinciple(snap(brain), path, {
    title: f.title.trim(), body: f.body, grounds: f.grounds, related: f.related.length ? f.related : null, tags: f.tags.length ? f.tags : null, now: nowUtc(),
  }));
}

/** Schema §4.3: the curator's first edit makes notes `human`. */
export async function saveNotes(brain: BrainService, path: string, body: string): Promise<void> {
  const s = snap(brain);
  const prev = s.files.get(path) as BrainFile<NotesFm> | undefined;
  if (!prev || prev.fm.type !== 'notes') throw new Error(`no notes file at '${path}'`);
  const next: BrainFile<NotesFm> = { ...prev, fm: { ...prev.fm, curated: 'human' }, body };
  const text = serializeFile(next, { prev, now: nowUtc() });
  await brain.commit(withIndexWrites(s, { message: `Edit notes: ${slugOfSource(path)}`, expectedHead: s.head, writes: [{ path, text }], deletes: [] }));
}

export interface SourceMetaFields { title: string; author: string; work: string; year: string; locator: string; origin: string; tags: string[]; }

/** Schema §4.2, §5: metadata is editable and the edit makes the file `human`; the body is never touched. */
export async function saveSourceMeta(brain: BrainService, path: string, f: SourceMetaFields): Promise<void> {
  const s = snap(brain);
  const prev = s.files.get(path) as BrainFile<SourceFm> | undefined;
  if (!prev || prev.fm.type !== 'source') throw new Error(`no source at '${path}'`);
  const fm: SourceFm = { ...prev.fm, title: f.title.trim(), author: f.author.trim() || 'unknown', curated: 'human' };
  const optional: Array<['work' | 'locator' | 'origin', string]> = [['work', f.work], ['locator', f.locator], ['origin', f.origin]];
  for (const [k, v] of optional) {
    if (v.trim()) fm[k] = v.trim();
    else delete fm[k];
  }
  const year = f.year.trim();
  if (year === '') delete fm.year;
  else if (/^-?\d+$/.test(year)) fm.year = Number(year);
  else throw new Error('year must be a whole number');
  if (f.tags.length) fm.tags = f.tags;
  else delete fm.tags;
  const next: BrainFile<SourceFm> = { ...prev, fm };
  const text = serializeFile(next, { prev, now: nowUtc() });
  await brain.commit(withIndexWrites(s, { message: `Edit source: ${slugOfSource(path)}`, expectedHead: s.head, writes: [{ path, text }], deletes: [] }));
}

export const parseList = (text: string): string[] => [...new Set(text.split(/[,\n]/).map((x) => x.trim()).filter(Boolean))];
export const tagList = (text: string): string[] => parseList(text).map((t) => t.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')).filter(Boolean);
