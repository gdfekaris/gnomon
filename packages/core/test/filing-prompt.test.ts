import { describe, expect, it } from 'vitest';
import type { BrainFile, InboxFm, ProposalFm, SourceFm } from '../src/index';
import { FILING_MAX, FILING_PROMPT, FilingReplyError, applyBatch, buildFiling, buildFilingPrompt, extractJson, parseFilingReply, tagVocabulary, validateBatch, validateSnapshot } from '../src/index';
import { FIXTURE, readBrain, snapshotFromDisk, snapshotOf } from './brains';

const s = snapshotFromDisk(FIXTURE, 'head1');
const fixture = readBrain(FIXTURE);
const capture = s.files.get('inbox/20260906-070000-2bq.md') as BrainFile<InboxFm>;
const NOW = '2026-09-07T12:00:00Z';

// Filing is clerical and local to the passage (schema §7.6, 2026-09-16): metadata with tags from the
// brain's vocabulary, and at most four principles the passage alone supports, for the reserve.
const GOOD = {
  meta: { title: 'Join the dance', author: 'Alan Watts', work: 'The Wisdom of Insecurity', year: 1951, tags: ['Change', 'flow'] },
  proposals: [
    { title: 'Move with change', rationale: 'The passage says the only way through change is into it.' },
    { kind: 'principle', title: 'Join the dance', rationale: 'Its closing image.' },
  ],
};

describe('buildFilingPrompt (spec §8.5)', () => {
  it('shows the tag vocabulary with counts, the note, and the capture; never a set, a source list, or the attachment', () => {
    const r = buildFilingPrompt(s, capture, 100_000);
    if (!r.ok) throw new Error(r.error);
    expect(r.system).toBe(FILING_PROMPT);
    expect(r.context.startsWith('## Tags in use\n\n- stoicism (3)\n- attention (2)\n')).toBe(true);
    expect(r.context).not.toContain('set slug');
    expect(r.context).not.toContain('ps-g8xw');
    expect(r.context).not.toContain('didion-why-i-write');
    expect(r.context).toContain("Curator's note: Heard this quoted; find the source.");
    // The note is where the phone's capture form asks for the author and work; the model must take them from it.
    expect(r.system).toContain("The curator's note, when there is one, is authoritative");
    expect(r.system).toContain(`up to ${FILING_MAX}`);
    expect(r.context.endsWith('The only way to make sense out of change is to plunge into it, move with\nit, and join the dance.')).toBe(true);
    expect(r.tokensUsed).toBeGreaterThan(0);
  });
  it('tagVocabulary counts every file type, most used first then by name', () => {
    expect(tagVocabulary(s)).toEqual([['stoicism', 3], ['attention', 2], ['solitude', 1], ['thinking', 1], ['work', 1], ['writing', 1]]);
  });
  it('mentions an attachment without showing it and refuses a capture over budget', () => {
    const withPdf = s.files.get('inbox/20260902-190433-p9r.md') as BrainFile<InboxFm>;
    const r = buildFilingPrompt(s, withPdf, 100_000);
    if (!r.ok) throw new Error(r.error);
    expect(r.context).toContain('An attachment (20260902-190433-p9r.pdf) is kept beside the capture; it is not shown to you.');
    expect(buildFilingPrompt(s, capture, 100)).toMatchObject({ ok: false, error: 'CAPTURE_EXCEEDS_BUDGET', budgetTokens: 100 });
  });
  it('a brain with no tags says so, and the prompt does not grow with the principles', () => {
    const bare = snapshotOf(fixture, Object.fromEntries([...fixture.keys()].filter((p) => /^(sources|principles\/ps-|principles\/_reserve)/.test(p)).map((p) => [p, null])));
    const r = buildFilingPrompt(bare, bare.files.get(capture.path) as BrainFile<InboxFm>, 100_000);
    expect(r.ok && r.context.startsWith('## Tags in use\n\n(none yet)\n')).toBe(true);
    const full = buildFilingPrompt(s, capture, 100_000);
    expect(r.ok && full.ok && full.tokensUsed - r.tokensUsed).toBeLessThan(40); // only the tag lines differ
  });
});

describe('parseFilingReply (spec §8.5)', () => {
  it('accepts a good reply, normalises tags, targets the reserve, drops a duplicate title, and tolerates fences and prose', () => {
    const parsed = parseFilingReply(JSON.stringify(GOOD));
    expect(parsed.meta).toEqual({ title: 'Join the dance', author: 'Alan Watts', work: 'The Wisdom of Insecurity', year: 1951, tags: ['change', 'flow'] });
    expect(parsed.proposals).toEqual([
      { kind: 'principle', title: 'Move with change', target_set: '_reserve', rationale: 'The passage says the only way through change is into it.' },
      { kind: 'principle', title: 'Join the dance', target_set: '_reserve', rationale: 'Its closing image.' },
    ]);
    const wrapped = `Here you go:\n\n\`\`\`json\n${JSON.stringify(GOOD, null, 2)}\n\`\`\`\n\nLet me know.`;
    expect(parseFilingReply(wrapped).meta.title).toBe('Join the dance');
    expect(extractJson('{"a": 1} trailing')).toEqual({ a: 1 });
    expect(parseFilingReply('{"meta": {"title": "T", "author": "unknown"}}').proposals).toEqual([]);
    const dup = { meta: GOOD.meta, proposals: [{ title: 'Same', rationale: 'a' }, { title: 'same', rationale: 'b' }] };
    expect(parseFilingReply(JSON.stringify(dup)).proposals.map((p) => p.title)).toEqual(['Same']);
    const four = { meta: GOOD.meta, proposals: [1, 2, 3, 4].map((i) => ({ title: `P${i}`, rationale: 'r' })) };
    expect(parseFilingReply(JSON.stringify(four)).proposals.length).toBe(FILING_MAX);
  });

  it('refuses malformed replies, a fifth principle, and any other kind of proposal, with a reason', () => {
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
      [{ meta: { title: 'T', author: 'A' }, proposals: [1, 2, 3, 4, 5].map((i) => ({ title: `P${i}`, rationale: 'r' })) }, /proposes 5 principles; a filing proposes at most 4/],
      [{ meta: { title: 'T', author: 'A' }, proposals: [{ kind: 'link', title: 't', target_set: 'ps-g8xw', target: 'ps-g8xw/courage-before-comfort', rationale: 'r' }] }, /only principles for the reserve/],
      [{ meta: { title: 'T', author: 'A' }, proposals: [{ kind: 'tag', title: 't', rationale: 'r' }] }, /kind 'tag' is not proposed at filing/],
      [{ meta: { title: 'T', author: 'A' }, proposals: [{ kind: 'amendment', title: 't', rationale: 'r' }] }, /kind 'amendment' is not proposed at filing/],
      [{ meta: { title: 'T', author: 'A' }, proposals: [{ title: 't', target_set: 'ps-g8xw', rationale: 'r' }] }, /unknown key 'target_set'/],
      [{ meta: { title: 'T', author: 'A' }, proposals: [{ title: 't', rationale: 'r', grounds: ['weil-attention'] }] }, /unknown key 'grounds'/],
      [{ meta: { title: 'T', author: 'A' }, proposals: [{ title: 'two\nlines', rationale: 'r' }] }, /'title' must be one line/],
      [{ meta: { title: 'T', author: 'A' }, proposals: [{ title: 't' }] }, /'rationale' is required/],
      [{ meta: { title: 'T', author: 'A' }, proposals: ['t'] }, /must be an object/],
    ];
    for (const [input, pattern] of cases) {
      const text = typeof input === 'string' ? input : JSON.stringify(input);
      expect(() => parseFilingReply(text), text).toThrow(pattern);
      try {
        parseFilingReply(text);
      } catch (e) {
        expect(e).toBeInstanceOf(FilingReplyError);
      }
    }
  });

  it('a parsed reply files end to end through buildFiling: reserve proposals grounded in the new source, tags on the source', () => {
    const { meta, proposals } = parseFilingReply(JSON.stringify(GOOD));
    const batch = buildFiling(s, capture, meta, proposals, { now: NOW });
    expect(batch.message).toBe('File: watts-join-the-dance');
    expect(validateBatch(s, batch)).toEqual([]);
    const after = applyBatch(s, batch);
    expect(validateSnapshot(after)).toEqual([]);
    expect((after.files.get('sources/watts-join-the-dance/raw.md')!.fm as SourceFm).tags).toEqual(['change', 'flow']);
    expect(after.files.get('sources/watts-join-the-dance/raw.md')!.body).toBe(capture.body);
    const first = after.files.get('maps/proposals/P-20260907-001.md')!.fm as ProposalFm;
    expect(first).toMatchObject({ kind: 'principle', title: 'Move with change', target_set: '_reserve', from_source: 'watts-join-the-dance', grounds: ['watts-join-the-dance'], status: 'open', curated: 'agent-proposed' });
    expect(after.files.get('maps/proposals/P-20260907-003.md')).toBeUndefined();
    expect(after.byType('proposal').filter((p) => p.fm.target_set === '_reserve').length).toBe(2);
  });
});
