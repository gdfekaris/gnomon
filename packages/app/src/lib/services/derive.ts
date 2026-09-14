// Derive principles from sources — Task E (tracker, 2026-09-14). One
// completion, not streamed; the reply is parsed before anything is written,
// so a bad reply creates nothing, not even the new set.
import { type BrainSnapshot, buildDerive, buildDerivePrompt, nowUtc, parseDeriveReply } from '@gnomon/core';
import type { ModelInfo, ProviderDriver } from '@gnomon/providers';
import type { BrainService } from './brain';
import { completeText } from './inbox';
import { newSet } from './sets';

export type DeriveTarget = { slug: string } | { newName: string };
export interface DeriveResult { set: string; created: boolean; n: number; ids: string[] }

const snap = (brain: BrainService): BrainSnapshot => {
  const s = brain.snapshot;
  if (!s) throw new Error('no brain is connected');
  return s;
};

export function describeDeriveError(r: { error: 'SOURCES_EXCEED_BUDGET'; neededTokens: number; budgetTokens: number }): string {
  return `The passages need about ${r.neededTokens.toLocaleString()} tokens and the budget is ${r.budgetTokens.toLocaleString()}. Pick fewer sources, raise the budget in Settings, or pick a model with a larger window. Passages are never truncated.`;
}

/** Task E: derive into an existing set, or into a new one created first (only once the reply has parsed). */
export async function deriveInto(brain: BrainService, provider: ProviderDriver, model: ModelInfo, sources: string[], target: DeriveTarget, budgetTokens: number, signal: AbortSignal = new AbortController().signal): Promise<DeriveResult> {
  if (sources.length === 0) throw new Error('pick at least one source');
  const targetSlug = 'slug' in target ? target.slug : null;
  const prompt = buildDerivePrompt(snap(brain), sources, targetSlug, budgetTokens);
  if (!prompt.ok) throw new Error(describeDeriveError(prompt));
  const reply = await completeText(provider, model, prompt.system, prompt.context, signal);
  const entries = parseDeriveReply(reply, snap(brain), sources, targetSlug);
  const set = targetSlug ?? (await newSet(brain, { ...('newName' in target && target.newName.trim() ? { name: target.newName.trim() } : {}) }));
  const batch = buildDerive(snap(brain), set, entries, { now: nowUtc() });
  await brain.commit(batch);
  const ids = batch.writes.map((w) => w.path).filter((p) => p.startsWith('maps/proposals/')).map((p) => p.slice('maps/proposals/'.length, -3));
  return { set, created: targetSlug === null, n: entries.length, ids };
}
