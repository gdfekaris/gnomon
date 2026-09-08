// Set and principle management for the Sets screen (US-18, US-20). Thin,
// framework-free wrappers over core/sets: each builds the batch, commits it
// through BrainService (head check and write rules included), and returns
// what the screen needs to say.

import { type Dangling, createSet, deletePrinciple, deleteSet, nowUtc, reorderPrinciples, reorderSets, updatePrinciple, updateSet } from '@gnomon/core';
import type { BrainService } from './brain';

function snap(brain: BrainService) {
  const s = brain.snapshot;
  if (!s) throw new Error('no brain is connected');
  return s;
}

export async function newSet(brain: BrainService, params: { name?: string; body?: string }): Promise<string> {
  const { batch, slug } = createSet(snap(brain), { ...(params.name ? { name: params.name } : {}), ...(params.body !== undefined ? { body: params.body } : {}), now: nowUtc() });
  await brain.commit(batch);
  return slug;
}

export async function renameSet(brain: BrainService, slug: string, name: string): Promise<void> {
  await brain.commit(updateSet(snap(brain), slug, { name: name.trim() === '' ? null : name.trim(), now: nowUtc() }));
}

export async function describeSet(brain: BrainService, slug: string, body: string): Promise<void> {
  await brain.commit(updateSet(snap(brain), slug, { body: body.replace(/\s+$/, '') ? `${body.replace(/\s+$/, '')}\n` : '', now: nowUtc() }));
}

/** Move a set one position; `direction` -1 is up (toward Set 1). */
export async function moveSet(brain: BrainService, slug: string, direction: -1 | 1): Promise<void> {
  const s = snap(brain);
  const order = s.sets.map((f) => f.path.split('/')[1]!);
  const i = order.indexOf(slug);
  const j = i + direction;
  if (i === -1 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j]!, order[i]!];
  await brain.commit(reorderSets(s, order, nowUtc()));
}

export async function movePrinciple(brain: BrainService, setSlug: string, principleSlug: string, direction: -1 | 1): Promise<void> {
  const s = snap(brain);
  const order = s.principlesOf(setSlug).map((f) => f.path.split('/')[2]!.replace(/\.md$/, ''));
  const i = order.indexOf(principleSlug);
  const j = i + direction;
  if (i === -1 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j]!, order[i]!];
  await brain.commit(reorderPrinciples(s, setSlug, order, nowUtc()));
}

/** Put `slug` at `index` within its list (drag-and-drop). */
export async function placeSet(brain: BrainService, slug: string, index: number): Promise<void> {
  const s = snap(brain);
  const order = s.sets.map((f) => f.path.split('/')[1]!).filter((x) => x !== slug);
  order.splice(Math.max(0, Math.min(index, order.length)), 0, slug);
  await brain.commit(reorderSets(s, order, nowUtc()));
}

export async function placePrinciple(brain: BrainService, setSlug: string, principleSlug: string, index: number): Promise<void> {
  const s = snap(brain);
  const order = s.principlesOf(setSlug).map((f) => f.path.split('/')[2]!.replace(/\.md$/, '')).filter((x) => x !== principleSlug);
  order.splice(Math.max(0, Math.min(index, order.length)), 0, principleSlug);
  await brain.commit(reorderPrinciples(s, setSlug, order, nowUtc()));
}

export interface DeletePlan { principleCount: number; dangling: Dangling[]; label: string; commit: () => Promise<void>; }

/** Schema §7.4: what deleting a set would remove and leave dangling, plus the commit to do it. */
export function planDeleteSet(brain: BrainService, slug: string): DeletePlan {
  const s = snap(brain);
  const { batch, dangling } = deleteSet(s, slug, nowUtc());
  const set = s.sets.find((f) => f.path === `principles/${slug}/_set.md`)!;
  const label = `Set ${set.fm.order}${set.fm.name ? ` — ${set.fm.name}` : ''}`;
  return { principleCount: s.principlesOf(slug).length, dangling, label, commit: () => brain.commit(batch).then(() => undefined) };
}

export function planDeletePrinciple(brain: BrainService, path: string): DeletePlan {
  const s = snap(brain);
  const { batch, dangling } = deletePrinciple(s, path, nowUtc());
  const f = s.files.get(path)!;
  const title = 'title' in f.fm && typeof f.fm.title === 'string' ? f.fm.title : path;
  return { principleCount: 1, dangling, label: title, commit: () => brain.commit(batch).then(() => undefined) };
}

export { updatePrinciple };
