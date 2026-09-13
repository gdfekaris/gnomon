// MockProvider — not in the spec, but spec §17's flows assume one, and it
// lets the demo brain reason without a key. Replays a script deterministically;
// the default script reads the ref comments in the assembled context and
// writes a plausible, cited answer.

import { estimateTokens } from '@gnomon/core';
import type { CompletionEvent, CompletionRequest, ModelInfo, ProviderDriver } from './driver';

export type MockScript = (req: CompletionRequest) => string;

export interface MockProviderOptions {
  script?: MockScript;
  /** characters per streamed chunk; default 24 */
  chunk?: number;
  /** milliseconds between chunks; default 0 */
  delayMs?: number;
  models?: ModelInfo[];
}

export const MOCK_MODEL: ModelInfo = { id: 'mock-reasoner', label: 'Demo model (no key needed)', contextWindow: 32_000, supportsStreaming: true };

const refsIn = (text: string, prefix: string) => [...text.matchAll(/<!-- ref: ([^\s>]+) -->/g)].map((m) => m[1]!).filter((r) => r.startsWith(prefix));

/** Task C (spec §8.5) for the demo: a well-formed filing reply built from the capture and the first set it was shown. */
export function demoFilingScript(req: CompletionRequest): string {
  const context = req.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n\n');
  const capture = (context.split(/^## The capture\n/m)[1] ?? '').replace(/^Curator's note: .*\n+/m, '').replace(/^An attachment .*\n+/m, '').trim();
  const firstLine = capture.split('\n').find((l) => l.trim()) ?? 'Untitled capture';
  const title = firstLine.replace(/^#+\s*/, '').split(/\s+/).slice(0, 6).join(' ').replace(/[.,;:!?]+$/, '');
  const set = /set slug: (ps-[^\s]+)/.exec(context)?.[1];
  const ref = /- ref `(ps-[^`]+)`/.exec(context)?.[1];
  const proposals: unknown[] = [{ kind: 'tag', title: 'Tag as a demo filing', rationale: 'Filed by the demo model; retag by hand.' }];
  if (set) proposals.push({ kind: 'principle', title: `What "${title}" asks of me`, target_set: set, rationale: 'The demo model suggests a principle wherever a capture makes a claim. Decide whether you hold it.' });
  // A ground for the first principle it was shown (schema §4.7: a link proposal proposes a ground).
  if (ref) proposals.push({ kind: 'link', title: `Ground ${ref.split('/')[1]} in this passage`, target_set: ref.split('/')[0], target: ref, rationale: 'The demo model offers the capture as evidence for the first principle it was shown. Accepting adds it to the grounds.' });
  return JSON.stringify({ meta: { title: title || 'Untitled capture', author: 'unknown', tags: ['demo'] }, proposals });
}

/** The relate task's four sections (prompts §relate), with the Proposal given as the labeled lines the app saves from. */
function demoRelateScript(input: string, principles: string[], passages: string[]): string {
  const sentence = (input.split(/(?<=[.!?])\s/)[0] ?? input).trim().slice(0, 120);
  const set = principles[0]?.split('/')[1] ?? 'ps-g8xw';
  return [
    '1. Agrees',
    principles[0] ? `The text supports [[${principles[0]}]] in spirit.` : 'The selected set has no principles to agree with.',
    '',
    '2. Challenges',
    principles[1] ? `It presses against [[${principles[1]}]]: it asks for the opposite emphasis.` : 'It challenges nothing in the set.',
    '',
    '3. Echoes and contradicts',
    passages[0] ? `It echoes [[${passages[0]}]].` : 'No included passage is echoed.',
    '',
    '4. Proposal',
    'Kind: principle',
    `Target set: ${set}`,
    `Wording: ${sentence || 'Untitled'}`,
    'Rationale: The demo model proposes a principle wherever a new text makes a claim. Decide whether you hold it.',
    '',
    '(This is the demo model. Connect a provider in Settings for real reasoning.)',
  ].join('\n');
}

/** The default script: a filing reply for the Task C prompt, otherwise a cited answer that names precedence. */
export function demoScript(req: CompletionRequest): string {
  if (req.system.startsWith('You are filing a capture')) return demoFilingScript(req);
  const context = req.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n\n');
  const principles = refsIn(context, 'principles/');
  const passages = refsIn(context, 'sources/');
  const sets = [...context.matchAll(/^## (Set \d+.*)$/gm)].map((m) => m[1]!);
  const input = (context.split(/^## (?:Question|New text|Message)\n/m)[1] ?? '').trim();
  if (/^## New text$/m.test(context)) return demoRelateScript(input, principles, passages);
  const lines: string[] = [];
  if (sets.length > 1) lines.push(`Reasoning from each set separately: ${sets.join(', ')}.`, '');
  if (principles.length) {
    lines.push(`The governing premise here is [[${principles[0]}]]${passages[0] ? `, grounded in [[${passages[0]}]]` : ', which stands ungrounded'}.`);
    if (principles[1]) lines.push(`[[${principles[1]}]] pulls the other way; naming that tension, and invoking precedence, the lower-numbered principle governs.`);
  } else lines.push('The selected set has no principles to reason from.');
  if (input) lines.push('', `Applied to "${input.slice(0, 80)}${input.length > 80 ? '…' : ''}": the principles argue for the harder, earlier move.`);
  lines.push('', '(This is the demo model. Connect a provider in Settings for real reasoning.)');
  return lines.join('\n');
}

export class MockProvider implements ProviderDriver {
  readonly id = 'mock' as const;
  readonly requests: CompletionRequest[] = [];
  private readonly script: MockScript;
  private readonly chunk: number;
  private readonly delayMs: number;
  private readonly models: ModelInfo[];

  constructor(opts: MockProviderOptions = {}) {
    this.script = opts.script ?? demoScript;
    this.chunk = opts.chunk ?? 24;
    this.delayMs = opts.delayMs ?? 0;
    this.models = opts.models ?? [MOCK_MODEL];
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.models;
  }

  async *complete(req: CompletionRequest): AsyncIterable<CompletionEvent> {
    this.requests.push(req);
    const text = this.script(req);
    for (let i = 0; i < text.length; i += this.chunk) {
      req.signal.throwIfAborted();
      if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
      yield { type: 'text', text: text.slice(i, i + this.chunk) };
    }
    yield { type: 'done', usage: { inputTokens: estimateTokens(req.system + req.messages.map((m) => m.content).join('')), outputTokens: estimateTokens(text) }, stopReason: 'end_turn' };
  }
}
