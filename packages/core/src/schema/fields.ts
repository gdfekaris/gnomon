// Frontmatter contract per file type (schema §4): canonical key order,
// required fields, and value kinds. The order is the templates' order.

import type { FileType } from './types';

export type FieldKind = 'string' | 'int' | 'datetime' | 'strings' | 'enum';

export interface FieldSpec {
  kind: FieldKind;
  /** for `enum` */
  values?: readonly string[];
  /** for `int`: must be >= 1 */
  positive?: boolean;
}

export const CURATION_STATES = ['human', 'agent-proposed', 'ratified'] as const;
export const FILE_TYPES = ['source', 'notes', 'principle', 'principle-set', 'inbox', 'proposal', 'index'] as const;
export const PROPOSAL_KINDS = ['principle', 'link', 'tag', 'amendment'] as const;
export const PROPOSAL_STATUSES = ['open', 'accepted', 'declined'] as const;
export const INBOX_STATUSES = ['unfiled', 'filed'] as const;

export const FIELD_SPECS: Record<string, FieldSpec> = {
  type: { kind: 'enum', values: FILE_TYPES },
  curated: { kind: 'enum', values: CURATION_STATES },
  created: { kind: 'datetime' },
  updated: { kind: 'datetime' },
  tags: { kind: 'strings' },
  title: { kind: 'string' },
  author: { kind: 'string' },
  work: { kind: 'string' },
  year: { kind: 'int' },
  locator: { kind: 'string' },
  origin: { kind: 'string' },
  inbox_ref: { kind: 'string' },
  attachment: { kind: 'string' },
  source: { kind: 'string' },
  order: { kind: 'int', positive: true },
  name: { kind: 'string' },
  set: { kind: 'string' },
  grounds: { kind: 'strings' },
  related: { kind: 'strings' },
  note: { kind: 'string' },
  status: { kind: 'enum', values: [...INBOX_STATUSES, ...PROPOSAL_STATUSES] },
  filed_as: { kind: 'string' },
  kind: { kind: 'enum', values: PROPOSAL_KINDS },
  target_set: { kind: 'string' },
  target: { kind: 'string' },
  from_source: { kind: 'string' },
};

/** Canonical key order per type (templates/*.md). Common trailing fields last. */
export const FIELD_ORDER: Record<FileType, readonly string[]> = {
  source: ['type', 'title', 'author', 'work', 'year', 'locator', 'origin', 'inbox_ref', 'attachment', 'tags', 'curated', 'created', 'updated'],
  notes: ['type', 'source', 'tags', 'curated', 'created', 'updated'],
  'principle-set': ['type', 'order', 'name', 'tags', 'curated', 'created', 'updated'],
  principle: ['type', 'title', 'set', 'order', 'grounds', 'related', 'tags', 'curated', 'created', 'updated'],
  inbox: ['type', 'note', 'attachment', 'status', 'filed_as', 'tags', 'curated', 'created', 'updated'],
  proposal: ['type', 'kind', 'title', 'target_set', 'target', 'from_source', 'grounds', 'status', 'tags', 'curated', 'created', 'updated'],
  index: ['type'],
};

/** Unconditionally required fields per type (schema §4.1–§4.8). Conditional ones are checked in parse. */
export const REQUIRED: Record<FileType, readonly string[]> = {
  source: ['curated', 'created', 'updated', 'title', 'author'],
  notes: ['curated', 'created', 'updated', 'source'],
  'principle-set': ['curated', 'created', 'updated', 'order'],
  principle: ['curated', 'created', 'updated', 'title', 'set', 'order', 'grounds'],
  inbox: ['curated', 'created', 'updated', 'status'],
  proposal: ['curated', 'created', 'updated', 'kind', 'title', 'status'],
  index: [],
};

/** `status` values are type-specific even though the field name is shared. */
export const STATUS_VALUES: Partial<Record<FileType, readonly string[]>> = {
  inbox: INBOX_STATUSES,
  proposal: PROPOSAL_STATUSES,
};

/** ISO 8601 as the schema writes it: `2026-09-05` or `2026-09-05T14:30:12Z` (schema §4). */
export const DATETIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z)?$/;

/** The current instant in the schema's datetime form, `YYYY-MM-DDTHH:MM:SSZ` (no fractional seconds). */
export function nowUtc(date: Date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
