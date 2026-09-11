// The demo brain: the reference fixture (spec §6.3, §17) bundled into the
// app and served through a MemoryDriver. Markdown is inlined at build time;
// the attachments come through `?url`, which Vite resolves to a static
// asset in dev and, for a small file in a production build, to a `data:`
// URL. The CSP's connect-src has no `data:`, so a fetch of that URL fails
// (Safari says "Load failed"); data URLs are decoded here instead.

import { fromBase64 } from '@gnomon/core';
import { MemoryDriver } from '@gnomon/storage';

const texts = import.meta.glob('../../../../core/fixtures/brain/**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const binaries = import.meta.glob('../../../../core/fixtures/brain/**/*.pdf', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

const rel = (key: string) => key.slice(key.indexOf('/fixtures/brain/') + '/fixtures/brain/'.length);

export async function demoDriver(omit: string[] = []): Promise<MemoryDriver> {
  const seed = new Map<string, string | Uint8Array>();
  for (const [key, text] of Object.entries(texts)) seed.set(rel(key), text);
  for (const [key, url] of Object.entries(binaries)) seed.set(rel(key), await bytesOf(url));
  for (const p of omit) seed.delete(p);
  return MemoryDriver.create(seed, {}, 'Initial commit');
}

async function bytesOf(url: string): Promise<Uint8Array> {
  const inline = /^data:[^,]*;base64,(.*)$/.exec(url);
  if (inline) return fromBase64(inline[1]!);
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
}
