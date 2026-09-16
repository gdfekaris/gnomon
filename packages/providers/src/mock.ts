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

/**
 * Task C (spec §8.5, schema §7.6) for the demo: a well-formed filing reply
 * built from the capture. Zero to four principles for the reserve by the
 * passage's length, one per seven words: a sentence yields none, the
 * fixture's capture three, so the flows see both ends.
 */
export function demoFilingScript(req: CompletionRequest): string {
  const context = req.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n\n');
  const capture = (context.split(/^## The capture\n/m)[1] ?? '').replace(/^Curator's note: .*\n+/m, '').replace(/^An attachment .*\n+/m, '').trim();
  const firstLine = capture.split('\n').find((l) => l.trim()) ?? 'Untitled capture';
  const title = firstLine.replace(/^#+\s*/, '').split(/\s+/).slice(0, 6).join(' ').replace(/[.,;:!?]+$/, '');
  const words = capture.split(/\s+/).filter(Boolean).length;
  const n = Math.min(4, Math.floor(words / 7));
  const PREFIXES = ['Act on it', 'Remember', 'Keep to it'];
  const proposals: unknown[] = [];
  for (let i = 0; i < n; i++) {
    const t = i === 0 ? `What "${title}" asks of me` : `${PREFIXES[(i - 1) % PREFIXES.length]!}: ${title}`;
    proposals.push({ title: t, rationale: `The demo model suggests a principle wherever a capture makes a claim (${i + 1} of ${n} for this one). It goes to the reserve; decide whether you hold it.` });
  }
  return JSON.stringify({ meta: { title: title || 'Untitled capture', author: 'unknown', tags: ['demo'] }, proposals });
}

/**
 * Task F (schema §7.15) for the demo: a link from every passage to the
 * first principle it was shown, an amendment to the second when there is
 * one, and a principle for the set from the first passage's first sentence.
 */
export function demoRelateSetScript(req: CompletionRequest): string {
  const context = req.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n\n');
  const refs = [...context.matchAll(/^- ref `([^`]+)`/gm)].map((m) => m[1]!);
  const passages = [...context.matchAll(/^### Passage: (.+?) — [^\n]*\nslug: `([^`]+)`\n\n([\s\S]*?)(?=\n### Passage:|$)/gm)].map((m) => ({ title: m[1]!, slug: m[2]!, body: m[3]! }));
  const proposals: unknown[] = [];
  const slugs = passages.map((p) => p.slug);
  if (refs[0] && slugs.length) proposals.push({ kind: 'link', title: `Ground ${refs[0].split('/')[1]} in ${passages.length === 1 ? 'this passage' : 'these passages'}`, target: refs[0], grounds: slugs, rationale: 'The demo model offers the passages as evidence for the first principle it was shown. Accepting adds them to the grounds.' });
  if (refs[1] && slugs.length) proposals.push({ kind: 'amendment', title: `Reword ${refs[1].split('/')[1]} in the light of ${passages[0]!.title}`, target: refs[1], grounds: [slugs[0]!], rationale: 'The demo model suggests the passage complicates the second principle it was shown. Reword it if you agree.' });
  const first = passages[0];
  if (first) {
    const sentence = (first.body.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/)[0] ?? first.title).replace(/[.!?,;:]+$/, '').slice(0, 60);
    proposals.push({ kind: 'principle', title: `Hold to this: ${sentence}`, grounds: [first.slug], rationale: `The demo model took the first sentence of "${first.title}" as a principle the set lacks. Decide whether you hold it.` });
  }
  return JSON.stringify({ proposals });
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

/** Task E for the demo: three principles per passage, each from one of its first sentences, grounded in it. */
export function demoDeriveScript(req: CompletionRequest): string {
  const context = req.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n\n');
  const principles: Array<{ title: string; rationale: string; grounds: string[] }> = [];
  const seen = new Set<string>();
  for (const m of context.matchAll(/^### Passage: (.+?) — [^\n]*\nslug: `([^`]+)`\n\n([\s\S]*?)(?=\n### Passage:|$)/gm)) {
    const [, title, slug, body] = m as unknown as [string, string, string, string];
    const sentences = body.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).filter((x) => x.length > 8).slice(0, 3);
    if (sentences.length === 0) continue;
    // Three per passage: one per sentence, and a short passage's first sentence turned three ways.
    const PREFIXES = ['Hold to this', 'Act on it', 'Remember'];
    for (let i = 0; i < 3; i++) {
      const sentence = sentences[i] ?? sentences[0]!;
      const prefix = sentences[i] ? 'Hold to this' : PREFIXES[i]!;
      let t = `${prefix}: ${sentence.replace(/[.!?,;:]+$/, '').slice(0, 60)}`;
      if (seen.has(t.toLowerCase())) t = `${t} (${i + 1})`;
      seen.add(t.toLowerCase());
      principles.push({ title: t, rationale: `The demo model took sentence ${Math.min(i + 1, sentences.length)} of "${title}" as it stands. Decide whether you hold it.`, grounds: [slug] });
    }
  }
  return JSON.stringify({ principles });
}

/** The default script: a filing reply for Task C, a derive reply for Task E, a relate-to-set reply for Task F, otherwise a cited answer that names precedence. */
export function demoScript(req: CompletionRequest): string {
  if (req.system.startsWith('You are filing a capture')) return demoFilingScript(req);
  if (req.system.startsWith('You are deriving principles')) return demoDeriveScript(req);
  if (req.system.startsWith('You are relating passages')) return demoRelateSetScript(req);
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
