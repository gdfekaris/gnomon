// Golden brains for tests (spec §17). geo-brain-2 is the maintainer's real
// brain and is only present on their machine; tests over it skip elsewhere.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFrontmatterPath } from '../src/index';

const here = fileURLToPath(new URL('.', import.meta.url));
export const TEMPLATE = join(here, '..', '..', '..', 'template');
export const FIXTURE = join(here, '..', 'fixtures', 'brain');
export const GEO_BRAIN = join(homedir(), 'Desktop', 'main', 'geo-brain-2');
export const hasGeoBrain = existsSync(GEO_BRAIN);

/** Every file under a brain root as { path, text }, repo-relative with `/` separators. */
export function readBrain(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === '.git') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(relative(root, full).split('\\').join('/'), readFileSync(full, 'utf8'));
    }
  };
  walk(root);
  return out;
}

export function frontmatterFiles(root: string): Map<string, string> {
  return new Map([...readBrain(root)].filter(([p]) => isFrontmatterPath(p)));
}
