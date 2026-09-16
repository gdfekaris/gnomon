// Relate sources to a set — Task F (schema §7.15; tracker 2026-09-16). One
// completion, not streamed; the reply is parsed before anything is written,
// so a bad reply creates nothing. An empty reply is a valid answer: nothing
// in the passages bears on the set, and no commit is made.
import { type BrainSnapshot, buildRelate, buildRelatePrompt, nowUtc, parseRelateReply } from '@gnomon/core';
import type { ModelInfo, ProviderDriver } from '@gnomon/providers';
import type { BrainService } from './brain';
import { describeDeriveError } from './derive';
import { completeText } from './inbox';

export interface RelateResult { set: string; n: number; ids: string[]; kinds: Array<'link' | 'amendment' | 'principle'> }

const snap = (brain: BrainService): BrainSnapshot => {
  const s = brain.snapshot;
  if (!s) throw new Error('no brain is connected');
  return s;
};

export const describeRelateError = describeDeriveError;

/** Task F: relate the chosen sources to one existing set; one commit of proposals, or none when the model proposes nothing. */
export async function relateInto(brain: BrainService, provider: ProviderDriver, model: ModelInfo, sources: string[], setSlug: string, budgetTokens: number, signal: AbortSignal = new AbortController().signal): Promise<RelateResult> {
  if (sources.length === 0) throw new Error('pick at least one source');
  const prompt = buildRelatePrompt(snap(brain), sources, setSlug, budgetTokens);
  if (!prompt.ok) throw new Error(describeRelateError(prompt));
  const reply = await completeText(provider, model, prompt.system, prompt.context, signal);
  const entries = parseRelateReply(reply, snap(brain), sources, setSlug);
  if (entries.length === 0) return { set: setSlug, n: 0, ids: [], kinds: [] };
  const batch = buildRelate(snap(brain), setSlug, entries, { now: nowUtc() });
  await brain.commit(batch);
  const ids = batch.writes.map((w) => w.path).filter((p) => p.startsWith('maps/proposals/')).map((p) => p.slice('maps/proposals/'.length, -3));
  return { set: setSlug, n: entries.length, ids, kinds: entries.map((e) => e.kind) };
}
