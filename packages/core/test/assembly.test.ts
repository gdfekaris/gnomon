import { describe, expect, it } from 'vitest';
import { MULTI_SET_RULES, PROMPTS, SHARED_RULES, assemble, estimateTokens, parseCitations } from '../src/index';
import { FIXTURE, readBrain, snapshotFromDisk, snapshotOf } from './brains';

const s = snapshotFromDisk(FIXTURE);
const fixture = readBrain(FIXTURE);
const BIG = 1_000_000;
const ok = (r: ReturnType<typeof assemble>) => {
  if (!r.ok) throw new Error(`assembly failed: ${r.error}`);
  return r;
};

describe('estimateTokens (spec §8.2)', () => {
  it('is ceil(bytes / 3.6)', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(2);
    expect(estimateTokens('a'.repeat(360))).toBe(100);
    expect(estimateTokens('é')).toBe(1);
  });
});

describe('system prompts (spec §8.3)', () => {
  it('every task carries the shared rules; multi-set rules are added only for several sets', () => {
    for (const p of Object.values(PROMPTS)) expect(p.startsWith(SHARED_RULES)).toBe(true);
    expect(SHARED_RULES).toContain('never write, reword, reorder, or delete a principle');
    expect(SHARED_RULES).toContain('[[ref]]');
    expect(SHARED_RULES).toContain('invoked precedence');
    expect(ok(assemble(s, 'reason', ['ps-7k2m'], 'q', BIG)).system).not.toContain(MULTI_SET_RULES);
    expect(ok(assemble(s, 'reason', ['ps-7k2m', 'ps-g8xw'], 'q', BIG)).system).toContain(MULTI_SET_RULES);
    expect(PROMPTS.relate).toContain('4. Proposal');
    expect(PROMPTS.compare).toContain('3. Gaps');
  });
});

describe('assemble (schema §8, spec §8.3)', () => {
  it('Task A over Set 2: sets verbatim, passages in order of first reference, question last', () => {
    const r = ok(assemble(s, 'reason', ['ps-7k2m'], 'Should I start with the hard part?', BIG));
    const raw = (slug: string) => fixture.get(`sources/${slug}/raw.md`)!.split('\n---\n')[1]!.replace(/\n+$/, '');
    const principle = (slug: string) => fixture.get(`principles/ps-7k2m/${slug}.md`)!.split('\n---\n')[1]!.replace(/\n+$/, '');
    expect(r.context).toBe([
      '## Set 2 — Work',
      'How I want to work, as distinct from how I want to live. Read these as\nconstraints on craft, not on character.',
      `### 1. Say the hard thing first\n${principle('say-the-hard-thing-first')}\n<!-- ref: principles/ps-7k2m/say-the-hard-thing-first -->`,
      `### 2. Write to find out\n${principle('write-to-find-out')}\n<!-- ref: principles/ps-7k2m/write-to-find-out -->`,
      '## Grounding passages',
      `### Passage: To find out what I'm thinking — Joan Didion\n${raw('didion-why-i-write')}\n<!-- ref: sources/didion-why-i-write/raw -->`,
      `### Passage: Retire into thyself — Marcus Aurelius\n${raw('aurelius-meditations-4-3')}\n<!-- ref: sources/aurelius-meditations-4-3/raw -->`,
      '## Question\nShould I start with the hard part?',
    ].join('\n\n'));
    expect(r.included).toEqual(['principles/ps-7k2m/say-the-hard-thing-first', 'principles/ps-7k2m/write-to-find-out', 'sources/didion-why-i-write/raw', 'sources/aurelius-meditations-4-3/raw']);
    expect(r.excluded).toEqual([]);
    expect(r.system).toBe(PROMPTS.reason);
    expect(r.tokensUsed).toBe(estimateTokens(r.system) + estimateTokens(r.context));
    expect(r.budgetTokens).toBe(BIG);
  });

  it('several sets go in set order, each under its label, with passages deduplicated across sets', () => {
    const r = ok(assemble(s, 'compare', ['ps-7k2m', 'ps-g8xw'], '', BIG));
    const headings = r.context.split('\n').filter((l) => l.startsWith('## '));
    expect(headings).toEqual(['## Set 1', '## Set 2 — Work', '## Grounding passages']);
    expect(r.included.filter((x) => x.startsWith('sources/'))).toEqual(['sources/aurelius-meditations-4-3/raw', 'sources/weil-attention/raw', 'sources/didion-why-i-write/raw']);
    expect(r.context).not.toContain('## Question');
    expect(r.system).toContain(MULTI_SET_RULES);
  });

  it('never truncates principles: SETS_EXCEED_BUDGET names what is needed', () => {
    const r = assemble(s, 'reason', ['ps-7k2m'], 'q', 50);
    expect(r).toMatchObject({ ok: false, error: 'SETS_EXCEED_BUDGET', budgetTokens: 50 });
    if (!r.ok && r.error === 'SETS_EXCEED_BUDGET') expect(r.neededTokens).toBeGreaterThan(50);
  });

  it('EMPTY_SET when a selected set has no principles, and unknown sets throw', () => {
    const empty = snapshotOf(fixture, { 'principles/ps-7k2m/say-the-hard-thing-first.md': null, 'principles/ps-7k2m/write-to-find-out.md': null });
    expect(assemble(empty, 'reason', ['ps-7k2m'], 'q', BIG)).toEqual({ ok: false, error: 'EMPTY_SET', set: 'ps-7k2m' });
    expect(() => assemble(s, 'reason', ['ps-zzzz'], 'q', BIG)).toThrow(/no principle set/);
    expect(() => assemble(s, 'reason', [], 'q', BIG)).toThrow(/at least one/);
  });

  /** The tokens the mandatory material needs: what SETS_EXCEED_BUDGET reports for an impossible budget. */
  const minimal = (task: 'reason' | 'relate' | 'compare', sets: string[], input = '') => {
    const r = assemble(s, task, sets, input, 1);
    if (r.ok || r.error !== 'SETS_EXCEED_BUDGET') throw new Error('expected SETS_EXCEED_BUDGET');
    return r.neededTokens;
  };

  it('passages fill in order until the next would not fit; the rest are named with notes or a title line', () => {
    // Set 2 grounds Didion (short) then Aurelius 4.3 (long). Room for Didion plus the Aurelius omitted entry with its notes.
    const full = ok(assemble(s, 'compare', ['ps-7k2m'], '', BIG));
    const didion = full.context.split('\n\n').find((c) => c.startsWith('### Passage: To find out'))!;
    const expectedTail = '### Retire into thyself — Marcus Aurelius\nGeorge Long translation. The retreat is inward, not a place; compare the\nmorning passage at [[sources/aurelius-meditations-5-1/raw]] ([raw](../aurelius-meditations-5-1/raw.md)).\n<!-- ref: sources/aurelius-meditations-4-3/raw -->';
    const setsOnly = full.context.split('\n\n## Grounding passages')[0]!;
    const budget = estimateTokens(PROMPTS.compare) + estimateTokens(`${setsOnly}\n\n## Grounding passages\n\n${didion}\n\n## Passages referenced but not included\n\n${expectedTail}`) + 1;
    const r = ok(assemble(s, 'compare', ['ps-7k2m'], '', budget));
    expect(r.included.filter((x) => x.startsWith('sources/'))).toEqual(['sources/didion-why-i-write/raw']);
    expect(r.excluded).toEqual(['sources/aurelius-meditations-4-3/raw']);
    expect(r.context.split('## Passages referenced but not included\n\n')[1]).toBe(expectedTail);
    expect(r.tokensUsed).toBeLessThanOrEqual(budget);
  });

  it('a passage that does not fit keeps every later one out, so order of first reference is honoured', () => {
    // Set 1 grounds Aurelius 4.3 (long) then Weil (one line). Budget for the mandatory material plus a little.
    const budget = minimal('compare', ['ps-g8xw']) + 30;
    const r = ok(assemble(s, 'compare', ['ps-g8xw'], '', budget));
    expect(r.included.filter((x) => x.startsWith('sources/'))).toEqual([]);
    expect(r.excluded).toEqual(['sources/aurelius-meditations-4-3/raw', 'sources/weil-attention/raw']);
    // the notes bodies would not fit, so the omitted section is title lines only
    expect(r.context).toContain('### Attention as generosity — Simone Weil\n<!-- ref: sources/weil-attention/raw -->');
    expect(r.context).not.toContain('Typed from memory');
    expect(r.tokensUsed).toBeLessThanOrEqual(budget);
  });

  it('the total never exceeds the budget at any budget', () => {
    const floor = minimal('compare', ['ps-7k2m', 'ps-g8xw']);
    for (let budget = floor; budget < floor + 900; budget += 37) {
      const r = assemble(s, 'compare', ['ps-7k2m', 'ps-g8xw'], '', budget);
      expect(r.ok, `budget ${budget}`).toBe(true);
      if (r.ok) expect(r.tokensUsed, `budget ${budget}`).toBeLessThanOrEqual(budget);
    }
    expect(assemble(s, 'compare', ['ps-7k2m', 'ps-g8xw'], '', floor - 1)).toMatchObject({ ok: false, error: 'SETS_EXCEED_BUDGET' });
  });

  it('Task B reserves the new text before passages and refuses text that cannot fit', () => {
    const text = 'x'.repeat(2000);
    const floor = minimal('relate', ['ps-7k2m'], text);
    const tooSmall = assemble(s, 'relate', ['ps-7k2m'], text, floor + 100);
    expect(tooSmall).toMatchObject({ ok: false, error: 'INPUT_EXCEEDS_BUDGET', remainingTokens: 100 });
    const justFits = ok(assemble(s, 'relate', ['ps-7k2m'], text, floor + estimateTokens(`\n\n## New text\n${text}`) + 20));
    expect(justFits.context.endsWith(`## New text\n${text}`)).toBe(true);
    expect(justFits.included.some((x) => x.startsWith('sources/'))).toBe(false);
    expect(justFits.excluded).toEqual(['sources/didion-why-i-write/raw', 'sources/aurelius-meditations-4-3/raw']);
    expect(justFits.tokensUsed).toBeLessThanOrEqual(floor + estimateTokens(`\n\n## New text\n${text}`) + 20);
  });

  it('Task D ignores input; free-form labels it as a message', () => {
    expect(ok(assemble(s, 'compare', ['ps-7k2m'], 'ignored', BIG)).context).not.toContain('ignored');
    expect(ok(assemble(s, 'free', ['ps-7k2m'], 'hello', BIG)).context.endsWith('## Message\nhello')).toBe(true);
    expect(ok(assemble(s, 'reason', ['ps-7k2m'], '   ', BIG)).context).not.toContain('## Question');
  });

  it('setDescriptionPlacement moves the _set.md body into the system prompt', () => {
    const ctx = ok(assemble(s, 'reason', ['ps-7k2m'], 'q', BIG));
    const sys = ok(assemble(s, 'reason', ['ps-7k2m'], 'q', BIG, { setDescriptionPlacement: 'system' }));
    expect(ctx.context).toContain('constraints on craft');
    expect(ctx.system).not.toContain('constraints on craft');
    expect(sys.context).not.toContain('constraints on craft');
    expect(sys.system).toContain("The curator's framing for each selected set:\n\n## Set 2 — Work\nHow I want to work");
    expect(sys.context.startsWith('## Set 2 — Work\n\n### 1.')).toBe(true);
  });

  it('a set with no description emits only its heading', () => {
    const r = ok(assemble(s, 'reason', ['ps-g8xw'], 'q', BIG));
    expect(r.context.startsWith('## Set 1\n\n### 1. Courage before comfort')).toBe(true);
  });

  it('a dangling grounds slug is listed as not included', () => {
    const p = 'principles/ps-7k2m/write-to-find-out.md';
    const dangling = snapshotOf(fixture, { [p]: fixture.get(p)!.replace('grounds: []', 'grounds:\n  - missing-one') });
    const r = ok(assemble(dangling, 'reason', ['ps-7k2m'], 'q', BIG));
    expect(r.excluded).toEqual(['sources/missing-one/raw']);
    expect(r.context).toContain('### missing-one\n<!-- ref: sources/missing-one/raw -->');
  });
});

describe('parseCitations (spec §8.4)', () => {
  it('resolves refs into the snapshot and flags the rest', () => {
    const text = 'See [[principles/ps-7k2m/say-the-hard-thing-first]] and [[sources/didion-why-i-write/raw#part]] but not [[principles/ps-7k2m/invented]].';
    const c = parseCitations(text, s);
    expect(c.map((x) => [x.ref, x.resolved, x.anchor])).toEqual([
      ['principles/ps-7k2m/say-the-hard-thing-first', true, undefined],
      ['sources/didion-why-i-write/raw', true, 'part'],
      ['principles/ps-7k2m/invented', false, undefined],
    ]);
    expect(text.slice(c[0]!.start, c[0]!.end)).toBe('[[principles/ps-7k2m/say-the-hard-thing-first]]');
    expect(c[0]!.path).toBe('principles/ps-7k2m/say-the-hard-thing-first.md');
  });
});
