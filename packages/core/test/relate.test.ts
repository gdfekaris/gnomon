import { describe, expect, it } from 'vitest';
import type { ProposalFm } from '../src/index';
import { RELATE_MAX, RELATE_PROMPT, RelateReplyError, applyBatch, buildRelate, buildRelatePrompt, parseRelateReply, validateBatch, validateSnapshot } from '../src/index';
import { FIXTURE, readBrain, snapshotFromDisk, snapshotOf } from './brains';

// Relate sources to a set — Task F (schema §7.15): the deliberate act that filing no longer guesses at.
const s = snapshotFromDisk(FIXTURE, 'head1');
const fixture = readBrain(FIXTURE);
const NOW = '2026-09-16T12:00:00Z';
const SET = 'ps-g8xw';
const SOURCES = ['weil-attention', 'didion-why-i-write'];
const GOOD = {
  proposals: [
    { kind: 'link', title: 'Didion grounds courage', target: 'ps-g8xw/courage-before-comfort', grounds: ['didion-why-i-write'], rationale: 'Same move.' },
    { kind: 'amendment', title: 'Say generosity costs something', target: 'ps-g8xw/attention-is-generosity', grounds: ['weil-attention'], rationale: 'Weil says attention is rare.' },
    { kind: 'principle', title: 'Write to see what I think', grounds: ['didion-why-i-write', 'weil-attention'], rationale: 'Didion says so.' },
  ],
};

describe('buildRelatePrompt', () => {
  it('shows the set with refs, bodies, and current grounds, then the passages in full', () => {
    const r = buildRelatePrompt(s, SOURCES, SET, 100_000);
    if (!r.ok) throw new Error(r.error);
    expect(r.system).toBe(RELATE_PROMPT);
    expect(r.context.startsWith('## The set: Set 1 — set slug: ps-g8xw\n\n(no description)\n\n## The principles it holds\n\n- ref `ps-g8xw/courage-before-comfort` — Courage before comfort\n  When the comfortable choice')).toBe(true);
    expect(r.context).toContain('  grounds: `aurelius-meditations-4-3`');
    expect(r.context).toContain('### Passage: Attention as generosity — Simone Weil\nslug: `weil-attention`');
    expect(r.context).toContain('### Passage: To find out what I\'m thinking — Joan Didion (Why I Write, 1976)\nslug: `didion-why-i-write`');
    expect(r.passages).toBe(2);
    expect(r.principlesOmitted).toBe(0);
  });
  it('passages must fit; principles trim from the end and say so; unknown set or source throws', () => {
    const tight = buildRelatePrompt(s, SOURCES, SET, 900);
    if (!tight.ok) throw new Error(tight.error);
    expect(tight.principlesOmitted).toBeGreaterThan(0);
    expect(tight.context).toContain('more not shown, for room');
    expect(buildRelatePrompt(s, SOURCES, SET, 200)).toMatchObject({ ok: false, error: 'SOURCES_EXCEED_BUDGET' });
    expect(() => buildRelatePrompt(s, SOURCES, 'ps-zzzz', 100_000)).toThrow(/no set/);
    expect(() => buildRelatePrompt(s, ['nope-nope'], SET, 100_000)).toThrow(/no source/);
    const empty = snapshotOf(fixture, { 'principles/ps-7k2m/say-the-hard-thing-first.md': null, 'principles/ps-7k2m/write-to-find-out.md': null });
    const r = buildRelatePrompt(empty, SOURCES, 'ps-7k2m', 100_000);
    expect(r.ok && r.context).toContain('## The principles it holds\n\n(none)');
  });
});

describe('parseRelateReply', () => {
  it('accepts a good reply, drops an exact duplicate, and allows an empty list', () => {
    const out = parseRelateReply(JSON.stringify(GOOD), s, SOURCES, SET);
    expect(out).toEqual([
      { kind: 'link', title: 'Didion grounds courage', target: 'ps-g8xw/courage-before-comfort', grounds: ['didion-why-i-write'], rationale: 'Same move.\n' },
      { kind: 'amendment', title: 'Say generosity costs something', target: 'ps-g8xw/attention-is-generosity', grounds: ['weil-attention'], rationale: 'Weil says attention is rare.\n' },
      { kind: 'principle', title: 'Write to see what I think', grounds: ['didion-why-i-write', 'weil-attention'], rationale: 'Didion says so.\n' },
    ]);
    const twice = { proposals: [GOOD.proposals[0], GOOD.proposals[0]] };
    expect(parseRelateReply(JSON.stringify(twice), s, SOURCES, SET).length).toBe(1);
    expect(parseRelateReply('{"proposals": []}', s, SOURCES, SET)).toEqual([]);
    expect(parseRelateReply('```json\n{}\n```', s, SOURCES, SET)).toEqual([]);
  });
  it('refuses every hallucination with a reason', () => {
    const one = (p: unknown) => JSON.stringify({ proposals: [p] });
    const cases: Array<[string, RegExp]> = [
      ['not json', /no JSON object/],
      ['{"principles": []}', /unknown top-level key/],
      ['{"proposals": {}}', /must be a list/],
      [JSON.stringify({ proposals: Array.from({ length: RELATE_MAX + 1 }, (_, i) => ({ kind: 'principle', title: `P${i}`, grounds: ['weil-attention'], rationale: 'r' })) }), /at most 10/],
      [one({ kind: 'tag', title: 't', grounds: ['weil-attention'], rationale: 'r' }), /kind must be link, amendment, or principle/],
      [one({ kind: 'link', title: 't', target: 'ps-7k2m/say-the-hard-thing-first', grounds: ['weil-attention'], rationale: 'r' }), /not a principle of Set 1/],
      [one({ kind: 'link', title: 't', target: 'ps-g8xw/nope', grounds: ['weil-attention'], rationale: 'r' }), /not a principle of Set 1/],
      [one({ kind: 'link', title: 't', target: 'ps-g8xw/attention-is-generosity', grounds: ['weil-attention'], rationale: 'r' }), /already lists weil-attention among its grounds/],
      [one({ kind: 'amendment', title: 't', grounds: ['weil-attention'], rationale: 'r' }), /target 'undefined' is not a principle/],
      [one({ kind: 'principle', title: 't', target: 'ps-g8xw/courage-before-comfort', grounds: ['weil-attention'], rationale: 'r' }), /names no target/],
      [one({ kind: 'principle', title: 'courage before COMFORT', grounds: ['weil-attention'], rationale: 'r' }), /already holds/],
      [one({ kind: 'principle', title: 't', grounds: ['aurelius-meditations-4-3'], rationale: 'r' }), /not one of the passages shown/],
      [one({ kind: 'principle', title: 't', grounds: [], rationale: 'r' }), /at least one of the passages/],
      [one({ kind: 'principle', title: 'a\nb', grounds: ['weil-attention'], rationale: 'r' }), /one line/],
      [one({ kind: 'principle', title: 't', grounds: ['weil-attention'] }), /'rationale' is required/],
      [one({ kind: 'principle', title: 't', grounds: ['weil-attention'], rationale: 'r', mood: 'x' }), /unknown key 'mood'/],
    ];
    for (const [text, pattern] of cases) {
      expect(() => parseRelateReply(text, s, SOURCES, SET), text).toThrow(pattern);
      try {
        parseRelateReply(text, s, SOURCES, SET);
      } catch (e) {
        expect(e).toBeInstanceOf(RelateReplyError);
      }
    }
    expect(() => parseRelateReply('{"proposals": []}', s, SOURCES, 'ps-zzzz')).toThrow(/no set/);
  });
});

describe('buildRelate (schema §7.15)', () => {
  it('writes one proposal per entry for the set, with grounds and no from_source, in one commit that validates', () => {
    const entries = parseRelateReply(JSON.stringify(GOOD), s, SOURCES, SET);
    const batch = buildRelate(s, SET, entries, { now: NOW });
    expect(batch.message).toBe('Relate: 3 proposals for Set 1');
    expect(batch.writes.map((w) => w.path)).toEqual(['maps/proposals/P-20260916-001.md', 'maps/proposals/P-20260916-002.md', 'maps/proposals/P-20260916-003.md', 'maps/_index.md']);
    expect(validateBatch(s, batch)).toEqual([]);
    const after = applyBatch(s, batch);
    expect(validateSnapshot(after)).toEqual([]);
    const fms = ['001', '002', '003'].map((n) => after.files.get(`maps/proposals/P-20260916-${n}.md`)!.fm as ProposalFm);
    expect(fms[0]).toMatchObject({ kind: 'link', target_set: SET, target: 'ps-g8xw/courage-before-comfort', grounds: ['didion-why-i-write'], status: 'open', curated: 'agent-proposed' });
    expect(fms[1]).toMatchObject({ kind: 'amendment', target_set: SET, target: 'ps-g8xw/attention-is-generosity', grounds: ['weil-attention'] });
    expect(fms[2]).toMatchObject({ kind: 'principle', target_set: SET, grounds: ['didion-why-i-write', 'weil-attention'] });
    expect(fms.every((f) => f.from_source === undefined)).toBe(true);
    expect(after.files.get('maps/proposals/P-20260916-001.md')!.body).toBe('Same move.\n');
    expect(buildRelate(s, SET, entries.slice(0, 1), { now: NOW }).message).toBe('Relate: 1 proposal for Set 1');
    expect(() => buildRelate(s, SET, [], { now: NOW })).toThrow(/nothing to propose/);
    expect(() => buildRelate(s, 'ps-zzzz', entries, { now: NOW })).toThrow(/no set/);
  });
});
