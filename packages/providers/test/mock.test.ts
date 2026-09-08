import { describe, expect, it } from 'vitest';
import { MOCK_MODEL, MockProvider, demoScript } from '../src/index';
import { collect } from './contract';

const request = (content: string, signal = new AbortController().signal) => ({ model: 'mock-reasoner', system: 'rules', messages: [{ role: 'user' as const, content }], maxTokens: 100, signal });

describe('MockProvider', () => {
  it('replays a script deterministically in chunks and reports usage', async () => {
    const p = new MockProvider({ script: () => 'The quick brown fox jumps over the lazy dog.', chunk: 10 });
    const a = await collect(p.complete(request('x')));
    const b = await collect(p.complete(request('x')));
    expect(a.text).toBe('The quick brown fox jumps over the lazy dog.');
    expect(a.events.filter((e) => e.type === 'text').length).toBe(5);
    expect(a.done).toMatchObject({ usage: { outputTokens: 13 }, stopReason: 'end_turn' });
    expect(b.text).toBe(a.text);
    expect(p.requests.length).toBe(2);
    expect(await p.listModels()).toEqual([MOCK_MODEL]);
  });

  it('honours abort between chunks', async () => {
    const controller = new AbortController();
    const p = new MockProvider({ script: () => 'a'.repeat(100), chunk: 10 });
    const seen: string[] = [];
    const err = await (async () => {
      try {
        for await (const e of p.complete(request('x', controller.signal))) {
          if (e.type === 'text') seen.push(e.text);
          if (seen.length === 2) controller.abort();
        }
      } catch (e) {
        return e as Error;
      }
      return null;
    })();
    expect(err?.name).toBe('AbortError');
    expect(seen.length).toBe(2);
  });

  it('the demo script cites the refs it was given and names precedence', () => {
    const context = [
      '## Set 2 — Work', '### 1. Say the hard thing first\nbody\n<!-- ref: principles/ps-7k2m/say-the-hard-thing-first -->',
      '### 2. Write to find out\nbody\n<!-- ref: principles/ps-7k2m/write-to-find-out -->',
      '## Grounding passages', '### Passage: X — Y\ntext\n<!-- ref: sources/didion-why-i-write/raw -->',
      '## Question\nShould I start with the hard part?',
    ].join('\n\n');
    const text = demoScript(request(context));
    expect(text).toContain('[[principles/ps-7k2m/say-the-hard-thing-first]]');
    expect(text).toContain('[[sources/didion-why-i-write/raw]]');
    expect(text).toContain('[[principles/ps-7k2m/write-to-find-out]]');
    expect(text).toContain('invoking precedence');
    expect(text).toContain('Should I start with the hard part?');
    expect(text).not.toContain('Reasoning from each set separately');
    const two = demoScript(request('## Set 1\n\n### 1. A\n<!-- ref: principles/ps-g8xw/a -->\n\n## Set 2 — Work\n\n### 1. B\n<!-- ref: principles/ps-7k2m/b -->'));
    expect(two).toContain('Reasoning from each set separately: Set 1, Set 2 — Work.');
    expect(two).toContain('stands ungrounded');
    expect(demoScript(request('## Set 1\n\n(nothing)'))).toContain('no principles');
  });
});
