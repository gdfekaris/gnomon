// The demo brain: the reference fixture (spec §6.3, §17) bundled into the
// app and served through a MemoryDriver. Markdown is inlined at build time;
// the attachments are static assets fetched when the demo starts.

import { MemoryDriver } from '@gnomon/storage';

const texts = import.meta.glob('../../../../core/fixtures/brain/**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const binaries = import.meta.glob('../../../../core/fixtures/brain/**/*.pdf', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

const rel = (key: string) => key.slice(key.indexOf('/fixtures/brain/') + '/fixtures/brain/'.length);

export async function demoDriver(omit: string[] = []): Promise<MemoryDriver> {
  const seed = new Map<string, string | Uint8Array>();
  for (const [key, text] of Object.entries(texts)) seed.set(rel(key), text);
  for (const [key, url] of Object.entries(binaries)) seed.set(rel(key), new Uint8Array(await (await fetch(url)).arrayBuffer()));
  for (const p of omit) seed.delete(p);
  return MemoryDriver.create(seed, {}, 'Initial commit');
}
