import { describe, expect, it } from 'vitest';
import { type BrainFile, type ProposalFm, DeriveReplyError, buildDerive, buildDerivePrompt, estimateTokens, parseDeriveReply, parseFile, validateBatch } from '../src/index';
import { FIXTURE, snapshotFromDisk } from './brains';

const s = snapshotFromDisk(FIXTURE, 'head1');
const NOW = '2026-09-14T09:00:00Z';
const two = ['aurelius-meditations-4-3', 'weil-attention'];

describe('buildDerivePrompt (Task E)', () => {
  it('puts the set, what it holds, then the passages in full, and counts them', () => {
    const r = buildDerivePrompt(s, two, 'ps-g8xw', 100_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.passages).toBe(2);
    expect(r.principlesOmitted).toBe(0);
    expect(r.context.indexOf('## The target set: Set 1')).toBeLessThan(r.context.indexOf('## Principles the set already holds'));
    expect(r.context.indexOf('## Principles the set already holds')).toBeLessThan(r.context.indexOf('## The passages'));
    expect(r.context).toContain('- Courage before comfort');
    expect(r.context).toContain('### Passage: Retire into thyself — Marcus Aurelius (Meditations, 180)');
    expect(r.context).toContain('slug: `aurelius-meditations-4-3`');
    expect(r.context).toContain('Men seek retreats for themselves');
    expect(r.context).toContain('### Passage: Attention as generosity — Simone Weil');
    expect(r.tokensUsed).toBeGreaterThan(estimateTokens(r.context));
  });
  it('refuses a budget the passages do not fit, and trims held principles before passages', () => {
    const tiny = buildDerivePrompt(s, two, 'ps-g8xw', 200);
    expect(tiny.ok).toBe(false);
    if (tiny.ok) return;
    expect(tiny.error).toBe('SOURCES_EXCEED_BUDGET');
    expect(tiny.neededTokens).toBeGreaterThan(200);
    const full = buildDerivePrompt(s, two, 'ps-g8xw', 100_000);
    const justPassages = buildDerivePrompt(s, two, 'ps-g8xw', (full.ok ? full.tokensUsed : 0) - 20);
    expect(justPassages.ok).toBe(true);
    if (!justPassages.ok) return;
    expect(justPassages.principlesOmitted).toBeGreaterThan(0);
    expect(justPassages.context).toContain('more not shown, for room');
    expect(justPassages.context).toContain('Men seek retreats for themselves');
  });
  it('refuses an unknown set or source', () => {
    expect(() => buildDerivePrompt(s, ['nope'], 'ps-g8xw', 1000)).toThrow(/no source/);
    expect(() => buildDerivePrompt(s, two, 'ps-zzzz', 1000)).toThrow(/no set/);
  });
});

describe('parseDeriveReply', () => {
  const ok = (list: unknown[]) => JSON.stringify({ principles: list });
  const entry = (title: string, grounds = ['weil-attention']) => ({ title, rationale: 'Because the passage says so.', grounds });
  it('accepts a strict reply, trims, dedupes grounds and titles, ends rationales with one newline', () => {
    const out = parseDeriveReply(ok([entry(' Give attention freely '), { ...entry('Give attention FREELY'), grounds: ['weil-attention', 'weil-attention'] }, entry('Retreat is always available', ['aurelius-meditations-4-3'])]), s, two, 'ps-g8xw');
    expect(out).toEqual([
      { title: 'Give attention freely', rationale: 'Because the passage says so.\n', grounds: ['weil-attention'] },
      { title: 'Retreat is always available', rationale: 'Because the passage says so.\n', grounds: ['aurelius-meditations-4-3'] },
    ]);
  });
  it('tolerates a code fence around the JSON', () => {
    expect(parseDeriveReply('```json\n' + ok([entry('A')]) + '\n```', s, two, 'ps-g8xw')).toHaveLength(1);
  });
  it('refuses what the rules refuse', () => {
    const bad = (list: unknown, re: RegExp) => expect(() => parseDeriveReply(JSON.stringify({ principles: list }), s, two, 'ps-g8xw')).toThrow(re);
    bad([], /no principles/);
    bad(Array.from({ length: 21 }, (_, i) => entry(`P${i}`)), /at most 20/);
    bad([{ rationale: 'x', grounds: ['weil-attention'] }], /'title' is required/);
    bad([entry('Two\nlines')], /one line/);
    bad([{ title: 'A', grounds: ['weil-attention'] }], /'rationale' is required/);
    bad([entry('A', [])], /at least one/);
    bad([entry('A', ['didion-why-i-write'])], /not one of the passages shown/);
    bad([entry('Courage before comfort')], /already holds/);
    bad([{ ...entry('A'), extra: 1 }], /unknown key/);
    expect(() => parseDeriveReply('not json', s, two, 'ps-g8xw')).toThrow(DeriveReplyError);
    expect(() => parseDeriveReply(JSON.stringify({ principles: [], other: 1 }), s, two, 'ps-g8xw')).toThrow(/unknown top-level key/);
  });
});

describe('buildDerive (schema §7.12)', () => {
  it('writes one principle proposal per entry with sequential ids, grounds, no from_source, and the message', () => {
    const b = buildDerive(s, 'ps-g8xw', [
      { title: 'Give attention freely', rationale: 'Weil.\n', grounds: ['weil-attention'] },
      { title: 'Retreat is always available', rationale: 'Aurelius.\n', grounds: ['aurelius-meditations-4-3', 'weil-attention'] },
    ], { now: NOW });
    expect(b.message).toBe('Derive: 2 proposals for Set 1');
    expect(b.expectedHead).toBe('head1');
    expect(b.writes.map((w) => w.path)).toEqual(['maps/proposals/P-20260914-001.md', 'maps/proposals/P-20260914-002.md', 'maps/_index.md']);
    const p1 = parseFile(b.writes[0]!.path, (b.writes[0] as { text: string }).text) as BrainFile<ProposalFm>;
    expect(p1.fm).toMatchObject({ type: 'proposal', kind: 'principle', title: 'Give attention freely', target_set: 'ps-g8xw', grounds: ['weil-attention'], status: 'open', curated: 'agent-proposed', created: NOW });
    expect(p1.fm.from_source).toBeUndefined();
    expect(p1.body).toBe('Weil.\n');
    const p2 = parseFile(b.writes[1]!.path, (b.writes[1] as { text: string }).text) as BrainFile<ProposalFm>;
    expect(p2.fm.grounds).toEqual(['aurelius-meditations-4-3', 'weil-attention']);
    expect(validateBatch(s, b).filter((i) => i.level === 'refusal')).toEqual([]);
    expect(buildDerive(s, 'ps-7k2m', [{ title: 'One', rationale: 'r\n', grounds: ['weil-attention'] }], { now: NOW }).message).toBe('Derive: 1 proposal for Set 2 — Work');
  });
  it('refuses an unknown set or an empty list', () => {
    expect(() => buildDerive(s, 'ps-zzzz', [{ title: 'x', rationale: 'r\n', grounds: ['weil-attention'] }], { now: NOW })).toThrow(/no set/);
    expect(() => buildDerive(s, 'ps-g8xw', [], { now: NOW })).toThrow(/nothing to derive/);
  });
});
