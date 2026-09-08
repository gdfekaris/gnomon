// MockProvider — not in the spec, but spec §17's flows assume one, and it
// lets the demo brain reason without a key. Replays a script deterministically;
// the default script reads the ref comments in the assembled context and
// writes a plausible, cited answer.

import { estimateTokens } from '@gnomon/core';
import type { CompletionEvent, CompletionRequest, ModelInfo, ProviderDriver } from './driver';

export type MockScript = (req: CompletionRequest) => string;

export interface MockProviderOptions {
  script?: MockScript;
  /** characters per streamed chunk; default 24 */
  chunk?: number;
  /** milliseconds between chunks; default 0 */
  delayMs?: number;
  models?: ModelInfo[];
}

export const MOCK_MODEL: ModelInfo = { id: 'mock-reasoner', label: 'Demo model (no key needed)', contextWindow: 32_000, supportsStreaming: true };

const refsIn = (text: string, prefix: string) => [...text.matchAll(/<!-- ref: ([^\s>]+) -->/g)].map((m) => m[1]!).filter((r) => r.startsWith(prefix));

/** The default script: cite the principles and passages it was given, name precedence when a set has several principles. */
export function demoScript(req: CompletionRequest): string {
  const context = req.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n\n');
  const principles = refsIn(context, 'principles/');
  const passages = refsIn(context, 'sources/');
  const sets = [...context.matchAll(/^## (Set \d+.*)$/gm)].map((m) => m[1]!);
  const input = (context.split(/^## (?:Question|New text|Message)\n/m)[1] ?? '').trim();
  const lines: string[] = [];
  if (sets.length > 1) lines.push(`Reasoning from each set separately: ${sets.join(', ')}.`, '');
  if (principles.length) {
    lines.push(`The governing premise here is [[${principles[0]}]]${passages[0] ? `, grounded in [[${passages[0]}]]` : ', which stands ungrounded'}.`);
    if (principles[1]) lines.push(`[[${principles[1]}]] pulls the other way; naming that tension, and invoking precedence, the lower-numbered principle governs.`);
  } else lines.push('The selected set has no principles to reason from.');
  if (input) lines.push('', `Applied to "${input.slice(0, 80)}${input.length > 80 ? '…' : ''}": the principles argue for the harder, earlier move.`);
  lines.push('', '(This is the demo model. Connect a provider in Settings for real reasoning.)');
  return lines.join('\n');
}

export class MockProvider implements ProviderDriver {
  readonly id = 'mock' as const;
  readonly requests: CompletionRequest[] = [];
  private readonly script: MockScript;
  private readonly chunk: number;
  private readonly delayMs: number;
  private readonly models: ModelInfo[];

  constructor(opts: MockProviderOptions = {}) {
    this.script = opts.script ?? demoScript;
    this.chunk = opts.chunk ?? 24;
    this.delayMs = opts.delayMs ?? 0;
    this.models = opts.models ?? [MOCK_MODEL];
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.models;
  }

  async *complete(req: CompletionRequest): AsyncIterable<CompletionEvent> {
    this.requests.push(req);
    const text = this.script(req);
    for (let i = 0; i < text.length; i += this.chunk) {
      req.signal.throwIfAborted();
      if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
      yield { type: 'text', text: text.slice(i, i + this.chunk) };
    }
    yield { type: 'done', usage: { inputTokens: estimateTokens(req.system + req.messages.map((m) => m.content).join('')), outputTokens: estimateTokens(text) }, stopReason: 'end_turn' };
  }
}
