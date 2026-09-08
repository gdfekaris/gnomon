import { describe, expect, it } from 'vitest';
import { ANTHROPIC_DEFAULT_CONTEXT, ANTHROPIC_VERSION, AnthropicDriver, ProviderError, anthropicContextWindow } from '../src/index';
import { type Scenario, collect, providerContract, streamBody } from './contract';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** Anthropic's SSE wire format for a scenario. */
export function anthropicSse(s: Scenario): string {
  const ev = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  let out = ev('message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', content: [], model: 'm', usage: { input_tokens: s.usage?.input ?? 0, output_tokens: 1 } } });
  out += ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  out += 'event: ping\ndata: {"type": "ping"}\n\n';
  for (const t of s.deltas ?? []) out += ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } });
  out += ev('content_block_stop', { type: 'content_block_stop', index: 0 });
  out += ev('message_delta', { type: 'message_delta', delta: { stop_reason: s.stopReason ?? 'end_turn', stop_sequence: null }, usage: { output_tokens: s.usage?.output ?? 0 } });
  out += ev('message_stop', { type: 'message_stop' });
  return out;
}

export function anthropicFetch(s: Scenario, seen: Array<{ url: string; init: RequestInit }> = []): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    seen.push({ url, init: init ?? {} });
    if (s.offline) throw new TypeError('fetch failed');
    if (s.status) return json(s.status, { type: 'error', error: { type: 'x', message: `status ${s.status}` } }, s.retryAfter ? { 'retry-after': String(s.retryAfter) } : {});
    if (url.includes('/v1/models')) {
      return json(200, { data: (s.models ?? []).map((m) => ({ id: m.id, display_name: m.label, max_input_tokens: m.contextWindow, max_tokens: 4096 })), has_more: false });
    }
    return new Response(streamBody(anthropicSse(s), s.chunkBytes ?? 7, s.gate), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
}

providerContract('AnthropicDriver', (s) => new AnthropicDriver({ apiKey: 'sk-test', fetch: anthropicFetch(s) }));

describe('AnthropicDriver specifics (spec §8.1)', () => {
  it('sends the key, the version, the browser-access header, and a streaming messages body', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const d = new AnthropicDriver({ apiKey: 'sk-test', fetch: anthropicFetch({ deltas: ['x'] }, seen) });
    await collect(d.complete({ model: 'claude-opus-5', system: 'sys', messages: [{ role: 'user', content: 'hi' }], maxTokens: 999, signal: new AbortController().signal }));
    expect(seen[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    const h = seen[0]!.init.headers as Record<string, string>;
    expect(h['x-api-key']).toBe('sk-test');
    expect(h['anthropic-version']).toBe(ANTHROPIC_VERSION);
    expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual({ model: 'claude-opus-5', max_tokens: 999, stream: true, system: 'sys', messages: [{ role: 'user', content: 'hi' }] });
  });

  it('a refusal stop reason is reported on the done event', async () => {
    const r = await collect(new AnthropicDriver({ apiKey: 'k', fetch: anthropicFetch({ deltas: [], stopReason: 'refusal', usage: { input: 3, output: 0 } }) }).complete({ model: 'm', system: '', messages: [{ role: 'user', content: 'x' }], maxTokens: 10, signal: new AbortController().signal }));
    expect(r.done).toMatchObject({ stopReason: 'refusal' });
  });

  it('an error event mid-stream becomes a ProviderError', async () => {
    const sse = 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\nevent: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n';
    const fetchFn: typeof fetch = async () => new Response(streamBody(sse, 50), { status: 200 });
    await expect(collect(new AnthropicDriver({ apiKey: 'k', fetch: fetchFn }).complete({ model: 'm', system: '', messages: [], maxTokens: 10, signal: new AbortController().signal }))).rejects.toThrow(/Overloaded/);
  });

  it('listModels prefers the reported max_input_tokens, falls back to the family table, then the default, and follows pages', async () => {
    const pages = [
      { data: [{ id: 'claude-opus-5', display_name: 'Claude Opus 5', max_input_tokens: 1_000_000, max_tokens: 128_000 }, { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' }], has_more: true, last_id: 'claude-haiku-4-5' },
      { data: [{ id: 'claude-unknown-9', display_name: 'Future' }], has_more: false },
    ];
    const urls: string[] = [];
    const fetchFn: typeof fetch = async (input) => { urls.push(String(input)); return json(200, pages.shift()); };
    const models = await new AnthropicDriver({ apiKey: 'k', fetch: fetchFn }).listModels();
    expect(models.map((m) => [m.id, m.contextWindow, m.maxOutputTokens])).toEqual([['claude-opus-5', 1_000_000, 128_000], ['claude-haiku-4-5', 200_000, undefined], ['claude-unknown-9', ANTHROPIC_DEFAULT_CONTEXT, undefined]]);
    expect(urls[1]).toContain('after_id=claude-haiku-4-5');
    expect(anthropicContextWindow('claude-sonnet-4-6')).toBe(1_000_000);
    expect(anthropicContextWindow('claude-sonnet-4-6', 500)).toBe(500);
    expect(new ProviderError('x')).toBeInstanceOf(Error);
  });
});
