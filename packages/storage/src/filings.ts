// Filings over a driver (spec §9): list recent filing commits from history,
// reject one by reverting it. Ratification is a core batch committed the
// usual way.

import { type CommitInfo, type FileChange, filingSlug, isFilingCommit, rejectMessage } from '@gnomon/core';
import type { StorageDriver } from './driver';

export interface Filing { sha: string; slug: string; message: string; date: string; changes: FileChange[]; }

/** Filing commits among the last `limit` commits, newest first. */
export async function listFilings(driver: StorageDriver, limit = 50): Promise<Filing[]> {
  const commits = await driver.history({ limit });
  const out: Filing[] = [];
  for (const c of commits) {
    if (!c.message.startsWith('File: ') || c.parents.length !== 1) continue;
    const changes = await driver.compare(c.parents[0]!, c.sha);
    if (!isFilingCommit(c, changes)) continue;
    out.push({ sha: c.sha, slug: filingSlug(changes)!, message: c.message, date: c.date, changes });
  }
  return out;
}

/** The changes of one commit, for a filing chosen from the list. */
export async function changesOf(driver: StorageDriver, info: CommitInfo): Promise<FileChange[]> {
  if (info.parents.length !== 1) throw new Error(`${info.sha} has ${info.parents.length} parents`);
  return driver.compare(info.parents[0]!, info.sha);
}

/** Schema §5 rejection: a single revert of the filing commit. RevertConflictError when later commits built on it. */
export function rejectFiling(driver: StorageDriver, filing: Pick<Filing, 'sha' | 'slug'>): Promise<{ sha: string }> {
  return driver.revert(filing.sha, rejectMessage(filing.slug));
}
