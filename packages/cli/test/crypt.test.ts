import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ENCRYPTION_CONFIG_PATH, isEncryptablePath, isEncryptedBody, newEncryptionConfig, serializeEncryptionConfig, splitFrontmatter } from '@gnomon/core';
import { run } from '../src/commands';
import { HOOK_MARKER, type Io, PASSPHRASE_ENV } from '../src/crypt';

// Phase 4 block 4: gnomon encrypt / decrypt / guard over a working tree (spec §6.4 "Desktop interop", §13).

const here = fileURLToPath(new URL('.', import.meta.url));
const CLI_DIR = join(here, '..');
const FIXTURE = join(here, '..', '..', 'core', 'fixtures', 'brain');
const PASSPHRASE = 'correct horse battery';
// Far below any preset so the suite stays quick; the config stores them, so the commands use them.
const FAST = { opslimit: 1, memlimit: 8 * 1024 * 1024 };

let gitOk = false;
try {
  execFileSync('git', ['--version'], { stdio: 'ignore' });
  gitOk = true;
} catch {
  gitOk = false;
}

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (dir: string, ...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', env: GIT_ENV });

const withKey: Io = { env: { [PASSPHRASE_ENV]: PASSPHRASE } };
async function cli(io: Io, ...argv: string[]): Promise<{ code: number; out: string[] }> {
  const out: string[] = [];
  const code = await run(argv, (s) => out.push(s), io);
  return { code, out };
}

const temps: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gnomon-crypt-'));
  temps.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Every file under a directory, relative, except .git. */
function files(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      if (n === '.git') continue;
      const f = join(d, n);
      if (statSync(f).isDirectory()) walk(f);
      else out.push(relative(root, f));
    }
  };
  walk(root);
  return out.sort();
}
const read = (dir: string, p: string) => readFileSync(join(dir, p), 'utf8');
const bodyOf = (dir: string, p: string) => splitFrontmatter(read(dir, p))!.body;
const eligible = (dir: string) => files(dir).filter(isEncryptablePath);

/**
 * The fixture in a git repository, encrypted the way the app leaves a brain:
 * the config committed, every eligible body sealed by `gnomon encrypt`, and
 * that committed. Returns the directory.
 */
async function encryptedBrain(): Promise<string> {
  const dir = tempDir();
  cpSync(FIXTURE, dir, { recursive: true });
  const { config } = await newEncryptionConfig(PASSPHRASE, FAST);
  mkdirSync(join(dir, '.gnomon'));
  writeFileSync(join(dir, ENCRYPTION_CONFIG_PATH), serializeEncryptionConfig(config));
  git(dir, 'init', '-q', '-b', 'main');
  const enc = await cli(withKey, 'encrypt', dir);
  expect(enc.code, enc.out.join('\n')).toBe(0);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'Encrypt: 23 files');
  return dir;
}

describe.skipIf(!gitOk)('gnomon encrypt / decrypt', () => {
  it('encrypt seals every eligible body and leaves frontmatter, indexes, the scaffold, and attachments alone', async () => {
    const dir = await encryptedBrain();
    const paths = eligible(dir);
    expect(paths.length).toBe(23);
    for (const p of paths) {
      expect(isEncryptedBody(bodyOf(dir, p)), p).toBe(true);
      expect(splitFrontmatter(read(dir, p))!.yaml).toBe(splitFrontmatter(read(FIXTURE, p))!.yaml);
    }
    for (const p of ['AGENTS.md', 'maps/_index.md', 'principles/_index.md', 'templates/raw.md']) expect(read(dir, p)).toBe(read(FIXTURE, p));
    expect(readFileSync(join(dir, 'sources/didion-why-i-write/original.pdf'))).toEqual(readFileSync(join(FIXTURE, 'sources/didion-why-i-write/original.pdf')));
  }, 60_000);

  it('decrypt then encrypt round-trips: plaintext byte-identical to the fixture, then no diff at all against the commit', async () => {
    const dir = await encryptedBrain();
    const dec = await cli(withKey, 'decrypt', dir);
    expect(dec.code, dec.out.join('\n')).toBe(0);
    expect(dec.out.filter((l) => l.startsWith('decrypted  ')).length).toBe(23);
    expect(dec.out).toContain('decrypt: 23 bodies decrypted. The working tree is plaintext: run gnomon encrypt before every commit, and gnomon decrypt after it.');
    expect(dec.out.some((l) => l.includes('gnomon guard --install'))).toBe(true);
    for (const p of files(FIXTURE)) expect(read(dir, p), p).toBe(read(FIXTURE, p));

    // validate passes in both states; status says the tree is decrypted
    const v = await cli(withKey, 'validate', dir);
    expect(v.code, v.out.join('\n')).toBe(0);
    expect(v.out).toContain('NOTE     encryption is on and 23 bodies are plaintext in the working tree: run gnomon encrypt before committing');
    const st = await cli(withKey, 'status', dir);
    expect(st.out).toContain('encryption:  on, 0 bodies encrypted, 23 plaintext in the working tree');
    expect(st.out.at(-1)).toBe('next:        the working tree is decrypted; run gnomon encrypt before you commit');

    // Ciphertext reuse: nothing was edited, so re-encrypting restores the committed bytes exactly.
    const enc = await cli(withKey, 'encrypt', dir);
    expect(enc.code).toBe(0);
    expect(enc.out).toEqual(['encrypt: 0 bodies sealed, 23 unchanged since the last commit kept their ciphertext. Commit now, then run gnomon decrypt to keep working.']);
    expect(git(dir, 'status', '--porcelain')).toBe('');
    const v2 = await cli(withKey, 'validate', dir);
    expect(v2.code).toBe(0);
    expect(v2.out).toContain('NOTE     23 bodies are encrypted: the link and grounds rules were not checked on them; the frontmatter rules were');
  }, 60_000);

  it('an edit shows as that file alone; a frontmatter-only edit keeps the body ciphertext; a new file is sealed', async () => {
    const dir = await encryptedBrain();
    await cli(withKey, 'decrypt', dir);
    const notes = 'sources/weil-attention/notes.md';
    writeFileSync(join(dir, notes), read(dir, notes) + 'A new line of marginalia.\n');
    const principle = 'principles/ps-g8xw/courage-before-comfort.md';
    writeFileSync(join(dir, principle), read(dir, principle).replace(/^updated: .*$/m, 'updated: 2026-09-26T12:00:00Z'));
    const capture = 'inbox/20260926-120000-abc.md';
    writeFileSync(join(dir, capture), '---\ntype: inbox\nstatus: unfiled\ncurated: human\ncreated: 2026-09-26T12:00:00Z\nupdated: 2026-09-26T12:00:00Z\n---\nA fresh capture.\n');

    const committedPrinciple = git(dir, 'show', `HEAD:${principle}`);
    const enc = await cli(withKey, 'encrypt', dir);
    expect(enc.out.filter((l) => l.startsWith('encrypted  ')).sort()).toEqual([`encrypted  ${capture}`, `encrypted  ${notes}`]);
    expect(git(dir, 'status', '--porcelain').split('\n').filter(Boolean).sort()).toEqual([` M ${principle}`, ` M ${notes}`, `?? ${capture}`]);
    expect(bodyOf(dir, principle)).toBe(splitFrontmatter(committedPrinciple)!.body);
    for (const p of [notes, capture]) expect(isEncryptedBody(bodyOf(dir, p))).toBe(true);

    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'File: edits');
    await cli(withKey, 'decrypt', dir);
    expect(read(dir, notes)).toContain('A new line of marginalia.');
    expect(bodyOf(dir, capture)).toBe('A fresh capture.\n');
  }, 60_000);

  it('a wrong passphrase changes nothing; no passphrase and no terminal says how to give one', async () => {
    const dir = await encryptedBrain();
    const wrong = await cli({ env: { [PASSPHRASE_ENV]: 'not it' } }, 'decrypt', dir);
    expect(wrong.code).toBe(1);
    expect(wrong.out).toEqual(['gnomon: the passphrase does not unlock this brain; nothing was changed']);
    expect(git(dir, 'status', '--porcelain')).toBe('');
    const none = await cli({ env: {} }, 'decrypt', dir);
    expect(none.code).toBe(2);
    expect(none.out[0]).toBe(`gnomon: no passphrase: set ${PASSPHRASE_ENV}, or run this in a terminal to be asked`);
    const asked = await cli({ env: {}, ask: async () => PASSPHRASE }, 'decrypt', dir);
    expect(asked.code).toBe(0);
  }, 60_000);

  it('decrypt refuses a dirty tree unless --force; each command says when there is nothing to do', async () => {
    const dir = await encryptedBrain();
    writeFileSync(join(dir, 'scratch.txt'), 'x');
    const refused = await cli(withKey, 'decrypt', dir);
    expect(refused.code).toBe(1);
    expect(refused.out[0]).toMatch(/^gnomon: 1 uncommitted change; decrypt starts from a committed tree/);
    expect(isEncryptedBody(bodyOf(dir, 'sources/weil-attention/raw.md'))).toBe(true);
    expect((await cli(withKey, 'decrypt', dir, '--force')).code).toBe(0);
    expect((await cli(withKey, 'decrypt', dir)).out).toEqual(['decrypt: nothing to decrypt; every body is already plaintext']);
    await cli(withKey, 'encrypt', dir);
    expect((await cli(withKey, 'encrypt', dir)).out).toEqual(['encrypt: nothing to encrypt; every body is already ciphertext']);
    expect((await cli(withKey, 'encrypt', dir, '--force')).code).toBe(2);
  }, 60_000);

  it('a brain that is not encrypted is refused with the reason', async () => {
    const dir = tempDir();
    cpSync(FIXTURE, dir, { recursive: true });
    for (const cmd of ['encrypt', 'decrypt']) {
      const r = await cli(withKey, cmd, dir);
      expect(r.code).toBe(2);
      expect(r.out).toEqual([`gnomon: this brain is not encrypted (no ${ENCRYPTION_CONFIG_PATH}); turn encryption on in the app`]);
    }
  });
});

describe.skipIf(!gitOk)('gnomon guard', () => {
  it('refuses a staged plaintext body in an encrypted brain and passes once it is encrypted', async () => {
    const dir = await encryptedBrain();
    await cli(withKey, 'decrypt', dir);
    const notes = 'sources/weil-attention/notes.md';
    writeFileSync(join(dir, notes), read(dir, notes) + 'More.\n');
    git(dir, 'add', notes);
    const refused = await cli(withKey, 'guard', dir);
    expect(refused.code).toBe(1);
    expect(refused.out).toEqual([
      `plaintext  ${notes}`,
      'gnomon guard: 1 staged body is plaintext in an encrypted brain; refusing the commit. Run gnomon encrypt, stage again, and commit.',
    ]);
    await cli(withKey, 'encrypt', dir);
    git(dir, 'add', '-A');
    expect(await cli(withKey, 'guard', dir)).toEqual({ code: 0, out: [] });
  }, 60_000);

  it('passes anything in a brain that is not encrypted', async () => {
    const dir = tempDir();
    cpSync(FIXTURE, dir, { recursive: true });
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'add', '-A');
    expect(await cli(withKey, 'guard', dir)).toEqual({ code: 0, out: [] });
  });

  it('--install writes an executable pre-commit hook once, and never overwrites someone else\'s', async () => {
    const dir = await encryptedBrain();
    const hook = join(dir, '.git', 'hooks', 'pre-commit');
    const first = await cli(withKey, 'guard', dir, '--install');
    expect(first.code).toBe(0);
    expect(first.out[0]).toBe(`guard: installed ${hook}; a commit with a plaintext body in this encrypted brain is now refused`);
    expect(read(dir, '.git/hooks/pre-commit')).toContain(HOOK_MARKER);
    expect(statSync(hook).mode & 0o111).not.toBe(0);
    expect((await cli(withKey, 'guard', dir, '--install')).out).toEqual([`guard: already installed in ${hook}`]);
    // decrypt no longer suggests it
    expect((await cli(withKey, 'decrypt', dir)).out.some((l) => l.includes('--install'))).toBe(false);

    writeFileSync(hook, '#!/bin/sh\necho mine\n');
    const foreign = await cli(withKey, 'guard', dir, '--install');
    expect(foreign.code).toBe(1);
    expect(foreign.out[0]).toContain('already exists and is not gnomon\'s');
    expect(read(dir, '.git/hooks/pre-commit')).toBe('#!/bin/sh\necho mine\n');
  }, 60_000);

  it('the installed hook refuses a commit when gnomon-cli cannot run', async () => {
    const dir = await encryptedBrain();
    await cli(withKey, 'guard', dir, '--install');
    writeFileSync(join(dir, 'maps', 'x.md'), 'x');
    git(dir, 'add', '-A');
    // A PATH with git and sh but neither gnomon nor npx: the hook fails closed.
    const bare = tempDir();
    const gitBin = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    const shBin = execFileSync('sh', ['-c', 'command -v sh'], { encoding: 'utf8' }).trim();
    execFileSync('ln', ['-s', gitBin, join(bare, 'git')]);
    execFileSync('ln', ['-s', shBin, join(bare, 'sh')]);
    let failed = false;
    try {
      execFileSync(gitBin, ['commit', '-q', '-m', 'Index'], { cwd: dir, env: { ...GIT_ENV, PATH: bare }, stdio: 'pipe' });
    } catch (e) {
      failed = true;
      expect(String((e as { stderr: Buffer }).stderr)).toContain('cannot run gnomon-cli');
    }
    expect(failed).toBe(true);
  }, 60_000);
});

describe.skipIf(!gitOk)('the built CLI from a scratch clone', () => {
  const bin = join(CLI_DIR, 'dist', 'gnomon.js');
  beforeAll(() => {
    execFileSync('npm', ['run', 'build'], { cwd: CLI_DIR, stdio: 'ignore' });
  }, 120_000);

  it('decrypts, validates, and re-encrypts a clone with no diff, the passphrase from the environment', async () => {
    const origin = await encryptedBrain();
    const clone = join(tempDir(), 'clone');
    git(origin, 'clone', '-q', origin, clone);
    const node = (...a: string[]) => execFileSync(process.execPath, [bin, ...a], { cwd: clone, encoding: 'utf8', env: { ...process.env, [PASSPHRASE_ENV]: PASSPHRASE } });

    expect(node('decrypt')).toContain('decrypt: 23 bodies decrypted.');
    for (const p of files(FIXTURE)) expect(read(clone, p), p).toBe(read(FIXTURE, p));
    expect(node('validate')).toMatch(/0 refusals, 0 warnings\n$/);
    expect(node('encrypt')).toContain('23 unchanged since the last commit kept their ciphertext');
    expect(git(clone, 'status', '--porcelain')).toBe('');
    expect(existsSync(join(clone, ENCRYPTION_CONFIG_PATH))).toBe(true);
  }, 120_000);
});
