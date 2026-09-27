// gnomon encrypt | decrypt | guard — spec §6.4 "Desktop interop", §13;
// Phase 4 block 4. The same body format as the app's encrypting driver, over
// the working tree. `decrypt` turns every encrypted body into plaintext and
// keeps `.gnomon/encryption.json`; `encrypt` seals every plaintext body,
// keeping the committed ciphertext of a body whose plaintext has not changed,
// so an untouched brain round-trips with no diff. In a decrypted tree every
// commit is wrapped: encrypt, commit, decrypt. `guard` is the pre-commit hook
// that refuses a staged plaintext body in an encrypted brain. None of them
// commits.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ENCRYPTION_CONFIG_PATH, WrongPassphraseError, decryptBody, encryptBody, isEncryptablePath, isEncryptedBody, parseEncryptionConfig,
  splitFrontmatter, unlockWithPassphrase,
} from '@gnomon/core';
import type { WorkingTreeDriver } from './worktree';

export type Out = (line: string) => void;

/** Where the passphrase comes from: the environment first, then a hidden prompt when there is a terminal. */
export interface Io {
  env: Record<string, string | undefined>;
  /** Ask for the passphrase without echoing it; undefined when there is no terminal to ask on. */
  ask?: (prompt: string) => Promise<string>;
}

export const PASSPHRASE_ENV = 'GNOMON_PASSPHRASE';
/** Marks a pre-commit hook as ours, so `--install` recognises it and never overwrites someone else's. */
export const HOOK_MARKER = '# gnomon guard';
export const HOOK_SCRIPT = `#!/bin/sh
${HOOK_MARKER}: refuses a commit that would store a plaintext body in an encrypted brain.
# Installed by \`gnomon guard --install\`. When gnomon-cli cannot run, the commit is refused:
# a blocked commit can be retried, a pushed plaintext body cannot be taken back.
if command -v gnomon >/dev/null 2>&1; then
  exec gnomon guard
elif command -v npx >/dev/null 2>&1; then
  exec npx --yes gnomon-cli guard
else
  echo "gnomon guard: cannot run gnomon-cli (no gnomon or npx on PATH); refusing the commit." >&2
  echo "Install Node 20 or newer, or run: npm install -g gnomon-cli" >&2
  exit 1
fi
`;

const join3 = (yaml: string, body: string): string => `---\n${yaml}\n---\n${body}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The encryptable markdown files of the tree, with their text. */
async function bodies(driver: WorkingTreeDriver): Promise<Map<string, string>> {
  const paths = (await driver.list()).map((e) => e.path).filter(isEncryptablePath);
  const texts = await driver.readMany(paths);
  return new Map([...texts].map(([p, r]) => [p, r.text]));
}

function readConfig(driver: WorkingTreeDriver, out: Out) {
  const full = join(driver.root, ENCRYPTION_CONFIG_PATH);
  if (!existsSync(full)) {
    out(`gnomon: this brain is not encrypted (no ${ENCRYPTION_CONFIG_PATH}); turn encryption on in the app`);
    return undefined;
  }
  try {
    return parseEncryptionConfig(readFileSync(full, 'utf8'));
  } catch (e) {
    out(`gnomon: ${(e as Error).message}`);
    return undefined;
  }
}

/** The body key, proved against the config's check before any file is touched. Undefined (with a sentence) on failure. */
async function unlock(driver: WorkingTreeDriver, io: Io, out: Out): Promise<{ key: CryptoKey } | { code: number }> {
  const config = readConfig(driver, out);
  if (!config) return { code: 2 };
  let passphrase = io.env[PASSPHRASE_ENV];
  if (!passphrase) {
    if (!io.ask) {
      out(`gnomon: no passphrase: set ${PASSPHRASE_ENV}, or run this in a terminal to be asked`);
      return { code: 2 };
    }
    passphrase = await io.ask('Passphrase: ');
  }
  try {
    return { key: await unlockWithPassphrase(passphrase, config) };
  } catch (e) {
    if (e instanceof WrongPassphraseError) {
      out('gnomon: the passphrase does not unlock this brain; nothing was changed');
      return { code: 1 };
    }
    if (e instanceof Error && /WebAssembly/.test(e.message)) {
      out(`gnomon: key derivation needs WebAssembly, which this Node does not provide (${e.message})`);
      return { code: 2 };
    }
    throw e;
  }
}

/** Whether our pre-commit hook is installed in this checkout. */
export function guardInstalled(driver: WorkingTreeDriver): boolean {
  const dir = driver.hooksDir();
  if (!dir) return false;
  const hook = join(dir, 'pre-commit');
  return existsSync(hook) && readFileSync(hook, 'utf8').includes(HOOK_MARKER);
}

export async function decrypt(driver: WorkingTreeDriver, opts: { force: boolean }, io: Io, out: Out): Promise<number> {
  if (!readConfig(driver, out)) return 2;
  const texts = await bodies(driver);
  const sealed = [...texts].filter(([, t]) => {
    const s = splitFrontmatter(t);
    return s !== undefined && isEncryptedBody(s.body);
  });
  if (sealed.length === 0) {
    out('decrypt: nothing to decrypt; every body is already plaintext');
    return 0;
  }
  const dirty = driver.uncommitted();
  if (dirty.length && !opts.force) {
    out(`gnomon: ${plural(dirty.length, 'uncommitted change', 'uncommitted changes')}; decrypt starts from a committed tree, right after a pull or a commit. Commit first, or rerun with --force.`);
    return 1;
  }
  const got = await unlock(driver, io, out);
  if ('code' in got) return got.code;

  // Every body is opened before anything is written, so a damaged file leaves the tree as it was.
  const writes: Array<{ path: string; text: string }> = [];
  for (const [path, text] of sealed) {
    const s = splitFrontmatter(text)!;
    try {
      writes.push({ path, text: join3(s.yaml, await decryptBody(got.key, path, s.body)) });
    } catch (e) {
      out(`gnomon: ${(e as Error).message}; nothing was changed`);
      return 1;
    }
  }
  for (const w of writes) writeFileSync(join(driver.root, w.path), w.text);
  for (const w of writes) out(`decrypted  ${w.path}`);
  out(`decrypt: ${plural(writes.length, 'body', 'bodies')} decrypted. The working tree is plaintext: run gnomon encrypt before every commit, and gnomon decrypt after it.`);
  if (driver.isGit && !guardInstalled(driver)) out('NOTE     no commit guard in this checkout; run gnomon guard --install so a plaintext body can never be committed');
  return 0;
}

export async function encrypt(driver: WorkingTreeDriver, io: Io, out: Out): Promise<number> {
  if (!readConfig(driver, out)) return 2;
  const texts = await bodies(driver);
  const open: Array<[string, { yaml: string; body: string }]> = [];
  for (const [path, text] of texts) {
    const s = splitFrontmatter(text);
    if (s && !isEncryptedBody(s.body)) open.push([path, s]);
  }
  if (open.length === 0) {
    out('encrypt: nothing to encrypt; every body is already ciphertext');
    return 0;
  }
  const got = await unlock(driver, io, out);
  if ('code' in got) return got.code;

  // A body whose plaintext equals the committed one keeps its committed ciphertext (spec §6.4, as the app's
  // wrapper does), so only what changed shows in the diff.
  const committed = driver.catFile(open.map(([p]) => `HEAD:${p}`));
  const writes: Array<{ path: string; text: string; kept: boolean }> = [];
  for (const [path, s] of open) {
    const before = committed.get(`HEAD:${path}`);
    const bs = before === undefined ? undefined : splitFrontmatter(before);
    let body: string | undefined;
    if (bs && isEncryptedBody(bs.body)) {
      const plain = await decryptBody(got.key, path, bs.body).catch(() => undefined);
      if (plain === s.body) body = bs.body;
    }
    writes.push({ path, text: join3(s.yaml, body ?? (await encryptBody(got.key, path, s.body))), kept: body !== undefined });
  }
  for (const w of writes) writeFileSync(join(driver.root, w.path), w.text);
  const sealedNew = writes.filter((w) => !w.kept);
  for (const w of sealedNew) out(`encrypted  ${w.path}`);
  const kept = writes.length - sealedNew.length;
  out(`encrypt: ${plural(sealedNew.length, 'body', 'bodies')} sealed${kept ? `, ${kept} unchanged since the last commit kept ${kept === 1 ? 'its' : 'their'} ciphertext` : ''}. Commit now, then run gnomon decrypt to keep working.`);
  return 0;
}

export async function guard(driver: WorkingTreeDriver, opts: { install: boolean }, out: Out): Promise<number> {
  if (!driver.isGit) {
    out('gnomon: guard works in a git checkout; this is not one');
    return 2;
  }
  if (opts.install) return install(driver, out);
  if (!driver.inIndex(ENCRYPTION_CONFIG_PATH)) return 0; // not an encrypted brain: nothing to guard
  const staged = driver.stagedPaths().filter(isEncryptablePath);
  const texts = driver.catFile(staged.map((p) => `:${p}`));
  const plain = staged.filter((p) => {
    const t = texts.get(`:${p}`);
    const s = t === undefined ? undefined : splitFrontmatter(t);
    return s !== undefined && !isEncryptedBody(s.body);
  });
  if (plain.length === 0) return 0;
  for (const p of plain) out(`plaintext  ${p}`);
  out(`gnomon guard: ${plural(plain.length, 'staged body is', 'staged bodies are')} plaintext in an encrypted brain; refusing the commit. Run gnomon encrypt, stage again, and commit.`);
  return 1;
}

function install(driver: WorkingTreeDriver, out: Out): number {
  const dir = driver.hooksDir()!;
  const hook = join(dir, 'pre-commit');
  if (existsSync(hook)) {
    if (readFileSync(hook, 'utf8').includes(HOOK_MARKER)) {
      out(`guard: already installed in ${hook}`);
      return 0;
    }
    out(`gnomon: ${hook} already exists and is not gnomon's; add the line \`gnomon guard || exit 1\` to it yourself`);
    return 1;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(hook, HOOK_SCRIPT);
  chmodSync(hook, 0o755);
  out(`guard: installed ${hook}; a commit with a plaintext body in this encrypted brain is now refused`);
  return 0;
}

/** Read a passphrase from the terminal without echoing it. */
export function askHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  return new Promise((resolve, reject) => {
    process.stderr.write(prompt);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const done = (err?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      process.stderr.write('\n');
      if (err) reject(err);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done();
        if (ch === '\u0003') return done(new Error('cancelled'));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}
