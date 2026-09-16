import { describe, expect, it } from 'vitest';
import { DERIVE_PROMPT, FILING_PROMPT, RELATE_PROMPT, parseFilingReply } from '@gnomon/core';
import { MOCK_MODEL, MockProvider, demoFilingScript, demoScript } from '../src/index';
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

  it('answers the filing prompt with a reply parseFilingReply accepts', () => {
    const context = '## Tags in use\n\n- stoicism (3)\n\n## The capture\n\nCurator\'s note: from a train.\n\nThe only way to make sense out of change is to plunge into it.\nSecond line.';
    const req = { model: 'mock-reasoner', system: FILING_PROMPT, messages: [{ role: 'user' as const, content: context }], maxTokens: 100, signal: new AbortController().signal };
    expect(demoScript(req)).toBe(demoFilingScript(req));
    const parsed = parseFilingReply(demoScript(req));
    expect(parsed.meta).toEqual({ title: 'The only way to make sense', author: 'unknown', tags: ['demo'] });
    // fifteen words: two principles for the reserve, no tag or link proposal (schema §7.6)
    expect(parsed.proposals.map((p) => [p.kind, p.target_set, p.title])).toEqual([['principle', '_reserve', 'What "The only way to make sense" asks of me'], ['principle', '_reserve', 'Act on it: The only way to make sense']]);
    const short = { ...req, messages: [{ role: 'user' as const, content: '## Tags in use\n\n(none yet)\n\n## The capture\n\nA photographed page.' }] };
    expect(parseFilingReply(demoScript(short)).proposals).toEqual([]);
  });
  it('answers the relate-to-set prompt with a link, an amendment, and a principle', () => {
    const context = '## The set: Set 1 — set slug: ps-g8xw\n\n(no description)\n\n## The principles it holds\n\n- ref `ps-g8xw/a` — A\n- ref `ps-g8xw/b` — B\n\n## The passages\n\n### Passage: A — B (W, 1)\nslug: `a-b`\n\nFirst sentence here. Second sentence follows.\n\n### Passage: C — D\nslug: `c-d`\n\nOnly one.';
    const req = { model: 'mock-reasoner', system: RELATE_PROMPT, messages: [{ role: 'user' as const, content: context }], maxTokens: 100, signal: new AbortController().signal };
    const out = JSON.parse(demoScript(req)) as { proposals: Array<{ kind: string; target?: string; grounds: string[]; title: string }> };
    expect(out.proposals.map((p) => [p.kind, p.target, p.grounds])).toEqual([['link', 'ps-g8xw/a', ['a-b', 'c-d']], ['amendment', 'ps-g8xw/b', ['a-b']], ['principle', undefined, ['a-b']]]);
    expect(out.proposals[2]!.title).toBe('Hold to this: First sentence here');
  });
  it('answers the derive prompt with three grounded principles per passage', () => {
    const context = '## The target set: Set 1\n\n(no description)\n\n## Principles the set already holds\n\n(none)\n\n## The passages\n\n### Passage: A — B (W, 1)\nslug: `a-b`\n\nFirst sentence here. Second sentence follows. Third one too. Fourth is ignored.\n\n### Passage: C — D\nslug: `c-d`\n\nOnly one sentence that is long enough.';
    const req = { model: 'mock-reasoner', system: DERIVE_PROMPT, messages: [{ role: 'user' as const, content: context }], maxTokens: 100, signal: new AbortController().signal };
    const out = JSON.parse(demoScript(req)) as { principles: Array<{ title: string; grounds: string[] }> };
    expect(out.principles).toHaveLength(6);
    expect(out.principles.slice(0, 3).every((p) => p.grounds[0] === 'a-b')).toBe(true);
    expect(out.principles.slice(3).every((p) => p.grounds[0] === 'c-d')).toBe(true);
    expect(out.principles[0]!.title).toBe('Hold to this: First sentence here');
    expect(out.principles.slice(3).map((p) => p.title.split(':')[0])).toEqual(['Hold to this', 'Act on it', 'Remember']);
    expect(new Set(out.principles.map((p) => p.title)).size).toBe(6);
  });
});
