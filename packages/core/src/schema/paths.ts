// Repository layout (schema §2, §4): which paths carry frontmatter, and
// which file type a path is expected to hold.

import type { FileType } from './types';
import { isInboxStem, isPrincipleSlug, isProposalId, isSetSlug, isSourceSlug } from './identifiers';

/** Files exempt from frontmatter: AGENTS.md, README.md, templates/*, dot-directories (schema §4). */
export function isExemptPath(path: string): boolean {
  const parts = path.split('/');
  if (parts.some((p) => p.startsWith('.'))) return true;
  if (parts.length === 1 && (path === 'AGENTS.md' || path === 'README.md')) return true;
  if (parts[0] === 'templates') return true;
  return false;
}

/** `.md` files that must carry frontmatter and are validated, indexed, and assembled. */
export function isFrontmatterPath(path: string): boolean {
  return path.endsWith('.md') && !isExemptPath(path);
}

export interface PathInfo {
  type: FileType;
  /** For sources/notes: the source slug. For sets/principles: the set slug. */
  folder?: string;
  /** For principles, inbox captures, and proposals: the file's own identifier (stem without `.md`). */
  name?: string;
}

/** What the layout says a `.md` path must contain, or undefined when the path is outside the layout. */
export function pathInfo(path: string): PathInfo | undefined {
  const parts = path.split('/');
  const stem = (s: string) => s.slice(0, -3);
  if (parts.length === 2 && parts[0] === 'inbox' && parts[1]!.endsWith('.md')) {
    return { type: 'inbox', name: stem(parts[1]!) };
  }
  if (parts.length === 3 && parts[0] === 'sources') {
    if (parts[2] === 'raw.md') return { type: 'source', folder: parts[1]! };
    if (parts[2] === 'notes.md') return { type: 'notes', folder: parts[1]! };
    return undefined;
  }
  if (path === 'principles/_index.md' || path === 'maps/_index.md') return { type: 'index' };
  if (parts.length === 3 && parts[0] === 'principles' && parts[2]!.endsWith('.md')) {
    if (parts[2] === '_set.md') return { type: 'principle-set', folder: parts[1]! };
    return { type: 'principle', folder: parts[1]!, name: stem(parts[2]!) };
  }
  if (parts.length === 3 && parts[0] === 'maps' && parts[1] === 'proposals' && parts[2]!.endsWith('.md')) {
    return { type: 'proposal', name: stem(parts[2]!) };
  }
  return undefined;
}

/** Identifier problems in a path, as messages; empty when every identifier is well-formed (schema §3). */
export function pathIdentifierProblems(info: PathInfo): string[] {
  const out: string[] = [];
  switch (info.type) {
    case 'source':
    case 'notes':
      if (!isSourceSlug(info.folder!)) out.push(`source slug '${info.folder}' is malformed`);
      break;
    case 'principle-set':
      if (!isSetSlug(info.folder!)) out.push(`set slug '${info.folder}' is malformed`);
      break;
    case 'principle':
      if (!isSetSlug(info.folder!)) out.push(`set slug '${info.folder}' is malformed`);
      if (!isPrincipleSlug(info.name!)) out.push(`principle slug '${info.name}' is malformed`);
      break;
    case 'inbox':
      if (!isInboxStem(info.name!)) out.push(`inbox stem '${info.name}' is malformed`);
      break;
    case 'proposal':
      if (!isProposalId(info.name!)) out.push(`proposal id '${info.name}' is malformed`);
      break;
    case 'index':
      break;
  }
  return out;
}
