import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { VERSION, run, USAGE } from '../src/commands';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEMPLATE = join(here, '..', '..', '..', 'template');
const FIXTURE = join(here, '..', '..', 'core', 'fixtures', 'brain');

let gitOk = false;
try {
  execFileSync('git', ['--version'], { stdio: 'ignore' });
  gitOk = true;
} catch {
  gitOk = false;
}

async function cli(...argv: string[]): Promise<{ code: number; out: string[] }> {
  const out: string[] = [];
  const code = await run(argv, (s) => out.push(s));
  return { code, out };
}

const temps: string[] = [];
function copyOf(root: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'gnomon-cli-'));
  cpSync(root, dir, { recursive: true });
  temps.push(dir);
  return dir;
}
function gitInit(dir: string): void {
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'Initial commit');
}
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('gnomon cli (spec §13)', () => {
  it('prints usage and exits 0 with no command', async () => {
    const { code, out } = await cli();
    expect(code).toBe(0);
    expect(out[0]).toBe(USAGE);
  });
  it('rejects unknown commands, missing directories, and non-brains with exit 2', async () => {
    expect((await cli('frobnicate')).code).toBe(2);
    expect((await cli('validate', '/definitely/not/here')).code).toBe(2);
    const empty = mkdtempSync(join(tmpdir(), 'gnomon-empty-'));
    temps.push(empty);
    const r = await cli('validate', empty);
    expect(r.code).toBe(2);
    expect(r.out[0]).toContain('does not look like a brain');
  });
});

describe('gnomon validate', () => {
  it('passes the template and the fixture', async () => {
    for (const root of [TEMPLATE, FIXTURE]) {
      const { code, out } = await cli('validate', root);
      expect(code, root).toBe(0);
      expect(out.some((l) => l.startsWith('REFUSAL') || l.startsWith('WARNING'))).toBe(false);
      expect(out.at(-1)).toMatch(/^\d+ files, 0 refusals, 0 warnings$/);
    }
  });
  it('reports refusals and warnings and exits 1 on refusals', async () => {
    const dir = copyOf(FIXTURE);
    writeFileSync(join(dir, 'principles/ps-7k2m/_set.md'), '---\ntype: principle-set\norder: 3\ncurated: human\ncreated: 2026-09-05\nupdated: 2026-09-05\n---\n');
    writeFileSync(join(dir, 'principles/ps-g8xw/courage-before-comfort.md'), readFileSync(join(dir, 'principles/ps-g8xw/courage-before-comfort.md'), 'utf8').replace('  - ps-7k2m/say-the-hard-thing-first', '  - ps-7k2m/nope'));
    const { code, out } = await cli('validate', dir);
    expect(code).toBe(1);
    expect(out).toContain('REFUSAL  principles/: set order values must be 1..2 with no gaps or repeats');
    expect(out.some((l) => l.startsWith("WARNING  principles/ps-g8xw/courage-before-comfort.md: related names no principle 'ps-7k2m/nope'"))).toBe(true);
    expect(out.some((l) => l.startsWith('NOTE     maps/_index.md: index is stale'))).toBe(true);
    expect(out.at(-1)).toBe('24 files, 1 refusals, 1 warnings');
  });
  it('reports a missing scaffold item', async () => {
    const dir = copyOf(TEMPLATE);
    rmSync(join(dir, 'templates/raw.md'));
    const { code, out } = await cli('validate', dir);
    expect(code).toBe(1);
    expect(out).toContain("REFUSAL  templates/raw.md: template 'templates/raw.md' is missing");
  });
  it('notes when the byte-identical rules are skipped outside git', async () => {
    const { out } = await cli('validate', copyOf(FIXTURE));
    expect(out.some((l) => l.includes('not a git checkout'))).toBe(true);
  });
  it.skipIf(!gitOk)('in a git checkout, a changed raw.md body or attachment is a refusal against HEAD', async () => {
    const dir = copyOf(FIXTURE);
    gitInit(dir);
    const clean = await cli('validate', dir);
    expect(clean.code).toBe(0);
    expect(clean.out.some((l) => l.includes('not a git checkout'))).toBe(false);

    const raw = join(dir, 'sources/weil-attention/raw.md');
    writeFileSync(raw, readFileSync(raw, 'utf8') + 'An extra line.\n');
    writeFileSync(join(dir, 'sources/didion-why-i-write/original.pdf'), 'tampered');
    const { code, out } = await cli('validate', dir);
    expect(code).toBe(1);
    expect(out.some((l) => l.startsWith('REFUSAL  sources/weil-attention/raw.md: a raw.md body is immutable'))).toBe(true);
    expect(out.some((l) => l.startsWith('REFUSAL  sources/didion-why-i-write/original.pdf: attachment differs'))).toBe(true);
  });
  it.skipIf(!gitOk)('in a git checkout, ignored files are not part of the brain', async () => {
    const dir = copyOf(FIXTURE);
    gitInit(dir);
    writeFileSync(join(dir, 'maps/.DS_Store'), 'x');
    writeFileSync(join(dir, 'maps/note.png'), 'x');
    const { out } = await cli('validate', dir);
    expect(out.some((l) => l.includes('.DS_Store'))).toBe(false);
    expect(out.some((l) => l.startsWith('WARNING  maps/note.png'))).toBe(true);
  });
});

describe('gnomon index', () => {
  it('writes only what changed, then reports up to date', async () => {
    const dir = copyOf(FIXTURE);
    rmSync(join(dir, 'maps/_index.md'));
    const first = await cli('index', dir);
    expect(first.code).toBe(0);
    expect(first.out).toEqual(['index: principles/_index.md up to date', 'index: wrote maps/_index.md']);
    expect(readFileSync(join(dir, 'maps/_index.md'), 'utf8')).toBe(readFileSync(join(FIXTURE, 'maps/_index.md'), 'utf8'));
    const second = await cli('index', dir);
    expect(second.out).toEqual(['index: principles/_index.md up to date', 'index: maps/_index.md up to date']);
  });
  it('warns when files failed to parse and are missing from the index', async () => {
    const dir = copyOf(FIXTURE);
    writeFileSync(join(dir, 'sources/weil-attention/raw.md'), 'no frontmatter');
    const { out } = await cli('index', dir);
    expect(out[0]).toContain('1 file(s) failed to parse');
  });
});

describe('gnomon status', () => {
  it('counts the fixture and nudges toward filing', async () => {
    const { code, out } = await cli('status', FIXTURE);
    expect(code).toBe(0);
    expect(out).toEqual([
      'inbox:       1 unfiled, 3 filed',
      'sources:     4 (2 ratified, 1 awaiting ratification, 1 by hand)',
      'principles:  4 in 2 sets',
      'proposals:   2 open',
      'indexes:     up to date',
      'git:         not a checkout',
      'next:        1 capture awaits filing; run /file-inbox',
    ]);
  });
  it('the template is all clear', async () => {
    const { out } = await cli('status', TEMPLATE);
    expect(out).toContain('principles:  0 in 1 set');
    expect(out.at(-1)).toBe('next:        all clear; capture something');
  });
  it.skipIf(!gitOk)('reports uncommitted changes in a checkout', async () => {
    const dir = copyOf(TEMPLATE);
    gitInit(dir);
    expect((await cli('status', dir)).out).toContain('git:         clean');
    writeFileSync(join(dir, 'README.md'), 'changed\n');
    expect((await cli('status', dir)).out).toContain('git:         1 uncommitted change');
    expect((await cli('status', dir)).out.at(-1)).toBe('next:        commit and push');
  });
});

describe('gnomon --version', () => {
  it('prints the package version, stamped at build time (a dev placeholder under vitest)', async () => {
    const out: string[] = [];
    expect(await run(['--version'], (l) => out.push(l))).toBe(0);
    expect(out).toEqual([`gnomon-cli ${VERSION}`]);
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-dev)?$/);
  });
});
