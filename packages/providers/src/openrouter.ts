// OpenRouterDriver — spec §8.1. Chat completions over plain fetch with the
// bearer token and the referer and title headers OpenRouter asks of apps;
// SSE streaming with usage in the final chunk; listModels reads each
// model's context_length, the authoritative source for budgets.

import type { CompletionEvent, CompletionRequest, ModelInfo, ProviderDriver } from './driver';
import { type Fetch, boundFetch, providerFetch } from './http';
import { readChatCompletionStream } from './openai';

export interface OpenRouterDriverOptions {
  apiKey: string;
  apiBase?: string;
  fetch?: Fetch;
  /** sent as HTTP-Referer, how OpenRouter attributes the app */
  referer?: string;
  /** sent as X-Title */
  title?: string;
}

interface ModelRow { id: string; name?: string; context_length?: number; top_provider?: { max_completion_tokens?: number | null } }

export class OpenRouterDriver implements ProviderDriver {
  readonly id = 'openrouter' as const;
  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly fetchFn: Fetch;
  private readonly referer: string;
  private readonly title: string;

  constructor(opts: OpenRouterDriverOptions) {
    this.apiKey = opts.apiKey;
    this.apiBase = (opts.apiBase ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '');
    this.fetchFn = opts.fetch ?? boundFetch;
    this.referer = opts.referer ?? 'https://gdfekaris.github.io/gnomon/';
    this.title = opts.title ?? 'Gnomon';
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, 'HTTP-Referer': this.referer, 'X-Title': this.title, 'content-type': 'application/json' };
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await providerFetch(this.fetchFn, `${this.apiBase}/models`, { headers: this.headers() }, 'OpenRouter');
    const body = (await res.json()) as { data: ModelRow[] };
    return body.data.map((m) => {
      const info: ModelInfo = { id: m.id, label: m.name ?? m.id, contextWindow: m.context_length ?? 8_192, supportsStreaming: true };
      const cap = m.top_provider?.max_completion_tokens;
      if (cap) info.maxOutputTokens = cap;
      return info;
    });
  }

  async *complete(req: CompletionRequest): AsyncIterable<CompletionEvent> {
    const res = await providerFetch(this.fetchFn, `${this.apiBase}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      signal: req.signal,
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens,
        stream: true,
        usage: { include: true },
        messages: [{ role: 'system', content: req.system }, ...req.messages],
      }),
    }, 'OpenRouter');
    yield* readChatCompletionStream(res, req.signal, 'OpenRouter');
  }
}
