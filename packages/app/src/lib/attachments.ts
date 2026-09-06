// Attachment bytes are fetched on view and cached in memory by blob SHA for
// the session (spec §10.2); nothing is written to device storage (§10.3).
// Rendering rules per spec §15: images inline, PDFs in a new tab, HTML never
// rendered, everything else offered as a download.

import type { StorageDriver } from '@gnomon/storage';

export type AttachmentKind = 'image' | 'pdf' | 'html' | 'text' | 'other';

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg']);
const TEXT = new Set(['txt', 'md', 'csv', 'json', 'xml', 'yaml', 'yml']);

export function attachmentKind(path: string): AttachmentKind {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (IMAGE.has(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'html' || ext === 'htm' || ext === 'xhtml') return 'html';
  if (TEXT.has(ext)) return 'text';
  return 'other';
}

export function mimeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const table: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
    pdf: 'application/pdf', txt: 'text/plain', md: 'text/plain', csv: 'text/csv', json: 'application/json',
  };
  return table[ext] ?? 'application/octet-stream';
}

export interface LoadedAttachment { path: string; sha: string; size: number; kind: AttachmentKind; url: string; bytes: Uint8Array; }

const cache = new Map<string, LoadedAttachment>();

export async function loadAttachment(driver: StorageDriver, path: string, sha?: string): Promise<LoadedAttachment> {
  const key = sha ? `${sha}:${path}` : path;
  const hit = cache.get(key);
  if (hit) return hit;
  const { bytes, sha: blobSha } = await driver.readBytes(path);
  const kind = attachmentKind(path);
  // HTML is served as plain text so a captured page can never run script in the app's origin.
  const type = kind === 'html' ? 'text/plain' : mimeFor(path);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const loaded = { path, sha: blobSha, size: bytes.length, kind, url, bytes };
  cache.set(key, loaded);
  return loaded;
}

export function clearAttachmentCache(): void {
  for (const a of cache.values()) URL.revokeObjectURL(a.url);
  cache.clear();
}
