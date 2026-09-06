// Connect an existing brain (schema §7.8, spec §12 step 4, US-15): validate
// the layout and the content, and offer to add each missing scaffold item
// as its own commit. The app fixes nothing else and never rewrites an
// existing file; refusals it cannot fix are listed for the curator.

import { type BrainSnapshot, type CommitBatch, type Issue, createSet, indexWrites, nowUtc, validateLayout, validateSnapshot } from '@gnomon/core';
import type { StorageDriver } from '@gnomon/storage';
import type { BrainService } from './brain';

export interface ScaffoldOffer {
  /** the path the offer adds (a folder ends with `/`) */
  path: string;
  label: string;
  batch: CommitBatch;
}

export interface ConnectReport {
  refusals: Issue[];
  warnings: Issue[];
  offers: ScaffoldOffer[];
  /** the `Index` commit that would bring the generated files up to date, or null when they are current */
  indexes: CommitBatch | null;
}

/** Inspect the connected brain. `scaffold` is the bundled template/, path → text. */
export async function inspectBrain(brain: BrainService, driver: StorageDriver, scaffold: ReadonlyMap<string, string>, now: string = nowUtc()): Promise<ConnectReport> {
  const snapshot: BrainSnapshot = brain.snapshot ?? (await brain.refresh());
  const tree = await driver.list();
  const issues = [...validateLayout(tree), ...validateSnapshot(snapshot)];
  const offers: ScaffoldOffer[] = [];
  const head = snapshot.head;

  for (const issue of issues) {
    if (issue.rule !== 'layout.missing') continue;
    if (issue.path.endsWith('/')) {
      offers.push({ path: issue.path, label: `Add the ${issue.path} folder`, batch: { message: `Scaffold: ${issue.path}`, expectedHead: head, writes: [{ path: `${issue.path}.gitkeep`, text: '' }], deletes: [] } });
    } else {
      const text = scaffold.get(issue.path);
      if (text === undefined) continue;
      offers.push({ path: issue.path, label: `Add ${issue.path}`, batch: { message: `Scaffold: ${issue.path}`, expectedHead: head, writes: [{ path: issue.path, text }], deletes: [] } });
    }
  }
  if (issues.some((i) => i.rule === 'sets.none')) {
    const { batch } = createSet(snapshot, { now, slug: 'ps-g8xw' });
    offers.push({ path: 'principles/ps-g8xw/_set.md', label: 'Add Set 1', batch });
  }

  const writes = indexWrites(snapshot);
  const indexes = writes.length ? { message: 'Index', expectedHead: head, writes, deletes: [] } : null;
  const sorted = (level: Issue['level']) => issues.filter((i) => i.level === level);
  return { refusals: sorted('refusal'), warnings: sorted('warning'), offers, indexes };
}

/** Commit one offer (or the index batch), then re-inspect: earlier offers carried the old head. */
export async function applyOffer(brain: BrainService, driver: StorageDriver, scaffold: ReadonlyMap<string, string>, batch: CommitBatch): Promise<ConnectReport> {
  await brain.commit(batch);
  return inspectBrain(brain, driver, scaffold);
}
