// reasoning — spec §10.2: selected sets (persisted), task, provider and model, transcript, streaming state.
import type { Task } from '@gnomon/core';
import type { ModelInfo } from '@gnomon/providers';
import { type ProviderId, type ReasoningState, ReasoningService } from '../services/reasoning';
import { settings } from './settings.svelte';

export const reasoning = $state<ReasoningState & { task: Task; provider: ProviderId; model: ModelInfo | null; models: ModelInfo[]; input: string }>({
  transcript: [], streaming: false, error: null, preview: null,
  task: 'reason', provider: 'mock', model: null, models: [], input: '',
});

export const reasoner = new ReasoningService(reasoning);

/** Rebuild the provider list from the saved keys (called when Settings change). */
export function configureReasoner(): void {
  reasoner.configure({ ...(settings.anthropicKey ? { anthropic: settings.anthropicKey } : {}), ...(settings.openrouterKey ? { openrouter: settings.openrouterKey } : {}) });
  if (!reasoner.providerIds.includes(reasoning.provider)) reasoning.provider = 'mock';
}
