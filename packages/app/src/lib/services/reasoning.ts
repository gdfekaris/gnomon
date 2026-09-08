// ReasoningService — spec §4, §8.3, §10.2. Assembles context from the
// snapshot within the budget, calls a provider, streams the answer into the
// transcript, and parses citations. Framework-free: it writes into a plain
// state object so it runs under vitest without Svelte.

import { type Assembly, type AssemblyResult, type BrainSnapshot, type Citation, type Task, assemble, parseCitations } from '@gnomon/core';
import { AnthropicDriver, type ChatMessage, MockProvider, type ModelInfo, OpenRouterDriver, type ProviderDriver } from '@gnomon/providers';

export type ProviderId = 'mock' | 'anthropic' | 'openrouter';

export interface Turn {
  role: 'user' | 'assistant';
  task: Task;
  sets: string[];
  text: string;
  citations: Citation[];
  /** for user turns: what was actually sent, for the "what the model saw" view */
  assembly?: Assembly;
}

export interface ReasoningState {
  transcript: Turn[];
  streaming: boolean;
  error: string | null;
  preview: AssemblyResult | null;
}

export interface ProviderKeys { anthropic?: string; openrouter?: string; }

export class ReasoningService {
  private drivers = new Map<ProviderId, ProviderDriver>();
  private controller: AbortController | null = null;

  constructor(private readonly state: ReasoningState, keys: ProviderKeys = {}, mock: ProviderDriver = new MockProvider()) {
    this.configure(keys, mock);
  }

  /** The providers a user can pick from: the demo model always, the others when a key is saved. */
  configure(keys: ProviderKeys, mock: ProviderDriver = this.drivers.get('mock') ?? new MockProvider()): void {
    this.drivers = new Map([['mock', mock]]);
    if (keys.anthropic) this.drivers.set('anthropic', new AnthropicDriver({ apiKey: keys.anthropic }));
    if (keys.openrouter) this.drivers.set('openrouter', new OpenRouterDriver({ apiKey: keys.openrouter }));
  }

  get providerIds(): ProviderId[] {
    return [...this.drivers.keys()];
  }

  listModels(provider: ProviderId): Promise<ModelInfo[]> {
    const d = this.drivers.get(provider);
    if (!d) throw new Error(`provider '${provider}' is not configured`);
    return d.listModels();
  }

  /** Spec §8.2: the budget is a percentage of the model's window. */
  static budget(model: ModelInfo, percent: number): number {
    return Math.floor((model.contextWindow * percent) / 100);
  }

  /** Assemble without sending, for the budget bar. */
  preview(snapshot: BrainSnapshot, task: Task, sets: string[], input: string, model: ModelInfo, percent: number, placement: 'context' | 'system'): AssemblyResult | null {
    if (sets.length === 0) {
      this.state.preview = null;
      return null;
    }
    const r = assemble(snapshot, task, sets, input, ReasoningService.budget(model, percent), { setDescriptionPlacement: placement });
    this.state.preview = r;
    return r;
  }

  get busy(): boolean {
    return this.controller !== null;
  }

  stop(): void {
    this.controller?.abort();
  }

  clear(): void {
    this.state.transcript = [];
    this.state.error = null;
  }

  /** One task run: assemble, send with the prior turns as history, stream the answer. */
  async run(snapshot: BrainSnapshot, provider: ProviderId, model: ModelInfo, task: Task, sets: string[], input: string, percent: number, placement: 'context' | 'system'): Promise<Turn | null> {
    const driver = this.drivers.get(provider);
    if (!driver) throw new Error(`provider '${provider}' is not configured`);
    const r = this.preview(snapshot, task, sets, input, model, percent, placement);
    if (!r) throw new Error('select at least one principle set');
    if (!r.ok) {
      this.state.error = describeAssemblyError(r);
      return null;
    }
    const history: ChatMessage[] = this.state.transcript.map((t) => ({ role: t.role, content: t.role === 'user' ? t.text : t.text }));
    const userTurn: Turn = { role: 'user', task, sets, text: input.trim() || taskLabel(task), citations: [], assembly: r };
    const answer: Turn = { role: 'assistant', task, sets, text: '', citations: [] };
    this.state.transcript = [...this.state.transcript, userTurn, answer];
    this.state.error = null;
    this.state.streaming = true;
    this.controller = new AbortController();
    const maxTokens = Math.max(1024, Math.min(model.maxOutputTokens ?? 8192, 8192));
    try {
      const events = driver.complete({ model: model.id, system: r.system, messages: [...history, { role: 'user', content: r.context }], maxTokens, signal: this.controller.signal });
      for await (const ev of events) {
        if (ev.type === 'text') {
          answer.text += ev.text;
          this.state.transcript = [...this.state.transcript.slice(0, -1), { ...answer }];
        } else if (ev.stopReason === 'refusal') {
          answer.text += '\n\n(The provider declined to answer this request.)';
        }
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') answer.text += answer.text ? '\n\n(stopped)' : '(stopped)';
      else this.state.error = (e as Error).message;
    } finally {
      this.controller = null;
      this.state.streaming = false;
      answer.citations = parseCitations(answer.text, snapshot);
      this.state.transcript = [...this.state.transcript.slice(0, -1), { ...answer }];
    }
    return answer;
  }
}

export function taskLabel(task: Task): string {
  return { reason: 'Reason from my principles', relate: 'Relate a new text', compare: 'Compare sets', free: 'Free-form' }[task];
}

export function describeAssemblyError(r: Exclude<AssemblyResult, { ok: true }>): string {
  switch (r.error) {
    case 'SETS_EXCEED_BUDGET':
      return `The selected sets alone need about ${r.neededTokens.toLocaleString()} tokens and the budget is ${r.budgetTokens.toLocaleString()}. Select fewer sets, raise the budget in Settings, or pick a model with a larger window. Principles are never truncated.`;
    case 'INPUT_EXCEEDS_BUDGET':
      return `The text needs about ${r.neededTokens.toLocaleString()} tokens but only ${r.remainingTokens.toLocaleString()} remain after the principles. Shorten it, select fewer sets, or raise the budget.`;
    case 'EMPTY_SET':
      return `Set '${r.set}' has no principles. Reasoning without premises would make the answer the model's, not yours. Write a principle first.`;
  }
}
