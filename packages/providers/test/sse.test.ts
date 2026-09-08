import { describe, expect, it } from 'vitest';
import { readSse } from '../src/index';
import { streamBody } from './contract';

async function all(text: string, chunk: number) {
  const out = [];
  for await (const e of readSse(streamBody(text, chunk))) out.push(e);
  return out;
}

describe('readSse', () => {
  it('parses events, comments, multi-line data, CRLF, and a final block without a trailing blank line', async () => {
    const text = ': comment\n\nevent: a\ndata: 1\n\ndata: x\ndata: y\n\nevent: b\r\ndata: {"k": "v"}\r\n\r\ndata: tail';
    for (const chunk of [1, 2, 5, 100]) {
      expect(await all(text, chunk), `chunk ${chunk}`).toEqual([
        { event: 'a', data: '1' },
        { event: 'message', data: 'x\ny' },
        { event: 'b', data: '{"k": "v"}' },
        { event: 'message', data: 'tail' },
      ]);
    }
  });
  it('yields nothing for an empty body', async () => {
    expect(await all('', 3)).toEqual([]);
  });
});
