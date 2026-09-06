// ProviderDriver interface, verbatim from the technical spec §8.1.

export interface ModelInfo { id: string; label: string; contextWindow: number; supportsStreaming: boolean; }
export interface ChatMessage { role: 'user' | 'assistant'; content: string; }
export interface CompletionRequest { model: string; system: string; messages: ChatMessage[]; maxTokens: number; signal: AbortSignal; }
export type CompletionEvent =
  | { type: 'text'; text: string }
  | { type: 'done'; usage: { inputTokens: number; outputTokens: number } };

export interface ProviderDriver {
  id: 'anthropic' | 'openrouter';
  listModels(): Promise<ModelInfo[]>;
  /** streaming */
  complete(req: CompletionRequest): AsyncIterable<CompletionEvent>;
}

/** Conservative pre-request estimate (spec §8.2): ceil(utf8Bytes / 3.6). */
export function estimateTokens(text: string): number {
  return Math.ceil(new TextEncoder().encode(text).length / 3.6);
}
