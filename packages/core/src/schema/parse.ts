// parseFile (spec §5): split frontmatter from body, check every per-file
// rule of schema §9, and return a typed BrainFile. Cross-file rules (order
// contiguity, dangling refs, attachment existence) live in validateSnapshot.

import { parseDocument } from 'yaml';
import type { BrainFile, FileType, Frontmatter } from './types';
import { type Issue, ValidationError, refusal } from './issues';
import { isFrontmatterPath, pathIdentifierProblems, pathInfo } from './paths';
import { DATETIME, FIELD_SPECS, REQUIRED, STATUS_VALUES } from './fields';

/** A frontmatter value the format allows: scalars and lists of strings. */
export type FmValue = string | number | string[];
export type RawFrontmatter = Record<string, FmValue>;

/** Canonical body: LF line endings, no BOM, and exactly one trailing newline (or empty). */
export function normalizeBody(body: string): string {
  const lf = body.replace(/\r\n?/g, '\n');
  const trimmed = lf.replace(/\n+$/, '');
  return trimmed === '' ? '' : trimmed + '\n';
}

/** Split `---\n<yaml>\n---\n<body>`; undefined when the text does not start with a frontmatter block. */
export function splitFrontmatter(text: string): { yaml: string; body: string } | undefined {
  const t = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (!t.startsWith('---\n')) return undefined;
  const close = t.indexOf('\n---', 3);
  if (close === -1) return undefined;
  const after = close + 4;
  if (after !== t.length && t[after] !== '\n') return undefined;
  return { yaml: t.slice(4, close), body: t.slice(Math.min(after + 1, t.length)) };
}

function describe(v: unknown): string {
  if (Array.isArray(v)) return 'a list';
  if (v === null) return 'empty (delete the line instead)';
  return typeof v;
}

/** Check one field's value against its spec. Returns a message when it is wrong. */
function checkValue(name: string, v: unknown, type: FileType): string | undefined {
  const spec = FIELD_SPECS[name];
  if (!spec) {
    // Unknown key: allowed if it is a scalar or a list of strings, so nothing is lost on rewrite.
    if (typeof v === 'string' || typeof v === 'number') return undefined;
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return undefined;
    return `unknown field '${name}' has an unsupported value (${describe(v)})`;
  }
  switch (spec.kind) {
    case 'string':
      return typeof v === 'string' ? undefined : `'${name}' must be a string, not ${describe(v)}`;
    case 'int':
      if (typeof v !== 'number' || !Number.isInteger(v)) return `'${name}' must be an integer, not ${describe(v)}`;
      if (spec.positive && v < 1) return `'${name}' must be a positive integer`;
      return undefined;
    case 'datetime':
      if (typeof v !== 'string') return `'${name}' must be an ISO 8601 date or datetime string, not ${describe(v)}`;
      return DATETIME.test(v) ? undefined : `'${name}' must be YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ, not '${v}'`;
    case 'strings':
      if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) return `'${name}' must be a list of strings`;
      return undefined;
    case 'enum': {
      const values = name === 'status' ? (STATUS_VALUES[type] ?? spec.values!) : spec.values!;
      if (typeof v !== 'string' || !values.includes(v)) return `'${name}' must be one of ${values.join(', ')}`;
      return undefined;
    }
  }
}

/** Every per-file rule of schema §9 for an already-parsed frontmatter mapping. */
export function frontmatterIssues(path: string, fm: Record<string, unknown>): Issue[] {
  const issues: Issue[] = [];
  const r = (rule: string, message: string) => issues.push(refusal(path, rule, message));

  const info = pathInfo(path);
  if (!info) {
    r('path.unexpected', 'path is outside the schema §2 layout');
    return issues;
  }
  for (const m of pathIdentifierProblems(info)) r('id.format', m);

  const type = fm['type'];
  if (typeof type !== 'string' || !(type in REQUIRED)) {
    r('type.unknown', `'type' must be one of ${Object.keys(REQUIRED).join(', ')}`);
    return issues;
  }
  if (type !== info.type) {
    r('type.mismatch', `type is '${type}' but this path must hold '${info.type}'`);
    return issues;
  }
  const t = type as FileType;

  if (t === 'index') {
    const extra = Object.keys(fm).filter((k) => k !== 'type');
    if (extra.length) r('index.extra-fields', `index frontmatter must be 'type' only; found ${extra.join(', ')}`);
    return issues;
  }

  for (const k of REQUIRED[t]) {
    if (!(k in fm)) r('field.required', `missing required field '${k}'`);
  }
  for (const [k, v] of Object.entries(fm)) {
    const m = checkValue(k, v, t);
    if (m) r('field.type', m);
  }
  if (issues.some((i) => i.rule === 'field.type' || i.rule === 'field.required')) return issues;

  const curated = fm['curated'];
  if ((t === 'principle' || t === 'principle-set' || t === 'inbox') && curated !== 'human') {
    r('curated.human-required', `${t} files must be 'curated: human'`);
  }
  if (t === 'proposal' && curated === 'ratified') r('curated.proposal-ratified', 'a proposal is never ratified');

  if (t === 'principle' && fm['set'] !== info.folder) {
    r('path.set-mismatch', `'set' is '${fm['set']}' but the folder is '${info.folder}'`);
  }
  if (t === 'notes' && fm['source'] !== info.folder) {
    r('path.source-mismatch', `'source' is '${fm['source']}' but the folder is '${info.folder}'`);
  }
  if (t === 'inbox' && fm['status'] === 'filed' && !('filed_as' in fm)) {
    r('inbox.filed-without-filed_as', "'status: filed' requires 'filed_as'");
  }
  if (t === 'proposal') {
    const kind = fm['kind'];
    if ((kind === 'principle' || kind === 'amendment' || kind === 'link') && !('target_set' in fm)) {
      r('proposal.conditional-field', `'kind: ${kind}' requires 'target_set'`);
    }
    if ((kind === 'amendment' || kind === 'link' || kind === 'tag') && !('target' in fm)) {
      r('proposal.conditional-field', `'kind: ${kind}' requires 'target'`);
    }
  }
  return issues;
}

export interface ParseOptions {
  /** blob SHA at the snapshot commit; empty when unknown */
  sha?: string;
  /** the body was stored as ciphertext (set by the encrypting driver) */
  encrypted?: boolean;
}

export type ParseResult = { ok: true; file: BrainFile } | { ok: false; issues: Issue[] };

/** parseFile that reports instead of throwing, for whole-brain validation. */
export function tryParseFile(path: string, text: string, opts: ParseOptions = {}): ParseResult {
  if (!isFrontmatterPath(path)) {
    return { ok: false, issues: [refusal(path, 'path.exempt', 'not a frontmatter-bearing brain file')] };
  }
  const split = splitFrontmatter(text);
  if (!split) return { ok: false, issues: [refusal(path, 'frontmatter.missing', 'file does not start with a frontmatter block')] };

  const doc = parseDocument(split.yaml, { schema: 'core', uniqueKeys: true });
  const problems = [...doc.errors, ...doc.warnings];
  if (problems.length) {
    return { ok: false, issues: problems.map((e) => refusal(path, 'frontmatter.yaml', e.message.split('\n')[0]!)) };
  }
  const raw: unknown = doc.toJS();
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, issues: [refusal(path, 'frontmatter.not-mapping', 'frontmatter must be a YAML mapping')] };
  }
  const fm = raw as Record<string, unknown>;
  const issues = frontmatterIssues(path, fm);
  if (issues.length) return { ok: false, issues };

  return {
    ok: true,
    file: {
      path,
      sha: opts.sha ?? '',
      fm: fm as unknown as Frontmatter,
      body: normalizeBody(split.body),
      encrypted: opts.encrypted ?? false,
    },
  };
}

/** Split, validate, and type a brain file. Throws ValidationError listing every refusal (spec §5). */
export function parseFile(path: string, text: string, opts: ParseOptions = {}): BrainFile {
  const result = tryParseFile(path, text, opts);
  if (!result.ok) throw new ValidationError(result.issues);
  return result.file;
}
