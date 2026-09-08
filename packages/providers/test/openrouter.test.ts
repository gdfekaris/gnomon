import { describe, expect, it } from 'vitest';
import { OpenRouterDriver } from '../src/index';
import { type Scenario, collect, providerContract, streamBody } from './contract';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** OpenRouter's SSE wire format: data-only events, a processing comment, usage in the last chunk, then [DONE]. */
export function openrouterSse(s: Scenario): string {
  let out = ': OPENROUTER PROCESSING\n\n';
  const chunk = (delta: Record<string, unknown>, extra: Record<string, unknown> = {}) => `data: ${JSON.stringify({ id: 'gen-1', object: 'chat.completion.chunk', model: 'm', choices: [{ index: 0, delta, finish_reason: null }], ...extra })}\n\n`;
  for (const t of s.deltas ?? []) out += chunk({ role: 'assistant', content: t });
  out += `data: ${JSON.stringify({ id: 'gen-1', choices: [{ index: 0, delta: { content: null }, finish_reason: s.stopReason ?? 'stop' }], usage: { prompt_tokens: s.usage?.input ?? 0, completion_tokens: s.usage?.output ?? 0 } })}\n\n`;
  out += 'data: [DONE]\n\n';
  return out;
}

export function openrouterFetch(s: Scenario, seen: Array<{ url: string; init: RequestInit }> = []): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    seen.push({ url, init: init ?? {} });
    if (s.offline) throw new TypeError('fetch failed');
    if (s.status) return json(s.status, { error: { message: `status ${s.status}`, code: s.status } }, s.retryAfter ? { 'retry-after': String(s.retryAfter) } : {});
    if (url.endsWith('/models')) return json(200, { data: (s.models ?? []).map((m) => ({ id: m.id, name: m.label, context_length: m.contextWindow, top_provider: { max_completion_tokens: 4096 } })) });
    return new Response(streamBody(openrouterSse(s), s.chunkBytes ?? 7, s.gate), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
}

// OpenRouter's finish_reason is 'stop' where Anthropic says 'end_turn'; the contract passes stopReason through.
providerContract('OpenRouterDriver', (s) => new OpenRouterDriver({ apiKey: 'or-test', fetch: openrouterFetch(s) }));

describe('OpenRouterDriver specifics (spec §8.1)', () => {
  it('sends the bearer token, referer, and title, and puts the system prompt first with usage requested', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const d = new OpenRouterDriver({ apiKey: 'or-test', fetch: openrouterFetch({ deltas: ['x'] }, seen), referer: 'https://example.test/app', title: 'Test App' });
    await collect(d.complete({ model: 'anthropic/claude-opus-5', system: 'sys', messages: [{ role: 'user', content: 'hi' }], maxTokens: 321, signal: new AbortController().signal }));
    expect(seen[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const h = seen[0]!.init.headers as Record<string, string>;
    expect(h['Authorization']).toBe('Bearer or-test');
    expect(h['HTTP-Referer']).toBe('https://example.test/app');
    expect(h['X-Title']).toBe('Test App');
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual({
      model: 'anthropic/claude-opus-5', max_tokens: 321, stream: true, usage: { include: true },
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
    });
  });

  it('listModels takes context_length and the completion cap', async () => {
    const models = await new OpenRouterDriver({ apiKey: 'k', fetch: openrouterFetch({ models: [{ id: 'a/b', label: 'A B', contextWindow: 131_072 }] }) }).listModels();
    expect(models).toEqual([{ id: 'a/b', label: 'A B', contextWindow: 131_072, maxOutputTokens: 4096, supportsStreaming: true }]);
  });

  it('an error object in a chunk becomes a ProviderError', async () => {
    const fetchFn: typeof fetch = async () => new Response(streamBody('data: {"error":{"message":"Provider returned error","code":502}}\n\n', 50), { status: 200 });
    await expect(collect(new OpenRouterDriver({ apiKey: 'k', fetch: fetchFn }).complete({ model: 'm', system: '', messages: [], maxTokens: 10, signal: new AbortController().signal }))).rejects.toThrow(/Provider returned error/);
  });
});
