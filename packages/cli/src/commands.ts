// gnomon validate | index | status — spec §13. Same code as the app: the
// core validator and index generator over a snapshot loaded through the
// working-tree driver.

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type BrainSnapshot, type Issue, INDEX_PATHS, hasRefusals, indexWrites, isFrontmatterPath, parseFile, validateLayout,
  validateSnapshot, validateWrite,
} from '@gnomon/core';
import { loadSnapshot } from '@gnomon/storage';
import { WorkingTreeDriver } from './worktree';

export const USAGE = `gnomon <command> [brain-dir]

  validate   check the brain against the schema; nonzero exit on refusals
  index      regenerate principles/_index.md and maps/_index.md if changed
  status     where things stand: unfiled captures, sources, sets, proposals

brain-dir defaults to the current directory. Run inside a brain: npx gnomon-cli validate`;

const COMMANDS = new Set(['validate', 'index', 'status']);
export type Out = (line: string) => void;

/** Returns the process exit code: 0 ok, 1 refusals, 2 usage or not a brain. */
export async function run(argv: string[], out: Out = console.log): Promise<number> {
  const cmd = argv[0];
  if (cmd === undefined || cmd === '--help' || cmd === '-h') {
    out(USAGE);
    return 0;
  }
  if (!COMMANDS.has(cmd)) {
    out(`gnomon: unknown command '${cmd}'\n\n${USAGE}`);
    return 2;
  }
  const dir = resolve(argv[1] ?? '.');
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

function report(issues: Issue[], out: Out): void {
  for (const i of issues) out(`${i.level === 'refusal' ? 'REFUSAL' : 'WARNING'}  ${i.path}: ${i.message}`);
}

async function validate(driver: WorkingTreeDriver, snapshot: BrainSnapshot, out: Out): Promise<number> {
  const issues = [...validateLayout(await driver.list()), ...validateSnapshot(snapshot), ...writeRules(driver, snapshot)];
  report(issues, out);
  for (const w of indexWrites(snapshot)) out(`NOTE     ${w.path}: index is stale; run gnomon index`);
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
  const principles = snapshot.byType('principle').length;
  const open = snapshot.byType('proposal').filter((f) => f.fm.status === 'open').length;
  const refusals = hasRefusals([...validateLayout(await driver.list()), ...validateSnapshot(snapshot)]);
  const stale = indexWrites(snapshot).length > 0;
  const uncommitted = driver.uncommitted();

  out(`inbox:       ${unfiled} unfiled, ${inbox.length - unfiled} filed`);
  out(`sources:     ${sources.length} (${by('ratified')} ratified, ${by('agent-proposed')} awaiting ratification, ${by('human')} by hand)`);
  out(`principles:  ${principles} in ${snapshot.sets.length} set${snapshot.sets.length === 1 ? '' : 's'}`);
  out(`proposals:   ${open} open`);
  out(`indexes:     ${stale ? 'stale' : 'up to date'}`);
  out(driver.isGit ? `git:         ${uncommitted.length ? `${uncommitted.length} uncommitted change${uncommitted.length === 1 ? '' : 's'}` : 'clean'}` : 'git:         not a checkout');

  let nudge: string;
  if (refusals) nudge = 'the brain has refusals; run gnomon validate';
  else if (unfiled) nudge = unfiled === 1 ? '1 capture awaits filing; run /file-inbox' : `${unfiled} captures await filing; run /file-inbox`;
  else if (by('agent-proposed')) nudge = by('agent-proposed') === 1 ? '1 filing awaits ratification in the app' : `${by('agent-proposed')} filings await ratification in the app`;
  else if (open) nudge = open === 1 ? '1 open proposal awaits a decision; run /proposals' : `${open} open proposals await a decision; run /proposals`;
  else if (stale) nudge = 'indexes are stale; run gnomon index';
  else if (uncommitted.length) nudge = 'commit and push';
  else nudge = 'all clear; capture something';
  out(`next:        ${nudge}`);
  return 0;
}
