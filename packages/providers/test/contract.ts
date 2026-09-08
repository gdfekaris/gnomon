// The provider contract (spec §8.1, §17): one suite for every ProviderDriver.
// A scenario describes what the fake server does; each provider's test file
// serialises it in that provider's wire format.

import { describe, expect, it } from 'vitest';
import { ProviderAuthError, ProviderNetworkError, ProviderRateLimitError, ProviderUnavailableError, type CompletionEvent, type ProviderDriver } from '../src/index';

export interface Scenario {
  /** text deltas the server streams, in order */
  deltas?: string[];
  usage?: { input: number; output: number };
  stopReason?: string;
  /** respond with this HTTP status and message instead of streaming */
  status?: number;
  retryAfter?: number;
  /** throw from fetch */
  offline?: boolean;
  /** split the SSE bytes into chunks of this many bytes (multi-byte characters may be cut) */
  chunkBytes?: number;
  /** wait for this promise before sending each chunk (lets a test abort mid-stream) */
  gate?: () => Promise<void>;
  models?: Array<{ id: string; label: string; contextWindow: number }>;
}

export type ProviderFactory = (scenario: Scenario) => ProviderDriver;

/** Serve `text` as a streaming body in `chunkBytes` pieces. */
export function streamBody(text: string, chunkBytes = 7, gate?: () => Promise<void>): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      if (gate) await gate();
      controller.enqueue(bytes.slice(offset, offset + chunkBytes));
      offset += chunkBytes;
    },
  });
}

export async function collect(events: AsyncIterable<CompletionEvent>): Promise<{ text: string; done: Extract<CompletionEvent, { type: 'done' }> | null; events: CompletionEvent[] }> {
  const all: CompletionEvent[] = [];
  let text = '';
  let done: Extract<CompletionEvent, { type: 'done' }> | null = null;
  for await (const e of events) {
    all.push(e);
    if (e.type === 'text') text += e.text;
    else done = e;
  }
  return { text, done, events: all };
}

const request = (signal = new AbortController().signal) => ({ model: 'm', system: 'You are a test.', messages: [{ role: 'user' as const, content: 'Hello — ünïcode 𝔘' }], maxTokens: 256, signal });

export function providerContract(name: string, factory: ProviderFactory): void {
  describe(`${name} (provider contract, spec §8.1)`, () => {
    it('streams text deltas in order and ends with usage, even when the network cuts events and characters', async () => {
      const deltas = ['Hel', 'lo, ', 'wörld — 𝔘', '!'];
      for (const chunkBytes of [1, 3, 7, 1024]) {
        const d = factory({ deltas, usage: { input: 12, output: 5 }, stopReason: 'end_turn', chunkBytes });
        const r = await collect(d.complete(request()));
        expect(r.text, `chunk ${chunkBytes}`).toBe('Hello, wörld — 𝔘!');
        expect(r.events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text), `chunk ${chunkBytes}`).toEqual(deltas);
        expect(r.done).toEqual({ type: 'done', usage: { inputTokens: 12, outputTokens: 5 }, stopReason: 'end_turn' });
        expect(r.events.at(-1)!.type).toBe('done');
      }
    });

    it('stops when the request is aborted mid-stream', async () => {
      const controller = new AbortController();
      let sent = 0;
      const gate = async () => {
        sent++;
        if (sent === 3) controller.abort();
      };
      const d = factory({ deltas: ['one ', 'two ', 'three ', 'four'], chunkBytes: 40, gate });
      const seen: string[] = [];
      const err = await (async () => {
        try {
          for await (const e of d.complete(request(controller.signal))) if (e.type === 'text') seen.push(e.text);
        } catch (e) {
          return e as Error;
        }
        return null;
      })();
      expect(err?.name).toBe('AbortError');
      expect(seen.length).toBeLessThan(4);
    });

    it('maps 401 and 403 to ProviderAuthError, 429 to ProviderRateLimitError with retry-after, 5xx to ProviderUnavailableError', async () => {
      await expect(collect(factory({ status: 401 }).complete(request()))).rejects.toBeInstanceOf(ProviderAuthError);
      await expect(collect(factory({ status: 403 }).complete(request()))).rejects.toBeInstanceOf(ProviderAuthError);
      const rl = await collect(factory({ status: 429, retryAfter: 30 }).complete(request())).catch((e: unknown) => e);
      expect(rl).toBeInstanceOf(ProviderRateLimitError);
      expect((rl as ProviderRateLimitError).retryAfterSeconds).toBe(30);
      await expect(collect(factory({ status: 529 }).complete(request()))).rejects.toBeInstanceOf(ProviderUnavailableError);
      await expect(factory({ status: 401 }).listModels()).rejects.toBeInstanceOf(ProviderAuthError);
    });

    it('a failed fetch is a ProviderNetworkError', async () => {
      await expect(collect(factory({ offline: true }).complete(request()))).rejects.toBeInstanceOf(ProviderNetworkError);
    });

    it('listModels reports ids, labels, and context windows', async () => {
      const models = await factory({ models: [{ id: 'big', label: 'Big', contextWindow: 200_000 }, { id: 'small', label: 'Small', contextWindow: 8_192 }] }).listModels();
      expect(models.map((m) => [m.id, m.label, m.contextWindow, m.supportsStreaming])).toEqual([['big', 'Big', 200_000, true], ['small', 'Small', 8_192, true]]);
    });
  });
}
