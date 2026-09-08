import { describe, expect, it } from 'vitest';
import type { BrainFile, InboxFm, ProposalFm, SourceFm } from '../src/index';
import { FILING_PROMPT, FilingReplyError, applyBatch, buildFiling, buildFilingPrompt, extractJson, parseFilingReply, validateBatch, validateSnapshot } from '../src/index';
import { FIXTURE, readBrain, snapshotFromDisk, snapshotOf } from './brains';

const s = snapshotFromDisk(FIXTURE, 'head1');
const fixture = readBrain(FIXTURE);
const capture = s.files.get('inbox/20260906-070000-2bq.md') as BrainFile<InboxFm>;
const NOW = '2026-09-07T12:00:00Z';

const GOOD = {
  meta: { title: 'Join the dance', author: 'Alan Watts', work: 'The Wisdom of Insecurity', year: 1951, tags: ['Change', 'flow'] },
  proposals: [
    { kind: 'principle', title: 'Move with change', target_set: 'ps-g8xw', rationale: 'Set 1 says nothing about change.' },
    { kind: 'link', title: 'Grounds courage', target_set: 'ps-g8xw', target: 'ps-g8xw/courage-before-comfort', grounds: ['weil-attention'], rationale: 'Same move.' },
    { kind: 'tag', title: 'Tag it', rationale: 'Groups with the Stoics.' },
  ],
};

describe('buildFilingPrompt (spec §8.5)', () => {
  it('shows sets with principles and refs, source slugs, the note, and the capture, never the attachment', () => {
    const r = buildFilingPrompt(s, capture, 100_000);
    if (!r.ok) throw new Error(r.error);
    expect(r.system).toBe(FILING_PROMPT);
    expect(r.context).toContain('### Set 2 — Work — set slug: ps-7k2m');
    expect(r.context).toContain('- ref `ps-7k2m/say-the-hard-thing-first` — Say the hard thing first');
    expect(r.context).toContain('  In any piece of work, the sentence I am avoiding');
    expect(r.context).toContain('- `didion-why-i-write` — To find out what I\'m thinking, Joan Didion');
    expect(r.context).toContain("Curator's note: Heard this quoted; find the source.");
    expect(r.context.endsWith('The only way to make sense out of change is to plunge into it, move with\nit, and join the dance.')).toBe(true);
    expect(r.tokensUsed).toBeGreaterThan(0);
  });
  it('mentions an attachment without showing it and refuses a capture over budget', () => {
    const withPdf = s.files.get('inbox/20260902-190433-p9r.md') as BrainFile<InboxFm>;
    const r = buildFilingPrompt(s, withPdf, 100_000);
    if (!r.ok) throw new Error(r.error);
    expect(r.context).toContain('An attachment (20260902-190433-p9r.pdf) is kept beside the capture; it is not shown to you.');
    expect(buildFilingPrompt(s, capture, 100)).toMatchObject({ ok: false, error: 'CAPTURE_EXCEEDS_BUDGET', budgetTokens: 100 });
  });
  it('an empty set is shown as such', () => {
    const empty = snapshotOf(fixture, { 'principles/ps-7k2m/say-the-hard-thing-first.md': null, 'principles/ps-7k2m/write-to-find-out.md': null });
    const r = buildFilingPrompt(empty, empty.files.get(capture.path) as BrainFile<InboxFm>, 100_000);
    expect(r.ok && r.context).toContain('### Set 2 — Work — set slug: ps-7k2m\n\n(no principles yet)');
  });
});

describe('parseFilingReply (spec §8.5)', () => {
  it('accepts a good reply, normalises tags, and tolerates fences and prose', () => {
    const parsed = parseFilingReply(JSON.stringify(GOOD), s);
    expect(parsed.meta).toEqual({ title: 'Join the dance', author: 'Alan Watts', work: 'The Wisdom of Insecurity', year: 1951, tags: ['change', 'flow'] });
    expect(parsed.proposals).toEqual([
      { kind: 'principle', title: 'Move with change', target_set: 'ps-g8xw', rationale: 'Set 1 says nothing about change.' },
      { kind: 'link', title: 'Grounds courage', target_set: 'ps-g8xw', target: 'ps-g8xw/courage-before-comfort', grounds: ['weil-attention'], rationale: 'Same move.' },
      { kind: 'tag', title: 'Tag it', rationale: 'Groups with the Stoics.' },
    ]);
    const wrapped = `Here you go:\n\n\`\`\`json\n${JSON.stringify(GOOD, null, 2)}\n\`\`\`\n\nLet me know.`;
    expect(parseFilingReply(wrapped, s).meta.title).toBe('Join the dance');
    expect(extractJson('{"a": 1} trailing')).toEqual({ a: 1 });
    expect(parseFilingReply('{"meta": {"title": "T", "author": "unknown"}}').proposals).toEqual([]);
  });

  it('refuses malformed and hallucinated replies with a reason', () => {
    const cases: Array<[unknown, RegExp]> = [
      ['no json here', /no JSON object/],
      ['{"meta": }', /not valid JSON/],
      [{ meta: { title: 'T' } }, /'author' is required/],
      [{ meta: { title: 'T', author: 'A', isbn: 'x' } }, /unknown key 'isbn'/],
      [{ meta: { title: 'T', author: 'A' }, extra: 1 }, /unknown top-level key 'extra'/],
      [{ meta: { title: 'T', author: 'A', year: '1951' } }, /'year' must be an integer/],
      [{ meta: { title: 'T', author: 'A', tags: ['Not A Tag'] } }, /not a lowercase hyphenated slug/],
      [{ meta: { title: 'T', author: 'A', slug: 'Bad Slug' } }, /slug 'Bad Slug' is malformed/],
      [{ meta: { title: 'T', author: 'A' }, proposals: {} }, /'proposals' must be a list/],
      [{ meta: { title: 'T', author: 'A' }, proposals: [{ kind: 'wish', title: 't', rationale: 'r' }] }, /kind must be/],
      [{ meta: { title: 'T', author: 'A' }, proposals: [{ kind: 'principle', title: 't', rationale: 'r' }] }, /requires target_set/],
      [{ meta: { title: 'T', author: 'A' }, proposals: [{ kind: 'principle', title: 't', target_set: 'ps-zzzz', rationale: 'r' }] }, /not a set in this brain/],
      [{ meta: { title: 'T', author: 'A' }, proposals: [{ kind: 'link', title: 't', target_set: 'ps-g8xw', rationale: 'r' }] }, /requires target/],
      [{ meta: { title: 'T', author: 'A' }, proposals: [{ kind: 'link', title: 't', target_set: 'ps-g8xw', target: 'ps-g8xw/invented', rationale: 'r' }] }, /not a principle in this brain/],
      [{ meta: { title: 'T', author: 'A' }, proposals: [{ kind: 'link', title: 't', target_set: 'ps-7k2m', target: 'ps-g8xw/courage-before-comfort', rationale: 'r' }] }, /not in target_set/],
      [{ meta: { title: 'T', author: 'A' }, proposals: [{ kind: 'tag', title: 't', rationale: 'r', grounds: ['nope-nope'] }] }, /not a source in this brain/],
      [{ meta: { title: 'T', author: 'A' }, proposals: [{ kind: 'tag', title: 't', rationale: 'r', mood: 'x' }] }, /unknown key 'mood'/],
      [{ meta: { title: 'T', author: 'A' }, proposals: [{ kind: 'tag', title: 't' }] }, /'rationale' is required/],
    ];
    for (const [input, pattern] of cases) {
      const text = typeof input === 'string' ? input : JSON.stringify(input);
      expect(() => parseFilingReply(text, s), text).toThrow(pattern);
      try {
        parseFilingReply(text, s);
      } catch (e) {
        expect(e).toBeInstanceOf(FilingReplyError);
      }
    }
    // without a snapshot, only shape is checked
    expect(parseFilingReply(JSON.stringify({ meta: { title: 'T', author: 'A' }, proposals: [{ kind: 'principle', title: 't', target_set: 'ps-zzzz', rationale: 'r' }] })).proposals[0]!.target_set).toBe('ps-zzzz');
  });

  it('a parsed reply files end to end through buildFiling and validates', () => {
    const { meta, proposals } = parseFilingReply(JSON.stringify(GOOD), s);
    const batch = buildFiling(s, capture, meta, proposals, { now: NOW });
    expect(batch.message).toBe('File: watts-join-the-dance');
    expect(validateBatch(s, batch)).toEqual([]);
    const after = applyBatch(s, batch);
    expect(validateSnapshot(after)).toEqual([]);
    expect((after.files.get('sources/watts-join-the-dance/raw.md')!.fm as SourceFm).tags).toEqual(['change', 'flow']);
    expect(after.files.get('sources/watts-join-the-dance/raw.md')!.body).toBe(capture.body);
    const tag = after.files.get('maps/proposals/P-20260907-003.md')!.fm as ProposalFm;
    expect(tag).toMatchObject({ kind: 'tag', target: 'watts-join-the-dance', from_source: 'watts-join-the-dance' });
  });
});
