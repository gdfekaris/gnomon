// CustomDriver — a model endpoint the user runs: Ollama, llama.cpp's
// server, LM Studio, or anything else that speaks the OpenAI-style chat
// completions API. Only a build that opts in can reach one (the build
// setting VITE_CUSTOM_ENDPOINT, spec §15); the address, an optional key,
// and the context window come from the user, since these servers do not
// report a window the way OpenRouter does.

import type { CompletionEvent, CompletionRequest, ModelInfo, ProviderDriver } from './driver';
import { type Fetch, boundFetch, providerFetch } from './http';
import { readChatCompletionStream } from './openai';

export interface CustomDriverOptions {
  /** the API base, e.g. https://model.example.com/v1 */
  baseUrl: string;
  /** sent as a bearer token when set */
  apiKey?: string;
  /** the context window the user entered, in tokens; every model on the endpoint gets it */
  contextWindow: number;
  fetch?: Fetch;
}

/** How the app names this provider in its sentences and pickers. */
export const CUSTOM_LABEL = 'Your model';

export class CustomDriver implements ProviderDriver {
  readonly id = 'custom' as const;
  private readonly base: string;

  constructor(private readonly opts: CustomDriverOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, '');
  }

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', ...(this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {}) };
  }

  private fetchFn(): Fetch {
    return this.opts.fetch ?? boundFetch;
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await providerFetch(this.fetchFn(), `${this.base}/models`, { headers: this.headers() }, CUSTOM_LABEL);
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    return (body.data ?? []).map((m) => ({ id: m.id, label: m.id, contextWindow: this.opts.contextWindow, supportsStreaming: true }));
  }

  async *complete(req: CompletionRequest): AsyncIterable<CompletionEvent> {
    const res = await providerFetch(this.fetchFn(), `${this.base}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      signal: req.signal,
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: 'system', content: req.system }, ...req.messages],
      }),
    }, CUSTOM_LABEL);
    yield* readChatCompletionStream(res, req.signal, CUSTOM_LABEL);
  }
}
