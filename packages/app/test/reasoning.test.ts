import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type TreeEntry, buildSnapshot, isFrontmatterPath } from '@gnomon/core';
import { MOCK_MODEL, MockProvider, ProviderAuthError, type ProviderDriver } from '@gnomon/providers';
import { ReasoningService, type ReasoningState, describeAssemblyError } from '../src/lib/services/reasoning';
import { renderAnswer } from '../src/lib/markdown';

const here = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE = join(here, '..', '..', 'core', 'fixtures', 'brain');
const all = new Map<string, string>();
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else all.set(relative(FIXTURE, full).split('\\').join('/'), readFileSync(full, 'utf8'));
  }
};
walk(FIXTURE);
const tree: TreeEntry[] = [...all.keys()].map((path) => ({ path, sha: '', size: 1 }));
const texts = new Map([...all].filter(([p]) => isFrontmatterPath(p)).map(([p, text]) => [p, { text, sha: '' }]));
const snapshot = buildSnapshot({ head: 'h', tree, texts });
const fresh = (): ReasoningState => ({ transcript: [], streaming: false, error: null, preview: null });

describe('ReasoningService (spec §8.3, §10.2)', () => {
  it('offers the demo model always and the others only with a key', () => {
    expect(new ReasoningService(fresh()).providerIds).toEqual(['mock']);
    expect(new ReasoningService(fresh(), { anthropic: 'k' }).providerIds).toEqual(['mock', 'anthropic']);
    expect(new ReasoningService(fresh(), { anthropic: 'k', openrouter: 'o' }).providerIds).toEqual(['mock', 'anthropic', 'openrouter']);
  });

  it('previews the assembly against the model window and budget percent', async () => {
    const state = fresh();
    const svc = new ReasoningService(state);
    expect((await svc.listModels('mock'))[0]).toEqual(MOCK_MODEL);
    expect(ReasoningService.budget(MOCK_MODEL, 60)).toBe(19_200);
    const r = svc.preview(snapshot, 'reason', ['ps-7k2m', 'ps-g8xw'], 'q', MOCK_MODEL, 60, 'context');
    expect(r?.ok && r.included.filter((x) => x.startsWith('principles/')).length).toBe(4);
    expect(state.preview).toBe(r);
    const tiny = svc.preview(snapshot, 'reason', ['ps-7k2m'], 'q', { ...MOCK_MODEL, contextWindow: 500 }, 60, 'context');
    expect(tiny && !tiny.ok && tiny.error).toBe('SETS_EXCEED_BUDGET');
    expect(describeAssemblyError(tiny as never)).toContain('never truncated');
    expect(svc.preview(snapshot, 'reason', [], 'q', MOCK_MODEL, 60, 'context')).toBeNull();
  });

  it('runs a task through the mock provider, streams into the transcript, and resolves citations', async () => {
    const state = fresh();
    const svc = new ReasoningService(state);
    const answer = await svc.run(snapshot, 'mock', MOCK_MODEL, 'reason', ['ps-7k2m', 'ps-g8xw'], 'Should I start with the hard part?', 60, 'context');
    expect(state.transcript.length).toBe(2);
    expect(state.transcript[0]).toMatchObject({ role: 'user', text: 'Should I start with the hard part?', sets: ['ps-7k2m', 'ps-g8xw'] });
    expect(state.transcript[0]!.assembly?.ok).toBe(true);
    expect(answer!.text).toContain('Reasoning from each set separately: Set 1, Set 2 — Work.');
    expect(answer!.text).toContain('invoking precedence');
    expect(answer!.citations.map((c) => [c.ref, c.resolved])).toEqual([
      ['principles/ps-g8xw/courage-before-comfort', true],
      ['sources/aurelius-meditations-4-3/raw', true],
      ['principles/ps-g8xw/attention-is-generosity', true],
    ]);
    expect(state.streaming).toBe(false);
    expect(state.error).toBeNull();
    // a follow-up carries the prior turns as history
    const mock = new MockProvider({ script: (req) => `history: ${req.messages.length}` });
    const svc2 = new ReasoningService(state, {}, mock);
    const second = await svc2.run(snapshot, 'mock', MOCK_MODEL, 'free', ['ps-7k2m'], 'and then?', 60, 'context');
    expect(second!.text).toBe('history: 3');
    expect(mock.requests[0]!.messages.at(-1)!.content).toContain('## Message\nand then?');
  });

  it('reports an assembly error without sending, and a provider error after', async () => {
    const state = fresh();
    const svc = new ReasoningService(state);
    expect(await svc.run(snapshot, 'mock', { ...MOCK_MODEL, contextWindow: 500 }, 'reason', ['ps-7k2m'], 'q', 60, 'context')).toBeNull();
    expect(state.error).toContain('never truncated');
    expect(state.transcript).toEqual([]);
    const failing: ProviderDriver = { id: 'mock', listModels: async () => [MOCK_MODEL], complete: async function* () { throw new ProviderAuthError('bad key'); } };
    const svc2 = new ReasoningService(state, {}, failing);
    await svc2.run(snapshot, 'mock', MOCK_MODEL, 'reason', ['ps-7k2m'], 'q', 60, 'context');
    expect(state.error).toBe('bad key');
    expect(state.transcript.length).toBe(2);
  });

  it('stop aborts the stream and marks the answer', async () => {
    const state = fresh();
    const svc = new ReasoningService(state, {}, new MockProvider({ script: () => 'x'.repeat(500), chunk: 10, delayMs: 5 }));
    const p = svc.run(snapshot, 'mock', MOCK_MODEL, 'reason', ['ps-7k2m'], 'q', 60, 'context');
    await new Promise((r) => setTimeout(r, 20));
    svc.stop();
    const answer = await p;
    expect(answer!.text.endsWith('(stopped)')).toBe(true);
    expect(answer!.text.length).toBeLessThan(520);
    expect(state.error).toBeNull();
  });

  it('renderAnswer links resolvable citations and marks the rest as plain text', () => {
    const html = renderAnswer('See [[principles/ps-7k2m/say-the-hard-thing-first]] and [[principles/ps-7k2m/invented]].', snapshot);
    expect(html).toContain('<a href="#/browse/principles/ps-7k2m/say-the-hard-thing-first.md">Say the hard thing first</a>');
    expect(html).toContain('<code>⚠ principles/ps-7k2m/invented</code> (not in this brain)');
    expect(html.match(/<a /g)!.length).toBe(1);
  });
});
