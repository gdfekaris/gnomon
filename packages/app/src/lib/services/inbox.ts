// Inbox — US-2, US-3, spec §8.5, §9. Process unfiled captures through a
// provider one commit each, list recent filings with where they stand,
// ratify, and reject. Framework-free; the screen renders the state object.

import {
  type BrainFile, type BrainSnapshot, type FileChange, type FilingReview, type FilingState, type InboxFm, buildFiling, buildFilingPrompt, buildRatify,
  filingState, nowUtc, parseFilingReply, reviewFiling,
} from '@gnomon/core';
import type { ModelInfo, ProviderDriver } from '@gnomon/providers';
import { type Filing, RevertConflictError, type StorageDriver, listFilings, rejectFiling } from '@gnomon/storage';
import type { BrainService } from './brain';

export interface FilingEntry extends Filing { state: FilingState; }

export interface ProcessResult { path: string; slug?: string; proposals?: number; error?: string; }

export interface InboxState {
  filings: FilingEntry[];
  loading: boolean;
  processing: { done: number; total: number } | null;
  results: ProcessResult[];
  error: string | null;
}

function snap(brain: BrainService): BrainSnapshot {
  const s = brain.snapshot;
  if (!s) throw new Error('no brain is connected');
  return s;
}

export const unfiledCaptures = (s: BrainSnapshot): BrainFile<InboxFm>[] => s.byType('inbox').filter((f) => f.fm.status === 'unfiled');

/** Recent filing commits with their state at the current head (spec §9). */
export async function loadFilings(state: InboxState, brain: BrainService, driver: StorageDriver, limit = 50): Promise<void> {
  state.loading = true;
  state.error = null;
  try {
    const s = snap(brain);
    const filings = await listFilings(driver, limit);
    state.filings = filings.map((f) => ({ ...f, state: filingState(s, f.changes) }));
  } catch (e) {
    state.error = (e as Error).message;
  } finally {
    state.loading = false;
  }
}

async function completeText(provider: ProviderDriver, model: ModelInfo, system: string, context: string, signal: AbortSignal): Promise<string> {
  let text = '';
  for await (const ev of provider.complete({ model: model.id, system, messages: [{ role: 'user', content: context }], maxTokens: Math.min(model.maxOutputTokens ?? 4096, 4096), signal })) {
    if (ev.type === 'text') text += ev.text;
  }
  return text;
}

/**
 * Task C for every unfiled capture (spec §8.5): the model proposes metadata
 * and proposals from the text and note; the app copies the passage and the
 * attachment itself and commits one batch per capture. A bad reply stops
 * that capture only; the rest go on.
 */
export async function processInbox(state: InboxState, brain: BrainService, driver: StorageDriver, provider: ProviderDriver, model: ModelInfo, budgetTokens: number, signal: AbortSignal = new AbortController().signal): Promise<ProcessResult[]> {
  const captures = unfiledCaptures(snap(brain));
  state.processing = { done: 0, total: captures.length };
  state.results = [];
  state.error = null;
  try {
    for (const capture of captures) {
      const result: ProcessResult = { path: capture.path };
      try {
        const s = snap(brain);
        const current = s.files.get(capture.path) as BrainFile<InboxFm> | undefined;
        if (!current || current.fm.status !== 'unfiled') throw new Error('no longer unfiled');
        const prompt = buildFilingPrompt(s, current, budgetTokens);
        if (!prompt.ok) throw new Error(`the capture needs about ${prompt.neededTokens.toLocaleString()} tokens and the budget is ${prompt.budgetTokens.toLocaleString()}`);
        const reply = await completeText(provider, model, prompt.system, prompt.context, signal);
        const { meta, proposals } = parseFilingReply(reply, s);
        const attachmentBytes = current.fm.attachment ? (await driver.readBytes(`inbox/${current.fm.attachment}`)).bytes : undefined;
        const batch = buildFiling(s, current, meta, proposals, { now: nowUtc(), ...(attachmentBytes ? { attachmentBytes } : {}) });
        await brain.commit(batch);
        result.slug = batch.message.slice('File: '.length);
        result.proposals = proposals.length;
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        result.error = (e as Error).message;
      }
      state.results = [...state.results, result];
      state.processing = { done: state.results.length, total: captures.length };
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') state.error = (e as Error).message;
  } finally {
    state.processing = null;
  }
  return state.results;
}

export function reviewOf(brain: BrainService, changes: FileChange[]): FilingReview {
  return reviewFiling(snap(brain), changes);
}

/** Spec §9 ratify: one commit; the list is refreshed afterwards. */
export async function ratify(state: InboxState, brain: BrainService, driver: StorageDriver, filing: FilingEntry): Promise<void> {
  await brain.commit(buildRatify(snap(brain), filing.changes, nowUtc()));
  await loadFilings(state, brain, driver);
}

/** Spec §9 reject: a revert; on conflict, the paths the curator must handle by hand. */
export async function reject(state: InboxState, brain: BrainService, driver: StorageDriver, filing: FilingEntry): Promise<{ conflict?: string[] }> {
  try {
    await rejectFiling(driver, filing);
  } catch (e) {
    if (e instanceof RevertConflictError) return { conflict: e.paths };
    throw e;
  }
  await brain.refresh();
  await loadFilings(state, brain, driver);
  return {};
}
