// AnthropicDriver — spec §8.1. POST /v1/messages over plain fetch with the
// browser-access header the app needs for direct calls; SSE streaming;
// listModels from GET /v1/models, taking each model's reported context
// window when the API gives one and a bundled table otherwise.

import type { CompletionEvent, CompletionRequest, ModelInfo, ProviderDriver } from './driver';
import { ProviderError } from './errors';
import { type Fetch, boundFetch, providerFetch } from './http';
import { readSse } from './sse';

export const ANTHROPIC_VERSION = '2023-06-01';

/** Context windows by model family for models the API does not describe (spec §20.2). Conservative. */
export const ANTHROPIC_CONTEXT_WINDOWS: Array<[pattern: RegExp, window: number]> = [
  [/^claude-(fable|mythos|opus|sonnet)-5/, 1_000_000],
  [/^claude-(opus|sonnet)-4-[678]/, 1_000_000],
  [/^claude-haiku-4-5/, 200_000],
];
export const ANTHROPIC_DEFAULT_CONTEXT = 200_000;

export function anthropicContextWindow(id: string, reported?: number): number {
  if (reported && reported > 0) return reported;
  for (const [pattern, window] of ANTHROPIC_CONTEXT_WINDOWS) if (pattern.test(id)) return window;
  return ANTHROPIC_DEFAULT_CONTEXT;
}

export interface AnthropicDriverOptions { apiKey: string; apiBase?: string; fetch?: Fetch; }

interface ModelRow { id: string; display_name?: string; max_input_tokens?: number; max_tokens?: number; }

export class AnthropicDriver implements ProviderDriver {
  readonly id = 'anthropic' as const;
  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly fetchFn: Fetch;

  constructor(opts: AnthropicDriverOptions) {
    this.apiKey = opts.apiKey;
    this.apiBase = (opts.apiBase ?? 'https://api.anthropic.com').replace(/\/$/, '');
    this.fetchFn = opts.fetch ?? boundFetch;
  }

  private headers(): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      // Required for calls straight from the browser (spec §8.1).
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const out: ModelInfo[] = [];
    let after: string | undefined;
    for (let page = 0; page < 20; page++) {
      const q = new URLSearchParams({ limit: '100' });
      if (after) q.set('after_id', after);
      const res = await providerFetch(this.fetchFn, `${this.apiBase}/v1/models?${q}`, { headers: this.headers() }, 'Anthropic');
      const body = (await res.json()) as { data: ModelRow[]; has_more?: boolean; last_id?: string };
      for (const m of body.data) {
        const info: ModelInfo = { id: m.id, label: m.display_name ?? m.id, contextWindow: anthropicContextWindow(m.id, m.max_input_tokens), supportsStreaming: true };
        if (m.max_tokens) info.maxOutputTokens = m.max_tokens;
        out.push(info);
      }
      if (!body.has_more || !body.last_id) break;
      after = body.last_id;
    }
    return out;
  }

  async *complete(req: CompletionRequest): AsyncIterable<CompletionEvent> {
    const res = await providerFetch(this.fetchFn, `${this.apiBase}/v1/messages`, {
      method: 'POST',
      headers: this.headers(),
      signal: req.signal,
      body: JSON.stringify({ model: req.model, max_tokens: req.maxTokens, stream: true, system: req.system, messages: req.messages }),
    }, 'Anthropic');
    if (!res.body) throw new ProviderError('Anthropic: empty response body');
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason: string | undefined;
    for await (const ev of readSse(res.body, req.signal)) {
      const data = JSON.parse(ev.data) as Record<string, unknown>;
      switch (ev.event) {
        case 'message_start': {
          const usage = (data['message'] as { usage?: { input_tokens?: number } } | undefined)?.usage;
          inputTokens = usage?.input_tokens ?? 0;
          break;
        }
        case 'content_block_delta': {
          const delta = data['delta'] as { type: string; text?: string };
          if (delta.type === 'text_delta' && delta.text) yield { type: 'text', text: delta.text };
          break;
        }
        case 'message_delta': {
          const usage = data['usage'] as { output_tokens?: number } | undefined;
          if (usage?.output_tokens !== undefined) outputTokens = usage.output_tokens;
          const delta = data['delta'] as { stop_reason?: string } | undefined;
          if (delta?.stop_reason) stopReason = delta.stop_reason;
          break;
        }
        case 'error': {
          const err = data['error'] as { type?: string; message?: string } | undefined;
          throw new ProviderError(`Anthropic: ${err?.message ?? 'stream error'} (${err?.type ?? 'error'})`);
        }
        default:
          break; // ping, content_block_start, content_block_stop, message_stop
      }
    }
    yield { type: 'done', usage: { inputTokens, outputTokens }, ...(stopReason ? { stopReason } : {}) };
  }
}
