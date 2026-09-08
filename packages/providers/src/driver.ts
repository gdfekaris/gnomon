// ProviderDriver interface, from the technical spec §8.1.

export interface ModelInfo {
  id: string;
  label: string;
  /** input context window in tokens; the authoritative source for budgets */
  contextWindow: number;
  /** output cap, when the provider reports it */
  maxOutputTokens?: number;
  supportsStreaming: boolean;
}
export interface ChatMessage { role: 'user' | 'assistant'; content: string; }
export interface CompletionRequest { model: string; system: string; messages: ChatMessage[]; maxTokens: number; signal: AbortSignal; }
export type CompletionEvent =
  | { type: 'text'; text: string }
  | { type: 'done'; usage: { inputTokens: number; outputTokens: number }; stopReason?: string };

export interface ProviderDriver {
  id: 'anthropic' | 'openrouter' | 'mock';
  listModels(): Promise<ModelInfo[]>;
  /** streaming */
  complete(req: CompletionRequest): AsyncIterable<CompletionEvent>;
}

// Token estimation lives in core/assembly (spec §8.2); re-exported here for callers that only know providers.
export { estimateTokens } from '@gnomon/core';
