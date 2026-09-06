import { describe, expect, it } from 'vitest';
import { type Issue, hasRefusals, validateLayout, validateSnapshot } from '../src/index';
import { FIXTURE, GEO_BRAIN, TEMPLATE, hasGeoBrain, readBrain, snapshotFromDisk, snapshotOf, treeOf } from './brains';

const fixture = readBrain(FIXTURE);
const check = (edits: Record<string, string | null> = {}) => validateSnapshot(snapshotOf(fixture, edits));
const only = (issues: Issue[], rule: string) => issues.filter((i) => i.rule === rule);
const rules = (issues: Issue[]) => issues.map((i) => i.rule).sort();

/** Rewrite one frontmatter line of a fixture file. */
function edit(path: string, from: string, to: string): string {
  const text = fixture.get(path);
  if (text === undefined || !text.includes(from)) throw new Error(`${path} lacks ${JSON.stringify(from)}`);
  return text.replace(from, to);
}

describe('golden brains validate clean (reference: tools/gnomon-check.py)', () => {
  it('template', () => expect(validateSnapshot(snapshotFromDisk(TEMPLATE))).toEqual([]));
  it('fixture', () => expect(check()).toEqual([]));
  it.skipIf(!hasGeoBrain)('geo-brain-2', () => expect(validateSnapshot(snapshotFromDisk(GEO_BRAIN))).toEqual([]));
  it('template layout is complete', () => expect(validateLayout(treeOf(readBrain(TEMPLATE)))).toEqual([]));
});

describe('validateLayout (schema §2)', () => {
  it('reports AGENTS.md, folders, and templates that are missing', () => {
    const tree = treeOf(readBrain(TEMPLATE)).filter((e) => e.path !== 'AGENTS.md' && !e.path.startsWith('inbox/') && e.path !== 'templates/raw.md');
    expect(validateLayout(tree).map((i) => i.path)).toEqual(['AGENTS.md', 'inbox/', 'templates/raw.md']);
    expect(validateLayout(tree).every((i) => i.rule === 'layout.missing' && i.level === 'refusal')).toBe(true);
  });
  it('a folder counts as present when only its keeper exists', () => {
    expect(validateLayout([{ path: 'sources/.gitkeep', sha: '', size: 0 }]).map((i) => i.path)).not.toContain('sources/');
  });
});

describe('validateSnapshot refusals (schema §9)', () => {
  it('includes per-file parse refusals from the snapshot', () => {
    const issues = check({ 'principles/ps-g8xw/_set.md': '---\ntype: principle-set\n---\n' });
    expect(only(issues, 'field.required').length).toBe(4);
    expect(hasRefusals(issues)).toBe(true);
  });
  it('sets.none', () => {
    const issues = check({ 'principles/ps-g8xw/_set.md': null, 'principles/ps-7k2m/_set.md': null });
    expect(rules(issues)).toContain('sets.none');
    expect(only(issues, 'principle.no-set').length).toBe(4);
  });
  it('order.sets', () => {
    expect(rules(check({ 'principles/ps-7k2m/_set.md': edit('principles/ps-7k2m/_set.md', 'order: 2', 'order: 3') }))).toEqual(['order.sets']);
    expect(rules(check({ 'principles/ps-7k2m/_set.md': edit('principles/ps-7k2m/_set.md', 'order: 2', 'order: 1') }))).toEqual(['order.sets']);
  });
  it('order.principles', () => {
    const p = 'principles/ps-7k2m/write-to-find-out.md';
    expect(check({ [p]: edit(p, 'order: 2', 'order: 3') }).map((i) => [i.path, i.rule])).toEqual([['principles/ps-7k2m', 'order.principles']]);
    expect(rules(check({ [p]: edit(p, 'order: 2', 'order: 1') }))).toEqual(['order.principles']);
  });
  it('deleting a principle mid-sequence is an order refusal, deleting the last is not', () => {
    expect(rules(check({ 'principles/ps-7k2m/say-the-hard-thing-first.md': null }))).toContain('order.principles');
    const issues = check({ 'principles/ps-7k2m/write-to-find-out.md': null });
    expect(only(issues, 'order.principles')).toEqual([]);
  });
  it('source.missing-raw', () => {
    expect(rules(check({ 'sources/weil-attention/raw.md': null }))).toEqual(['grounds.dangling', 'source.missing-raw']);
  });
  it('source.unexpected-file', () => {
    expect(rules(check({ 'sources/weil-attention/extra.png': 'x' }))).toEqual(['source.unexpected-file']);
    expect(rules(check({ 'sources/nobody-here/original.pdf': 'x' }))).toEqual(['source.unexpected-file']);
    // a stray .md in a source folder is a per-file path refusal
    expect(rules(check({ 'sources/weil-attention/extra.md': '---\ntype: notes\n---\n' }))).toEqual(['path.unexpected']);
  });
  it('attachment.missing / attachment.name / attachment.undeclared for sources', () => {
    const p = 'sources/didion-why-i-write/raw.md';
    expect(rules(check({ 'sources/didion-why-i-write/original.pdf': null }))).toEqual(['attachment.missing']);
    expect(rules(check({ [p]: edit(p, 'attachment: original.pdf', 'attachment: scan.pdf') }))).toEqual(['attachment.name', 'source.unexpected-file']);
    expect(rules(check({ [p]: edit(p, 'attachment: original.pdf\n', '') }))).toEqual(['source.unexpected-file']);
  });
  it('attachment.missing / attachment.name / attachment.undeclared / inbox.orphan-attachment for inbox', () => {
    const p = 'inbox/20260902-190433-p9r.md';
    expect(rules(check({ 'inbox/20260902-190433-p9r.pdf': null }))).toEqual(['attachment.missing']);
    expect(rules(check({ [p]: edit(p, 'attachment: 20260902-190433-p9r.pdf', 'attachment: scan.pdf') }))).toEqual(['attachment.name', 'attachment.undeclared']);
    expect(rules(check({ [p]: edit(p, 'attachment: 20260902-190433-p9r.pdf\n', '') }))).toEqual(['attachment.undeclared']);
    expect(rules(check({ 'inbox/20260909-000000-zzz.png': 'x' }))).toEqual(['inbox.orphan-attachment']);
  });
  it('inbox.filed-as-missing', () => {
    const p = 'inbox/20260901-081500-k3m.md';
    const issues = check({ [p]: edit(p, 'filed_as: aurelius-meditations-4-3', 'filed_as: nope-nope') });
    expect(rules(issues)).toEqual(['inbox-ref.stale', 'inbox.filed-as-missing']);
    expect(only(issues, 'inbox.filed-as-missing')[0]!.level).toBe('refusal');
  });
  it('a stray file outside inbox/ and sources/ is only a warning', () => {
    const issues = check({ 'maps/diagram.png': 'x' });
    expect(issues.map((i) => [i.rule, i.level])).toEqual([['attachment.stray', 'warning']]);
  });
});

describe('validateSnapshot warnings (schema §9)', () => {
  it('grounds.dangling', () => {
    const p = 'principles/ps-g8xw/attention-is-generosity.md';
    const issues = check({ [p]: edit(p, '  - weil-attention', '  - weil-attention\n  - missing-one') });
    expect(issues.map((i) => [i.rule, i.level])).toEqual([['grounds.dangling', 'warning'], ['grounds.drift', 'warning']]);
  });
  it('related.dangling', () => {
    const p = 'principles/ps-g8xw/courage-before-comfort.md';
    expect(rules(check({ [p]: edit(p, '  - ps-7k2m/say-the-hard-thing-first', '  - ps-7k2m/nope') }))).toEqual(['related.dangling']);
  });
  it('grounds.drift in both directions, matching the Python checker', () => {
    const p = 'principles/ps-7k2m/say-the-hard-thing-first.md';
    const bodyOnly = check({ [p]: edit(p, '  - aurelius-meditations-4-3\n', '') });
    expect(only(bodyOnly, 'grounds.drift')[0]!.message).toContain('body only [aurelius-meditations-4-3]');
    const groundsOnly = check({ [p]: edit(p, '- [[sources/aurelius-meditations-4-3/raw]] ([raw](../../sources/aurelius-meditations-4-3/raw.md))\n', '') });
    expect(only(groundsOnly, 'grounds.drift')[0]!.message).toContain('grounds only [aurelius-meditations-4-3]');
  });
  it('target-set.dangling / target.dangling / from-source.dangling / proposal grounds.dangling', () => {
    const p = 'maps/proposals/P-20260905-002.md';
    expect(rules(check({ [p]: edit(p, 'target_set: ps-g8xw', 'target_set: ps-zzzz') }))).toEqual(['target-set.dangling']);
    expect(rules(check({ [p]: edit(p, 'target: ps-g8xw/courage-before-comfort', 'target: ps-g8xw/nope') }))).toEqual(['target.dangling']);
    expect(rules(check({ [p]: edit(p, 'from_source: aurelius-meditations-5-1', 'from_source: nope-nope') }))).toEqual(['from-source.dangling']);
    expect(rules(check({ [p]: edit(p, '  - aurelius-meditations-5-1', '  - nope-nope') }))).toEqual(['grounds.dangling']);
    const tag = 'maps/proposals/P-20260903-001.md';
    expect(rules(check({ [tag]: edit(tag, 'target: didion-why-i-write', 'target: nope-nope') }))).toEqual(['target.dangling']);
  });
  it('inbox-ref.stale when the capture is gone or filed elsewhere', () => {
    expect(rules(check({ 'inbox/20260901-081500-k3m.md': null }))).toEqual(['inbox-ref.stale']);
    const p = 'inbox/20260901-081500-k3m.md';
    const unfiled = edit(p, 'status: filed\nfiled_as: aurelius-meditations-4-3', 'status: unfiled');
    expect(rules(check({ [p]: unfiled }))).toEqual(['inbox-ref.stale']);
  });
  it('field.unknown', () => {
    const p = 'sources/weil-attention/notes.md';
    const issues = check({ [p]: edit(p, 'curated: human', 'curated: human\nmood: quiet') });
    expect(issues.map((i) => [i.rule, i.level])).toEqual([['field.unknown', 'warning']]);
  });
  it('issues are sorted by path then rule', () => {
    const issues = check({
      'sources/weil-attention/raw.md': null,
      'principles/ps-7k2m/_set.md': edit('principles/ps-7k2m/_set.md', 'order: 2', 'order: 3'),
    });
    expect(issues.map((i) => `${i.path} ${i.rule}`)).toEqual([
      'principles/ order.sets',
      'principles/ps-g8xw/attention-is-generosity.md grounds.dangling',
      'sources/weil-attention/notes.md source.missing-raw',
    ]);
  });
});
