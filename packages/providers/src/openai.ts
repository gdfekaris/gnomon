// The OpenAI-style chat completions stream, shared by the OpenRouter driver
// and the custom endpoint driver (Ollama and other local or self-hosted
// servers speak the same wire format): SSE data events of deltas, an
// optional usage object, then [DONE].

import type { CompletionEvent } from './driver';
import { ProviderError } from './errors';
import { readSse } from './sse';

export async function* readChatCompletionStream(res: Response, signal: AbortSignal, who: string): AsyncIterable<CompletionEvent> {
  if (!res.body) throw new ProviderError(`${who}: empty response body`);
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: string | undefined;
  for await (const ev of readSse(res.body, signal)) {
    if (ev.data === '[DONE]') break;
    const data = JSON.parse(ev.data) as { choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } };
    if (data.error) throw new ProviderError(`${who}: ${data.error.message ?? 'stream error'}`);
    const choice = data.choices?.[0];
    if (choice?.delta?.content) yield { type: 'text', text: choice.delta.content };
    if (choice?.finish_reason) stopReason = choice.finish_reason;
    if (data.usage) {
      inputTokens = data.usage.prompt_tokens ?? inputTokens;
      outputTokens = data.usage.completion_tokens ?? outputTokens;
    }
  }
  yield { type: 'done', usage: { inputTokens, outputTokens }, ...(stopReason ? { stopReason } : {}) };
}
