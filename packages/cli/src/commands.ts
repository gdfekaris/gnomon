// gnomon validate | index | status | encrypt | decrypt | guard — spec §13.
// Same code as the app: the core validator, index generator, and body
// format over the working tree.

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type BrainSnapshot, type Issue, INDEX_PATHS, hasRefusals, indexWrites, isFrontmatterPath, parseFile, validateLayout,
  validateSnapshot, validateWrite, ENCRYPTION_CONFIG_PATH, encryptedBodyCount, isEncryptablePath, isEncryptedBody,
} from '@gnomon/core';
import { loadSnapshot } from '@gnomon/storage';
import { WorkingTreeDriver } from './worktree';
import { type Io, askHidden, decrypt, encrypt, guard } from './crypt';

export const USAGE = `gnomon <command> [brain-dir]

  validate   check the brain against the schema; nonzero exit on refusals
  index      regenerate principles/_index.md and maps/_index.md if changed
  status     where things stand: unfiled captures, sources, sets, proposals
  decrypt    an encrypted brain's bodies to plaintext in the working tree [--force]
  encrypt    the working tree's plaintext bodies back to ciphertext
  guard      the pre-commit check; --install puts it in this checkout's hooks
  --version  print the version

brain-dir defaults to the current directory. Run inside a brain: npx gnomon-cli validate
encrypt and decrypt read the passphrase from GNOMON_PASSPHRASE, or ask for it.
In a decrypted brain, wrap every commit: gnomon encrypt, git commit, gnomon decrypt.
`;

const COMMANDS = new Set(['validate', 'index', 'status', 'encrypt', 'decrypt', 'guard']);
const FLAGS: Record<string, string> = { '--force': 'decrypt', '--install': 'guard' };
export type Out = (line: string) => void;

const TERMINAL: Io = { env: process.env, ...(process.stdin.isTTY ? { ask: askHidden } : {}) };

/** Returns the process exit code: 0 ok, 1 refusals, 2 usage or not a brain. */
// Stamped by esbuild from package.json at build time; unset under vitest.
declare const __GNOMON_VERSION__: string | undefined;
export const VERSION: string = typeof __GNOMON_VERSION__ === 'string' ? __GNOMON_VERSION__ : '0.0.0-dev';

export async function run(argv: string[], out: Out = console.log, io: Io = TERMINAL): Promise<number> {
  const cmd = argv[0];
  if (cmd === undefined || cmd === '--help' || cmd === '-h') {
    out(USAGE);
    return 0;
  }
  if (cmd === '--version' || cmd === '-v') {
    out(`gnomon-cli ${VERSION}`);
    return 0;
  }
  if (!COMMANDS.has(cmd)) {
    out(`gnomon: unknown command '${cmd}'\n\n${USAGE}`);
    return 2;
  }
  const flags = argv.slice(1).filter((a) => a.startsWith('-'));
  for (const f of flags) {
    if (FLAGS[f] !== cmd) {
      out(`gnomon: '${f}' is not an option of ${cmd}\n\n${USAGE}`);
      return 2;
    }
  }
  const dir = resolve(argv.slice(1).find((a) => !a.startsWith('-')) ?? '.');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    out(`gnomon: '${dir}' is not a directory`);
    return 2;
  }
  const driver = new WorkingTreeDriver(dir);
  const tree = await driver.list();
  if (!tree.some((e) => e.path === 'AGENTS.md' || e.path.startsWith('principles/'))) {
    out(`gnomon: '${dir}' does not look like a brain (no AGENTS.md or principles/)`);
    return 2;
  }
  if (cmd === 'decrypt') return decrypt(driver, { force: flags.includes('--force') }, io, out);
  if (cmd === 'encrypt') return encrypt(driver, io, out);
  if (cmd === 'guard') return guard(driver, { install: flags.includes('--install') }, out);
  const snapshot = await loadSnapshot(driver);
  switch (cmd) {
    case 'validate':
      return validate(driver, snapshot, out);
    case 'index':
      return index(driver, snapshot, out);
    default:
      return status(driver, snapshot, out);
  }
}

/** Schema §9's byte-identical rules need the last commit: compare every modified tracked file against HEAD. */
function writeRules(driver: WorkingTreeDriver, snapshot: BrainSnapshot): Issue[] {
  const issues: Issue[] = [];
  for (const path of driver.modifiedSinceHead()) {
    if (snapshot.attachments.has(path)) {
      issues.push({ level: 'refusal', path, rule: 'attachment.immutable', message: 'attachment differs from its last committed version' });
      continue;
    }
    const current = snapshot.files.get(path);
    if (!current || !isFrontmatterPath(path)) continue;
    const before = driver.committedText(path);
    if (before === undefined) continue;
    try {
      issues.push(...validateWrite(parseFile(path, before), current));
    } catch {
      // the committed version was itself invalid; nothing to compare against
    }
  }
  return issues;
}

/** Plaintext bodies on encryptable paths: in an encrypted brain, the ones a commit must not carry until gnomon encrypt. */
function plaintextCount(snapshot: BrainSnapshot): number {
  let n = 0;
  for (const f of snapshot.files.values()) if (isEncryptablePath(f.path) && !isEncryptedBody(f.body)) n++;
  return n;
}

function report(issues: Issue[], out: Out): void {
  for (const i of issues) out(`${i.level === 'refusal' ? 'REFUSAL' : 'WARNING'}  ${i.path}: ${i.message}`);
}

async function validate(driver: WorkingTreeDriver, snapshot: BrainSnapshot, out: Out): Promise<number> {
  const issues = [...validateLayout(await driver.list()), ...validateSnapshot(snapshot), ...writeRules(driver, snapshot)];
  report(issues, out);
  for (const w of indexWrites(snapshot)) out(`NOTE     ${w.path}: index is stale; run gnomon index`);
  const encrypted = encryptedBodyCount(snapshot);
  if (encrypted) out(`NOTE     ${encrypted} bod${encrypted === 1 ? 'y is' : 'ies are'} encrypted: the link and grounds rules were not checked on them; the frontmatter rules were`);
  const plain = existsSync(resolve(driver.root, ENCRYPTION_CONFIG_PATH)) ? plaintextCount(snapshot) : 0;
  if (plain) out(`NOTE     encryption is on and ${plain} bod${plain === 1 ? 'y is' : 'ies are'} plaintext in the working tree: run gnomon encrypt before committing`);
  if (!driver.isGit) out('NOTE     not a git checkout: the byte-identical-to-last-commit rules were skipped');
  const refusals = issues.filter((i) => i.level === 'refusal').length;
  out(`${snapshot.files.size} files, ${refusals} refusals, ${issues.length - refusals} warnings`);
  return refusals ? 1 : 0;
}

async function index(driver: WorkingTreeDriver, snapshot: BrainSnapshot, out: Out): Promise<number> {
  const writes = indexWrites(snapshot);
  const parseFailures = new Set(snapshot.issues.map((i) => i.path)).size;
  if (parseFailures) out(`WARNING  ${parseFailures} file(s) failed to parse and are not indexed; run gnomon validate`);
  if (writes.length === 0) {
    for (const p of INDEX_PATHS) out(`index: ${p} up to date`);
    return 0;
  }
  await driver.commit({ message: 'Index', expectedHead: snapshot.head, writes, deletes: [] });
  for (const p of INDEX_PATHS) out(writes.some((w) => w.path === p) ? `index: wrote ${p}` : `index: ${p} up to date`);
  return 0;
}

async function status(driver: WorkingTreeDriver, snapshot: BrainSnapshot, out: Out): Promise<number> {
  const inbox = snapshot.byType('inbox');
  const unfiled = inbox.filter((f) => f.fm.status === 'unfiled').length;
  const sources = snapshot.byType('source');
  const by = (state: string) => sources.filter((f) => f.fm.curated === state).length;
  const reserve = snapshot.reserve.length;
  const principles = snapshot.byType('principle').length - reserve;
  const open = snapshot.byType('proposal').filter((f) => f.fm.status === 'open').length;
  const tree = await driver.list();
  const refusals = hasRefusals([...validateLayout(tree), ...validateSnapshot(snapshot)]);
  const stale = indexWrites(snapshot).length > 0;
  const encryptedOn = tree.some((e) => e.path === ENCRYPTION_CONFIG_PATH);
  const encrypted = encryptedBodyCount(snapshot);
  const plain = encryptedOn ? plaintextCount(snapshot) : 0;
  const uncommitted = driver.uncommitted();

  out(`inbox:       ${unfiled} unfiled, ${inbox.length - unfiled} filed`);
  out(`sources:     ${sources.length} (${by('ratified')} ratified, ${by('agent-proposed')} awaiting ratification, ${by('human')} by hand)`);
  out(`principles:  ${principles} in ${snapshot.sets.length} set${snapshot.sets.length === 1 ? '' : 's'}, ${reserve} in reserve`);
  out(`proposals:   ${open} open`);
  out(`encryption:  ${encryptedOn ? `on, ${encrypted} bod${encrypted === 1 ? 'y' : 'ies'} encrypted${plain ? `, ${plain} plaintext in the working tree` : ''}` : 'off'}`);
  out(`indexes:     ${stale ? 'stale' : 'up to date'}`);
  out(driver.isGit ? `git:         ${uncommitted.length ? `${uncommitted.length} uncommitted change${uncommitted.length === 1 ? '' : 's'}` : 'clean'}` : 'git:         not a checkout');

  let nudge: string;
  if (refusals) nudge = 'the brain has refusals; run gnomon validate';
  else if (plain) nudge = 'the working tree is decrypted; run gnomon encrypt before you commit';
  else if (unfiled) nudge = unfiled === 1 ? '1 capture awaits filing; run /file-inbox' : `${unfiled} captures await filing; run /file-inbox`;
  else if (by('agent-proposed')) nudge = by('agent-proposed') === 1 ? '1 filing awaits ratification in the app' : `${by('agent-proposed')} filings await ratification in the app`;
  else if (open) nudge = open === 1 ? '1 open proposal awaits a decision; run /proposals' : `${open} open proposals await a decision; run /proposals`;
  else if (stale) nudge = 'indexes are stale; run gnomon index';
  else if (uncommitted.length) nudge = 'commit and push';
  else nudge = 'all clear; capture something';
  out(`next:        ${nudge}`);
  return 0;
}
