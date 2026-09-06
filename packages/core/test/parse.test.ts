import { describe, expect, it } from 'vitest';
import { DATETIME, ValidationError, nowUtc, parseFile, serializeFile, splitFrontmatter, tryParseFile } from '../src/index';
import { FIXTURE, GEO_BRAIN, TEMPLATE, frontmatterFiles, hasGeoBrain } from './brains';

const SET = `---
type: principle-set
order: 1
curated: human
created: 2026-09-05T00:00:00Z
updated: 2026-09-05T00:00:00Z
---
`;

function rules(path: string, text: string): string[] {
  const r = tryParseFile(path, text);
  return r.ok ? [] : r.issues.map((i) => i.rule);
}

describe('splitFrontmatter', () => {
  it('splits a block with and without a body', () => {
    expect(splitFrontmatter('---\na: 1\n---\nbody\n')).toEqual({ yaml: 'a: 1', body: 'body\n' });
    expect(splitFrontmatter('---\na: 1\n---\n')).toEqual({ yaml: 'a: 1', body: '' });
    expect(splitFrontmatter('---\na: 1\n---')).toEqual({ yaml: 'a: 1', body: '' });
  });
  it('rejects text that does not open or close a block', () => {
    expect(splitFrontmatter('a: 1\n---\n')).toBeUndefined();
    expect(splitFrontmatter('---\na: 1\n')).toBeUndefined();
    expect(splitFrontmatter('---\na: 1\n---x\n')).toBeUndefined();
  });
  it('normalizes CRLF and strips a BOM', () => {
    expect(splitFrontmatter('\uFEFF---\r\na: 1\r\n---\r\nb\r\n')).toEqual({ yaml: 'a: 1', body: 'b\n' });
  });
});

describe('golden brains round-trip byte for byte', () => {
  for (const [name, root] of [['template', TEMPLATE], ['fixture', FIXTURE]] as const) {
    it(name, () => {
      const files = frontmatterFiles(root);
      expect(files.size).toBeGreaterThan(0);
      for (const [path, text] of files) {
        const file = parseFile(path, text);
        expect(serializeFile(file), path).toBe(text);
      }
    });
  }
  it.skipIf(!hasGeoBrain)('geo-brain-2 parses, is semantically stable, and canonicalizes idempotently', () => {
    const files = frontmatterFiles(GEO_BRAIN);
    expect(files.size).toBeGreaterThan(0);
    for (const [path, text] of files) {
      const file = parseFile(path, text);
      const once = serializeFile(file);
      const again = parseFile(path, once);
      expect(again.fm, path).toEqual(file.fm);
      expect(again.body, path).toBe(file.body);
      expect(serializeFile(again), path).toBe(once);
    }
  });
});

describe('parseFile per-file rules (schema §9)', () => {
  it('returns a typed file with a normalized body', () => {
    const f = parseFile('principles/ps-g8xw/_set.md', SET + 'Framing.\n\n\n');
    expect(f.fm.type).toBe('principle-set');
    expect(f.body).toBe('Framing.\n');
    expect(f.sha).toBe('');
    expect(f.encrypted).toBe(false);
  });
  it('throws ValidationError listing every refusal', () => {
    expect(() => parseFile('principles/ps-g8xw/_set.md', '---\ntype: principle-set\n---\n')).toThrow(ValidationError);
    try {
      parseFile('principles/ps-g8xw/_set.md', '---\ntype: principle-set\n---\n');
    } catch (e) {
      const issues = (e as ValidationError).issues;
      expect(issues.map((i) => i.message)).toEqual([
        "missing required field 'curated'",
        "missing required field 'created'",
        "missing required field 'updated'",
        "missing required field 'order'",
      ]);
      expect(issues.every((i) => i.level === 'refusal')).toBe(true);
    }
  });
  it('frontmatter.missing / frontmatter.yaml / frontmatter.not-mapping', () => {
    expect(rules('principles/ps-g8xw/_set.md', 'no frontmatter')).toEqual(['frontmatter.missing']);
    expect(rules('principles/ps-g8xw/_set.md', '---\ntype: [\n---\n')).toEqual(['frontmatter.yaml']);
    expect(rules('principles/ps-g8xw/_set.md', '---\ntype: a\ntype: b\n---\n')).toEqual(['frontmatter.yaml']);
    expect(rules('principles/ps-g8xw/_set.md', '---\njust a string\n---\n')).toEqual(['frontmatter.not-mapping']);
  });
  it('path.exempt / path.unexpected / id.format', () => {
    expect(rules('README.md', SET)).toEqual(['path.exempt']);
    expect(rules('templates/set.md', SET)).toEqual(['path.exempt']);
    expect(rules('.claude/commands/reason.md', SET)).toEqual(['path.exempt']);
    expect(rules('notes/stray.md', SET)).toEqual(['path.unexpected']);
    expect(rules('sources/x/extra.md', SET)).toEqual(['path.unexpected']);
    expect(rules('principles/ps-0o1l/_set.md', SET)).toEqual(['id.format']);
    expect(rules('inbox/2026-bad.md', SET.replace('principle-set', 'inbox').replace('order: 1', 'status: unfiled'))).toEqual(['id.format']);
    expect(rules('maps/proposals/P3.md', SET)).toContain('id.format');
  });
  it('type.unknown / type.mismatch / index.extra-fields', () => {
    expect(rules('principles/ps-g8xw/_set.md', SET.replace('principle-set', 'thing'))).toEqual(['type.unknown']);
    expect(rules('principles/ps-g8xw/_set.md', SET.replace('principle-set', 'principle'))).toEqual(['type.mismatch']);
    expect(rules('sources/a-b/raw.md', '---\ntype: proposal\n---\n')).toEqual(['type.mismatch']);
    expect(rules('maps/_index.md', '---\ntype: index\n---\n')).toEqual([]);
    expect(rules('maps/_index.md', '---\ntype: index\nupdated: 2026-09-05\n---\n')).toEqual(['index.extra-fields']);
  });
  it('field.type catches wrong kinds, blanks, and bad dates', () => {
    expect(rules('principles/ps-g8xw/_set.md', SET.replace('order: 1', 'order: two'))).toEqual(['field.type']);
    expect(rules('principles/ps-g8xw/_set.md', SET.replace('order: 1', 'order: 0'))).toEqual(['field.type']);
    expect(rules('principles/ps-g8xw/_set.md', SET.replace('order: 1', 'order: 1\nname:'))).toEqual(['field.type']);
    expect(rules('principles/ps-g8xw/_set.md', SET.replace('created: 2026-09-05T00:00:00Z', 'created: 5 Sept 2026'))).toEqual(['field.type']);
    expect(rules('principles/ps-g8xw/_set.md', SET.replace('order: 1', 'order: 1\ntags: stoicism'))).toEqual(['field.type']);
    expect(rules('principles/ps-g8xw/_set.md', SET.replace('order: 1', 'order: 1\nextra:\n  nested: 1'))).toEqual(['field.type']);
    expect(rules('principles/ps-g8xw/_set.md', SET.replace('order: 1', 'order: 1\nextra: fine'))).toEqual([]);
  });
  it('curated constraints', () => {
    expect(rules('principles/ps-g8xw/_set.md', SET.replace('curated: human', 'curated: ratified'))).toEqual(['curated.human-required']);
    expect(rules('principles/ps-g8xw/_set.md', SET.replace('curated: human', 'curated: nope'))).toEqual(['field.type']);
    const proposal = '---\ntype: proposal\nkind: tag\ntitle: t\ntarget: a-b\nstatus: open\ncurated: ratified\ncreated: 2026-09-05\nupdated: 2026-09-05\n---\n';
    expect(rules('maps/proposals/P-20260905-001.md', proposal)).toEqual(['curated.proposal-ratified']);
  });
  it('path.set-mismatch / path.source-mismatch', () => {
    const principle = '---\ntype: principle\ntitle: t\nset: ps-7k2m\norder: 1\ngrounds: []\ncurated: human\ncreated: 2026-09-05\nupdated: 2026-09-05\n---\n';
    expect(rules('principles/ps-g8xw/tea.md', principle)).toEqual(['path.set-mismatch']);
    const notes = '---\ntype: notes\nsource: other\ncurated: human\ncreated: 2026-09-05\nupdated: 2026-09-05\n---\n';
    expect(rules('sources/a-b/notes.md', notes)).toEqual(['path.source-mismatch']);
  });
  it('inbox.filed-without-filed_as and status is type-specific', () => {
    const inbox = (status: string) => `---\ntype: inbox\nstatus: ${status}\ncurated: human\ncreated: 2026-09-05\nupdated: 2026-09-05\n---\nx\n`;
    expect(rules('inbox/20260905-143012-x7q.md', inbox('filed'))).toEqual(['inbox.filed-without-filed_as']);
    expect(rules('inbox/20260905-143012-x7q.md', inbox('open'))).toEqual(['field.type']);
    expect(rules('inbox/20260905-143012-x7q.md', inbox('unfiled'))).toEqual([]);
  });
  it('proposal.conditional-field per kind', () => {
    const proposal = (kind: string, extra = '') =>
      `---\ntype: proposal\nkind: ${kind}\ntitle: t\n${extra}status: open\ncurated: agent-proposed\ncreated: 2026-09-05\nupdated: 2026-09-05\n---\n`;
    const p = 'maps/proposals/P-20260905-001.md';
    expect(rules(p, proposal('principle'))).toEqual(['proposal.conditional-field']);
    expect(rules(p, proposal('principle', 'target_set: ps-g8xw\n'))).toEqual([]);
    expect(rules(p, proposal('link'))).toEqual(['proposal.conditional-field', 'proposal.conditional-field']);
    expect(rules(p, proposal('amendment', 'target_set: ps-g8xw\ntarget: ps-g8xw/x\n'))).toEqual([]);
    expect(rules(p, proposal('tag'))).toEqual(['proposal.conditional-field']);
    expect(rules(p, proposal('tag', 'target: a-b\n'))).toEqual([]);
  });
});

describe('nowUtc', () => {
  it('formats to the schema datetime form without milliseconds', () => {
    expect(nowUtc(new Date('2026-09-06T20:44:02.626Z'))).toBe('2026-09-06T20:44:02Z');
    expect(DATETIME.test(nowUtc())).toBe(true);
  });
});
