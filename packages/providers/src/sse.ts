// A minimal server-sent-events reader over a fetch body. Handles events split
// across network chunks, multi-byte characters split across chunks, comment
// lines, multi-line `data:` fields, and cancellation through an AbortSignal.

export interface SseEvent { event: string; data: string; }

export async function* readSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const onAbort = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + (buffer[sep] === '\r' ? 4 : 2));
        const event = parseBlock(raw);
        if (event) yield event;
      }
    }
    // A cancelled reader reports done with a truncated buffer; surface the abort, not a parse error.
    signal?.throwIfAborted();
    const tail = parseBlock(buffer + decoder.decode());
    if (tail) yield tail;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

function parseBlock(raw: string): SseEvent | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return data.length ? { event, data: data.join('\n') } : null;
}
