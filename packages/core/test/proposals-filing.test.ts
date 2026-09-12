import { describe, expect, it } from 'vitest';
import type { BrainFile, CommitBatch, InboxFm, ProposalFm, SourceFm } from '../src/index';
import {
  ValidationError, applyBatch, buildFiling, buildProposal, decideProposal, nextProposalId, parseFile, proposeSourceSlug,
  uniqueSourceSlug, validateBatch, validateSnapshot,
} from '../src/index';
import { FIXTURE, readBrain, snapshotFromDisk, snapshotOf } from './brains';

const s = snapshotFromDisk(FIXTURE, 'head1');
const fixture = readBrain(FIXTURE);
const NOW = '2026-09-06T12:00:00Z';
const paths = (b: CommitBatch) => b.writes.map((w) => w.path);
const textOf = (b: CommitBatch, path: string) => {
  const w = b.writes.find((x) => x.path === path);
  if (!w || !('text' in w)) throw new Error(path);
  return w.text;
};

describe('proposals (spec §7.5)', () => {
  it('nextProposalId sequences within the UTC day and restarts each day', () => {
    expect(nextProposalId(s, '2026-09-05T23:59:59Z')).toBe('P-20260905-004');
    expect(nextProposalId(s, '2026-09-03T00:00:00Z')).toBe('P-20260903-002');
    expect(nextProposalId(s, '2026-09-06T00:00:00Z')).toBe('P-20260906-001');
    expect(nextProposalId(s, '2026-09-06T00:00:00Z', ['P-20260906-001', 'P-20260906-002'])).toBe('P-20260906-003');
  });
  it('buildProposal writes the canonical file and enforces kind-conditional fields', () => {
    const w = buildProposal({ id: 'P-20260906-001', kind: 'link', title: 'Link it', target_set: 'ps-g8xw', target: 'ps-g8xw/courage-before-comfort', from_source: 'weil-attention', grounds: ['weil-attention'], rationale: 'Because.\n', curated: 'agent-proposed', now: NOW });
    expect(w).toEqual({
      path: 'maps/proposals/P-20260906-001.md',
      text: '---\ntype: proposal\nkind: link\ntitle: Link it\ntarget_set: ps-g8xw\ntarget: ps-g8xw/courage-before-comfort\nfrom_source: weil-attention\ngrounds:\n  - weil-attention\nstatus: open\ncurated: agent-proposed\ncreated: 2026-09-06T12:00:00Z\nupdated: 2026-09-06T12:00:00Z\n---\nBecause.\n',
    });
    expect(() => buildProposal({ id: 'P-20260906-001', kind: 'principle', title: 'x', rationale: '', curated: 'human', now: NOW })).toThrow(ValidationError);
    expect(() => buildProposal({ id: 'nope', kind: 'tag', title: 'x', target: 'a-b', rationale: '', curated: 'human', now: NOW })).toThrow(ValidationError);
  });
  it('decideProposal rewrites status and updated only, and carries the index change', () => {
    const b = decideProposal(s, 'P-20260905-001', 'accepted', NOW);
    expect(b.message).toBe('Decide: P-20260905-001');
    expect(paths(b)).toEqual(['maps/proposals/P-20260905-001.md', 'maps/_index.md']);
    const before = s.files.get('maps/proposals/P-20260905-001.md')!;
    const after = parseFile('maps/proposals/P-20260905-001.md', textOf(b, 'maps/proposals/P-20260905-001.md'));
    expect(after.fm).toEqual({ ...before.fm, status: 'accepted', updated: NOW });
    expect(after.body).toBe(before.body);
    expect(validateBatch(s, b)).toEqual([]);
    expect(validateSnapshot(applyBatch(s, b))).toEqual([]);
    expect(textOf(b, 'maps/_index.md')).not.toContain('P-20260905-001');
    expect(() => decideProposal(s, 'P-19990101-001', 'declined', NOW)).toThrow(/no proposal/);
  });
  it('declining an already-decided proposal touches no index', () => {
    expect(paths(decideProposal(s, 'P-20260905-002', 'declined', NOW))).toEqual(['maps/proposals/P-20260905-002.md']);
  });
});

describe('source slugs (schema §3.1)', () => {
  it('proposeSourceSlug is surname plus a title fragment', () => {
    expect(proposeSourceSlug('Marcus Aurelius', 'Retire into thyself')).toBe('aurelius-retire-into-thyself');
    expect(proposeSourceSlug('Weil, Simone', 'Attention as generosity')).toBe('weil-attention-as-generosity');
    expect(proposeSourceSlug('Fekaris (curator)', 'What Is "the Meta"?')).toBe('fekaris-what-is-the-meta');
    expect(proposeSourceSlug('unknown', 'A very long title that keeps going and going')).toBe('unknown-a-very-long-title');
    expect(proposeSourceSlug('', 'Go')).toBe('unknown-go');
    expect(proposeSourceSlug('Émile Zola', 'J’accuse')).toBe('zola-j-accuse');
  });
  it('uniqueSourceSlug avoids sources, orphan notes, and attachment folders', () => {
    expect(uniqueSourceSlug(s, 'aurelius-meditations-4-3')).toBe('aurelius-meditations-4-3-2');
    expect(uniqueSourceSlug(s, 'fresh-slug')).toBe('fresh-slug');
    const withOrphan = snapshotOf(fixture, { 'sources/orphan-x/notes.md': '---\ntype: notes\nsource: orphan-x\ncurated: human\ncreated: 2026-09-05\nupdated: 2026-09-05\n---\n' });
    expect(uniqueSourceSlug(withOrphan, 'orphan-x')).toBe('orphan-x-2');
  });
});

describe('buildFiling (spec §7.6, schema §7.6)', () => {
  const capture = s.files.get('inbox/20260906-070000-2bq.md') as BrainFile<InboxFm>;
  const meta = { title: 'Join the dance', author: 'Alan Watts', work: 'The Wisdom of Insecurity', year: 1951, tags: ['change'] };
  const proposals = [
    { kind: 'principle' as const, title: 'Move with change', target_set: 'ps-g8xw', grounds: ['watts-join-the-dance'], rationale: 'Set 1 says nothing about change.\n' },
    { kind: 'tag' as const, title: 'Tag with flow', rationale: 'Groups it with the Stoic captures.\n' },
  ];

  it('a link proposal from a filing names the new source in its grounds: it proposes that source as a ground', () => {
    const link = { kind: 'link' as const, title: 'Ground courage in this', target_set: 'ps-g8xw', target: 'ps-g8xw/courage-before-comfort', rationale: 'Evidence.\n' };
    const b = buildFiling(s, capture, meta, [link], { now: NOW });
    const p = parseFile('maps/proposals/P-20260906-001.md', textOf(b, 'maps/proposals/P-20260906-001.md')) as BrainFile<ProposalFm>;
    expect(p.fm.kind).toBe('link');
    expect(p.fm.target).toBe('ps-g8xw/courage-before-comfort');
    expect(p.fm.from_source).toBe('watts-join-the-dance');
    expect(p.fm.grounds).toEqual(['watts-join-the-dance']);
    const other = buildFiling(s, capture, meta, [{ ...link, grounds: ['aurelius-meditations-4-3'] }], { now: NOW });
    expect((parseFile('maps/proposals/P-20260906-001.md', textOf(other, 'maps/proposals/P-20260906-001.md')) as BrainFile<ProposalFm>).fm.grounds).toEqual(['aurelius-meditations-4-3', 'watts-join-the-dance']);
  });

  it('files a text-only capture: raw copied byte for byte, notes stubbed, proposals numbered, capture marked', () => {
    const b = buildFiling(s, capture, meta, proposals, { now: NOW });
    expect(b.message).toBe('File: watts-join-the-dance');
    expect(b.expectedHead).toBe('head1');
    expect(b.deletes).toEqual([]);
    expect(paths(b)).toEqual([
      'sources/watts-join-the-dance/raw.md',
      'sources/watts-join-the-dance/notes.md',
      'maps/proposals/P-20260906-001.md',
      'maps/proposals/P-20260906-002.md',
      'inbox/20260906-070000-2bq.md',
    ]);
    const raw = parseFile('sources/watts-join-the-dance/raw.md', textOf(b, 'sources/watts-join-the-dance/raw.md'));
    expect(raw.body).toBe(capture.body);
    expect(raw.fm).toEqual({ type: 'source', title: 'Join the dance', author: 'Alan Watts', work: 'The Wisdom of Insecurity', year: 1951, inbox_ref: '20260906-070000-2bq', tags: ['change'], curated: 'agent-proposed', created: NOW, updated: NOW });
    expect(textOf(b, 'sources/watts-join-the-dance/notes.md')).toBe('---\ntype: notes\nsource: watts-join-the-dance\ncurated: agent-proposed\ncreated: 2026-09-06T12:00:00Z\nupdated: 2026-09-06T12:00:00Z\n---\n');
    const tag = parseFile('maps/proposals/P-20260906-002.md', textOf(b, 'maps/proposals/P-20260906-002.md')).fm as ProposalFm;
    expect(tag).toMatchObject({ kind: 'tag', target: 'watts-join-the-dance', from_source: 'watts-join-the-dance', status: 'open', curated: 'agent-proposed' });
    expect(validateBatch(s, b)).toEqual([]);
    expect(validateSnapshot(applyBatch(s, b))).toEqual([]);
  });
  it('the capture gains exactly two fields and nothing else changes', () => {
    const b = buildFiling(s, capture, meta, [], { now: NOW });
    const before = fixture.get('inbox/20260906-070000-2bq.md')!;
    const after = textOf(b, 'inbox/20260906-070000-2bq.md');
    expect(after).toBe(before.replace('status: unfiled\n', 'status: filed\nfiled_as: watts-join-the-dance\n'));
    expect((parseFile(capture.path, after).fm as InboxFm).updated).toBe(capture.fm.updated);
  });
  it('carries an attachment across byte for byte and declares it', () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 0, 1, 2]);
    const withAttachment = snapshotOf(fixture, {
      'inbox/20260906-080000-abc.md': '---\ntype: inbox\nattachment: 20260906-080000-abc.png\nstatus: unfiled\ncurated: human\ncreated: 2026-09-06T08:00:00Z\nupdated: 2026-09-06T08:00:00Z\n---\nA scanned page.\n',
      'inbox/20260906-080000-abc.png': 'binary',
    });
    const cap = withAttachment.files.get('inbox/20260906-080000-abc.md') as BrainFile<InboxFm>;
    const b = buildFiling(withAttachment, cap, { title: 'Scan', author: 'Anon' }, [], { now: NOW, attachmentBytes: bytes });
    expect(paths(b)).toEqual(['sources/anon-scan/raw.md', 'sources/anon-scan/original.png', 'sources/anon-scan/notes.md', 'inbox/20260906-080000-abc.md']);
    const w = b.writes[1]!;
    expect('bytes' in w && w.bytes).toBe(bytes);
    expect((parseFile('sources/anon-scan/raw.md', textOf(b, 'sources/anon-scan/raw.md')).fm as SourceFm).attachment).toBe('original.png');
    expect(validateBatch(withAttachment, b)).toEqual([]);
    expect(validateSnapshot(applyBatch(withAttachment, b))).toEqual([]);
    expect(() => buildFiling(withAttachment, cap, { title: 'Scan', author: 'Anon' }, [], { now: NOW })).toThrow(/bytes are required/);
  });
  it('honours a proposed slug, de-collides it, and refuses malformed slugs and filed captures', () => {
    const b = buildFiling(s, capture, { ...meta, slug: 'aurelius-meditations-4-3' }, [], { now: NOW });
    expect(b.message).toBe('File: aurelius-meditations-4-3-2');
    expect(() => buildFiling(s, capture, { ...meta, slug: 'Bad Slug' }, [], { now: NOW })).toThrow(/malformed/);
    const filed = s.files.get('inbox/20260901-081500-k3m.md') as BrainFile<InboxFm>;
    expect(() => buildFiling(s, filed, meta, [], { now: NOW })).toThrow(/already filed/);
  });
  it('a second filing on the same day continues the proposal numbering', () => {
    const first = applyBatch(s, buildFiling(s, capture, meta, proposals, { now: NOW }));
    const nextCapture = { ...capture, path: 'inbox/20260906-090000-q2w.md' } as BrainFile<InboxFm>;
    const withNext = applyBatch(first, { message: 'Capture: x', expectedHead: 'head1', writes: [{ path: nextCapture.path, text: fixture.get(capture.path)! }], deletes: [] });
    const b = buildFiling(withNext, withNext.files.get(nextCapture.path) as BrainFile<InboxFm>, { title: 'Again', author: 'Alan Watts' }, [proposals[1]!], { now: NOW });
    expect(paths(b)).toContain('maps/proposals/P-20260906-003.md');
    expect(b.message).toBe('File: watts-again');
    expect(validateSnapshot(applyBatch(withNext, b)).filter((i) => i.level === 'refusal')).toEqual([]);
  });
});
