// One commit vocabulary (schema §7; tamper-evidence-proposal.md Appendix A.0, block A1).
// Every commit message the code builds is named in schema §7, and every
// message AGENTS.md lets an agent use is too. A message is compared by its
// head: the words before the colon, or the whole message when it has none.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const HEAD = /^([A-Z][a-z]+(?: [a-z]+)*)(:)?/;
const head = (m: string): string | undefined => {
  const h = HEAD.exec(m);
  return h ? h[1] + (h[2] ?? '') : undefined;
};

/** The heads schema §7 names: backticked spans in the section that read as a commit message. */
function schemaHeads(): Set<string> {
  const doc = readFileSync(join(ROOT, 'docs', 'gnomon-schema.md'), 'utf8');
  const s7 = doc.slice(doc.indexOf('\n## 7. Procedures'), doc.indexOf('\n## 8. '));
  const out = new Set<string>();
  for (const [, span] of s7.matchAll(/`([^`\n]+)`/g)) {
    if (!/^[A-Z][a-z]+(?: [a-z]+)*(?:: .+)?$/.test(span!)) continue;
    out.add(head(span!)!);
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|svelte)$/.test(name)) out.push(p);
  }
  return out;
}

/** String and template literals that build a commit: after `message:`, in a `*_MESSAGE` constant, or in a `*Message` helper. */
function codeMessages(): Array<{ file: string; message: string }> {
  const out: Array<{ file: string; message: string }> = [];
  for (const pkg of ['core', 'storage', 'app', 'cli']) {
    for (const file of sourceFiles(join(ROOT, 'packages', pkg, 'src'))) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const at = line.search(/\bmessage: |[A-Z_]+_MESSAGE = |[a-z]+Message = /);
        if (at < 0) continue;
        for (const [, , lit] of line.slice(at).matchAll(/(['`])([A-Z][a-z][^'`]*?)\1/g)) out.push({ file: file.slice(ROOT.length + 1), message: lit! });
      }
    }
  }
  return out;
}

describe('commit vocabulary', () => {
  const heads = schemaHeads();

  it('reads the schema and the code', () => {
    for (const h of ['Capture:', 'File:', 'Ratify:', 'Reject:', 'Index', 'Change passphrase', 'Edit principle:', 'Clear:']) expect(heads).toContain(h);
    expect(codeMessages().length).toBeGreaterThan(20);
  });

  it('names in schema §7 every message the code commits', () => {
    const missing = codeMessages().filter((m) => !heads.has(head(m.message) ?? m.message));
    expect(missing).toEqual([]);
  });

  it('names in schema §7 every message AGENTS.md gives an agent', () => {
    const agents = readFileSync(join(ROOT, 'template', 'AGENTS.md'), 'utf8');
    const discipline = agents.slice(agents.indexOf('## Session discipline'), agents.indexOf('\n## ', agents.indexOf('## Session discipline') + 1));
    const given = [...discipline.matchAll(/`([A-Z][a-z]+(?: [a-z]+)*(?:: [^`]+)?)`/g)].map(([, m]) => m!);
    expect(given.map(head)).toEqual(['Capture:', 'File:', 'Decide:', 'Derive:', 'Relate:', 'Index']);
    expect(given.filter((m) => !heads.has(head(m)!))).toEqual([]);
  });
});
