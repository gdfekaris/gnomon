// reasoning — spec §10.2: selected sets (persisted), task, provider and model, transcript, streaming state.
import { untrack } from 'svelte';
import type { Task } from '@gnomon/core';
import type { ModelInfo } from '@gnomon/providers';
import { type ProviderId, type ReasoningState, ReasoningService } from '../services/reasoning';
import { settings } from './settings.svelte';

/** The Reason screen's tasks: the four assembly tasks, Derive (Task E), and Relate sources to a set (Task F); the last two share the source picker. */
export type ScreenTask = Task | 'derive' | 'relate-set';

export const reasoning = $state<ReasoningState & { task: ScreenTask; provider: ProviderId; providers: ProviderId[]; model: ModelInfo | null; models: ModelInfo[]; input: string; derive: { sources: string[]; target: string; newName: string } }>({
  transcript: [], streaming: false, error: null, preview: null,
  task: 'reason', provider: 'mock', providers: ['mock'], model: null, models: [], input: '',
  // The source picker's selection (Derive and Relate to a set) is remembered for the session, not the device: the chosen sources, the target set ('new' for a new one, Derive only), its optional sub-name.
  derive: { sources: [], target: '', newName: '' },
});

export const reasoner = new ReasoningService(reasoning);

/**
 * Rebuild the provider list from the saved keys: at launch, and whenever a
 * key changes. `reasoning.providers` is the reactive copy the screens list
 * (the service itself is a plain object, so its own list never re-renders).
 * The chosen provider is remembered in prefs and restored when its key is
 * still there.
 */
export function configureReasoner(): void {
  reasoner.configure({ ...(settings.anthropicKey ? { anthropic: settings.anthropicKey } : {}), ...(settings.openrouterKey ? { openrouter: settings.openrouterKey } : {}) });
  // Called from effects keyed on the keys above; what it writes it must not also track, or the effect loops.
  untrack(() => {
    const providers = reasoner.providerIds;
    if (providers.join() !== reasoning.providers.join()) reasoning.providers = providers;
    const wanted = providers.includes(settings.prefs.provider) ? settings.prefs.provider : reasoning.provider;
    const next = providers.includes(wanted) ? wanted : 'mock';
    if (next !== reasoning.provider) reasoning.provider = next;
  });
}
