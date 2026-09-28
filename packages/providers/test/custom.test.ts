import { describe, expect, it } from 'vitest';
import { CustomDriver, ProviderAuthError, ProviderNetworkError } from '../src/index';
import { collect, streamBody } from './contract';

// The custom endpoint driver (spec §8.1, §15): an OpenAI-style server the user runs, such as Ollama.

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Ollama's OpenAI-compatible stream: deltas, a final chunk with finish_reason, usage when asked for, then [DONE]. */
function ollamaSse(deltas: string[]): string {
  let out = '';
  for (const t of deltas) out += `data: ${JSON.stringify({ id: 'chatcmpl-1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: t }, finish_reason: null }] })}\n\n`;
  out += `data: ${JSON.stringify({ id: 'chatcmpl-1', choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: 'stop' }] })}\n\n`;
  out += `data: ${JSON.stringify({ id: 'chatcmpl-1', choices: [], usage: { prompt_tokens: 120, completion_tokens: 7 } })}\n\n`;
  out += 'data: [DONE]\n\n';
  return out;
}

function fakeServer(seen: Array<{ url: string; init: RequestInit }>, opts: { status?: number; offline?: boolean } = {}): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    seen.push({ url, init: init ?? {} });
    if (opts.offline) throw new TypeError('Load failed');
    if (opts.status) return json(opts.status, { error: { message: `status ${opts.status}` } });
    if (url.endsWith('/models')) return json(200, { object: 'list', data: [{ id: 'qwen3:30b', object: 'model' }, { id: 'qwen3:8b', object: 'model' }] });
    return new Response(streamBody(ollamaSse(['Hel', 'lo.']), 9), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
}

const req = (signal = new AbortController().signal) => ({ model: 'qwen3:30b', system: 'sys', messages: [{ role: 'user' as const, content: 'hi' }], maxTokens: 500, signal });

describe('CustomDriver', () => {
  it('lists the endpoint\'s models with the context window the user entered', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const models = await new CustomDriver({ baseUrl: 'https://model.example.test/v1/', contextWindow: 32_768, fetch: fakeServer(seen) }).listModels();
    expect(seen[0]!.url).toBe('https://model.example.test/v1/models');
    expect(models).toEqual([
      { id: 'qwen3:30b', label: 'qwen3:30b', contextWindow: 32_768, supportsStreaming: true },
      { id: 'qwen3:8b', label: 'qwen3:8b', contextWindow: 32_768, supportsStreaming: true },
    ]);
  });

  it('streams the answer, puts the system prompt first, asks for usage, and sends the key only when there is one', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const got = await collect(new CustomDriver({ baseUrl: 'https://model.example.test/v1', apiKey: 'k-1', contextWindow: 32_768, fetch: fakeServer(seen) }).complete(req()));
    expect(got.text).toBe('Hello.');
    expect(got.done).toEqual({ type: 'done', usage: { inputTokens: 120, outputTokens: 7 }, stopReason: 'stop' });
    expect(seen[0]!.url).toBe('https://model.example.test/v1/chat/completions');
    expect((seen[0]!.init.headers as Record<string, string>)['Authorization']).toBe('Bearer k-1');
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual({
      model: 'qwen3:30b', max_tokens: 500, stream: true, stream_options: { include_usage: true },
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
    });

    const bare: Array<{ url: string; init: RequestInit }> = [];
    await collect(new CustomDriver({ baseUrl: 'https://model.example.test/v1', contextWindow: 8_192, fetch: fakeServer(bare) }).complete(req()));
    expect((bare[0]!.init.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('names itself in its errors, typed as the other providers\' are', async () => {
    const auth = new CustomDriver({ baseUrl: 'https://m.test/v1', contextWindow: 1, fetch: fakeServer([], { status: 401 }) }).listModels();
    await expect(auth).rejects.toBeInstanceOf(ProviderAuthError);
    const down = new CustomDriver({ baseUrl: 'https://m.test/v1', contextWindow: 1, fetch: fakeServer([], { offline: true }) }).listModels();
    await expect(down).rejects.toBeInstanceOf(ProviderNetworkError);
    await expect(new CustomDriver({ baseUrl: 'https://m.test/v1', contextWindow: 1, fetch: fakeServer([], { offline: true }) }).listModels()).rejects.toThrow(/^Your model: Load failed$/);
  });
});
