// serializeFile (spec §5): canonical output. Keys in schema order, block-style
// lists, LF line endings, exactly one trailing newline. Canonical bytes are
// what make index regeneration and the "no diff when nothing changed" rule hold.

import { parseDocument } from 'yaml';
import type { BrainFile, Frontmatter } from './types';
import { FIELD_ORDER } from './fields';
import { normalizeBody, type FmValue } from './parse';

// A plain scalar may not start with a YAML indicator and may not contain a
// newline or a comment; everything else is decided by re-parsing.
const PLAIN_START = /^[^\s\-?:,[\]{}#&*!|>'"%@`]/;

/** Emit a scalar: plain when it reads back as the identical string, else double-quoted (JSON escapes). */
export function emitScalar(v: string | number, context: 'map' | 'list' = 'map'): string {
  if (typeof v === 'number') return String(v);
  if (v !== '' && !v.includes('\n') && PLAIN_START.test(v) && !/\s$/.test(v)) {
    const probe = context === 'map' ? `x: ${v}` : `- ${v}`;
    const read = parseDocument(probe, { schema: 'core' });
    if (!read.errors.length && !read.warnings.length) {
      const back: unknown = read.toJS();
      const same = context === 'map'
        ? (back as { x?: unknown }).x === v
        : Array.isArray(back) && back.length === 1 && back[0] === v;
      if (same) return v;
    }
  }
  return JSON.stringify(v);
}

function emitField(key: string, v: FmValue): string {
  if (Array.isArray(v)) {
    if (v.length === 0) return `${key}: []\n`;
    return `${key}:\n` + v.map((x) => `  - ${emitScalar(x, 'list')}\n`).join('');
  }
  return `${key}: ${emitScalar(v, 'map')}\n`;
}

/** Canonical frontmatter block, `---` to `---`, trailing newline included. */
export function serializeFrontmatter(fm: Frontmatter): string {
  const record = fm as unknown as Record<string, FmValue | undefined>;
  const order = FIELD_ORDER[fm.type];
  const known = order.filter((k) => record[k] !== undefined);
  const unknown = Object.keys(record)
    .filter((k) => !order.includes(k) && record[k] !== undefined)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let out = '---\n';
  for (const k of [...known, ...unknown]) {
    const v = record[k]!;
    if (typeof v !== 'string' && typeof v !== 'number' && !Array.isArray(v)) {
      throw new TypeError(`frontmatter field '${k}' has an unsupported value`);
    }
    out += emitField(k, v);
  }
  return out + '---\n';
}

export interface SerializeOptions {
  /** The previously committed version. When given with `now`, `updated` is refreshed if content changed. */
  prev: BrainFile;
  /** ISO 8601 UTC datetime to stamp into `updated` on content change. */
  now: string;
}

function contentKey(file: BrainFile): string {
  const { updated: _u, ...rest } = file.fm as unknown as Record<string, FmValue>;
  return serializeFrontmatter(rest as unknown as Frontmatter) + normalizeBody(file.body);
}

/** Canonical text of a brain file. Pure: the same file always serializes to the same bytes. */
export function serializeFile(file: BrainFile, opts?: SerializeOptions): string {
  let fm = file.fm;
  if (opts && fm.type !== 'index' && contentKey(file) !== contentKey(opts.prev)) {
    fm = { ...fm, updated: opts.now } as Frontmatter;
  }
  return serializeFrontmatter(fm) + normalizeBody(file.body);
}
