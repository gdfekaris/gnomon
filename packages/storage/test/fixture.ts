// The reference brain as bytes per path, for seeding drivers under test.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
export const FIXTURE = join(here, '..', '..', 'core', 'fixtures', 'brain');

export function readBrainBytes(root: string = FIXTURE): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === '.git') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(relative(root, full).split('\\').join('/'), new Uint8Array(readFileSync(full)));
    }
  };
  walk(root);
  return out;
}
