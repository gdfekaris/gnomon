// Repair — spec §6.5, schema §7.20 "Restore"; integrity-proposal.md §6,
// block I4. When a file no longer matches its seal, find the text that
// does: first among the texts this device kept as they last verified, then
// in the repository's history, at the commit that carried the seal. A text
// is offered only after the verifier itself has passed the brain with that
// text put back, so what "Restore" writes is what the seal names, wherever
// it was found. Restoring signs nothing: the seals already say what the
// files must be. Attached files are not restored here.

import {
  type BrainSnapshot, type DifferenceKind, type SealResult, SEALS_DIR, applyBatch, sealInputFromSnapshot, sealPath, serializeFile, tryParseFile, verifySeals,
} from '@gnomon/core';
import type { CachingDriver, CopyStore } from '@gnomon/storage';
import { type KeptTexts, type SealingContext, type SealingState, STILL_VERIFYING, attachmentDigest, loadSealing } from './sealing';

/** The kept texts over the copy of the brain on this device: a record of path → blob id beside the copy, the texts in the copy's own blobs. */
export function keptTexts(copy: Pick<CachingDriver, 'blob'>, store: CopyStore, id: string, open: (path: string, stored: string) => Promise<string>): KeptTexts & { shas(): Promise<string[]> } {
  const key = `${id}|sealed`;
  const held = async () => ((await store.get(key)) as Record<string, string> | undefined) ?? {};
  return {
    async remember(good, gone) {
      const was = await held();
      const next: Record<string, string> = {};
      for (const [path, sha] of Object.entries(was)) if (!gone(path)) next[path] = sha;
      Object.assign(next, good);
      const same = Object.keys(next).length === Object.keys(was).length && Object.entries(next).every(([p, sha]) => was[p] === sha);
      if (!same) await store.setMany([[key, next]]);
    },
    async text(path) {
      const sha = (await held())[path];
      const stored = sha === undefined ? undefined : await copy.blob(sha);
      return stored === undefined ? undefined : open(path, stored);
    },
    shas: async () => Object.values(await held()),
  };
}

export type RepairKind = DifferenceKind | 'changed' | 'deleted';
export interface RepairItem {
  path: string;
  kind: RepairKind;
  /** the file as it stands, or null when it is gone */
  now: string | null;
  /** the text that matches the seal, or null when none was found (and for a file the seal does not list, which restoring removes) */
  sealed: string | null;
  /** where the sealed text was found */
  from: 'device' | 'history' | null;
  /** restoring this item makes it match its seal again */
  fixable: boolean;
}
export interface RepairPlan { head: string; items: RepairItem[]; /** why the repository's history could not be read, when it was needed and could not be */ historyError: string | null }

const DELETED = new Set(['sealed-source-deleted', 'sealed-capture-deleted']);

/** Everything the last verification found changed, gone, or added: the principles' differences, broken captures and sources, and sealed files that are missing. */
export function damage(state: SealingState): Array<{ path: string; kind: RepairKind }> {
  const out = new Map<string, RepairKind>();
  for (const d of state.differences) out.set(d.path, d.kind);
  for (const [path, v] of Object.entries(state.verdicts)) if (v.verdict === 'broken' && !path.startsWith('principles/')) out.set(path, 'changed');
  for (const f of state.findings) if (DELETED.has(f.code) && f.path.endsWith('.md') && !out.has(f.path)) out.set(f.path, 'deleted');
  return [...out].map(([path, kind]) => ({ path, kind })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The seal file that says what `path` must be: the current manifest, the source's current seal, or the capture's newest content seal. */
function sealFileFor(ctx: SealingContext, path: string): string | undefined {
  const cur = ctx.cache.current;
  if (path.startsWith('principles/')) return cur?.manifest ? sealPath(cur.manifest.payload.key, cur.manifest.payload.seq) : undefined;
  const slug = /^sources\/([^/]+)\/raw\.md$/.exec(path)?.[1];
  if (slug !== undefined) {
    const seal = cur?.sources.get(slug);
    return seal ? sealPath(seal.payload.key, seal.payload.seq) : undefined;
  }
  const stem = /^inbox\/([^/]+)\.md$/.exec(path)?.[1];
  if (stem === undefined) return undefined;
  let best: { path: string; at: string } | undefined;
  for (const [p, text] of ctx.cache.files) {
    if (!p.startsWith(SEALS_DIR)) continue;
    try {
      const payload = (JSON.parse(text) as { payload?: { kind?: string; stem?: string; at?: string } }).payload;
      if ((payload?.kind === 'capture' || payload?.kind === 'attest') && payload.stem === stem && typeof payload.at === 'string' && (!best || payload.at > best.at)) best = { path: p, at: payload.at };
    } catch {
      // not a seal this device can read
    }
  }
  return best?.path;
}

/** How a file's text reads once parsed and written out again, so two texts are compared without their formatting. */
const shown = (path: string, text: string): string => {
  const parsed = tryParseFile(path, text);
  return parsed.ok ? serializeFile(parsed.file) : text;
};

/**
 * Compare what the last verification found wrong with the sealed texts, and
 * say what can be put back. Reads the device's kept texts first and the
 * repository's history only for what the device cannot answer; every text
 * offered has passed verification with all the offered texts in place.
 */
export async function planRepair(ctx: SealingContext): Promise<RepairPlan> {
  const s = ctx.brain.snapshot;
  const record = await ctx.store.get(ctx.brainId);
  if (!s || !record || ctx.state.verifiedHead !== s.head || ctx.state.locked) throw new Error(STILL_VERIFYING);
  const todo = damage(ctx.state);
  const now = (path: string): string | null => {
    const f = s.files.get(path);
    return f ? serializeFile(f) : null;
  };
  /** a candidate worth trying: it exists and is not what the file already says */
  const differs = (path: string, text: string | undefined): text is string => text !== undefined && shown(path, text) !== now(path);

  const choice = new Map<string, { text: string | null; from: RepairItem['from'] }>();
  for (const d of todo) {
    if (d.kind === 'added') {
      choice.set(d.path, { text: null, from: null });
      continue;
    }
    const text = await ctx.kept?.text(d.path).catch(() => undefined);
    if (differs(d.path, text)) choice.set(d.path, { text, from: 'device' });
  }

  let historyError: string | null = null;
  const fromHistory = new Map<string, string>();
  const asked = new Set<string>();
  /** The texts of `paths` at the commits that carried their seals, one read per commit. */
  const readHistory = async (paths: string[]): Promise<void> => {
    const want = paths.filter((p) => !asked.has(p));
    want.forEach((p) => asked.add(p));
    const bySeal = new Map<string, string[]>();
    for (const p of want) {
      const seal = sealFileFor(ctx, p);
      if (seal) bySeal.set(seal, [...(bySeal.get(seal) ?? []), p]);
    }
    if (bySeal.size === 0) return;
    try {
      if (!ctx.driver.readManyAt) throw new Error('this brain’s storage cannot read its history');
      for (const [seal, ps] of bySeal) {
        // A seal file is written once; an encrypted brain rewrote it since. The oldest commit is the one that sealed.
        const commits = await ctx.driver.history({ limit: 20, path: seal });
        const first = commits[commits.length - 1];
        if (!first) continue;
        for (const [p, r] of await ctx.driver.readManyAt(first.sha, ps)) fromHistory.set(p, r.text);
      }
    } catch (e) {
      historyError = e instanceof Error ? e.message : String(e);
    }
  };
  const useHistory = (paths: string[]): boolean => {
    let any = false;
    for (const p of paths) {
      const text = fromHistory.get(p);
      if (differs(p, text) && choice.get(p)?.text !== text) {
        choice.set(p, { text, from: 'history' });
        any = true;
      }
    }
    return any;
  };

  const missing = todo.filter((d) => !choice.has(d.path)).map((d) => d.path);
  await readHistory(missing);
  useHistory(missing);

  /** The paths that match their seals once every chosen text is put back. */
  const fixedBy = async (): Promise<Set<string>> => {
    const writes = [...choice].filter((c): c is [string, { text: string; from: RepairItem['from'] }] => c[1].text !== null).map(([path, c]) => ({ path, text: c.text }));
    const deletes = [...choice].filter(([path, c]) => c.text === null && s.files.has(path)).map(([path]) => path);
    let after: BrainSnapshot;
    try {
      after = applyBatch(s, { message: '', expectedHead: s.head, writes, deletes });
    } catch {
      return new Set();
    }
    const r: SealResult = await verifySeals(sealInputFromSnapshot(after, ctx.cache.files, (path) => attachmentDigest(ctx, after, path)), record.root, record.heads, record.revocations ?? {});
    const bad = new Set([...r.differences.map((d) => d.path), ...r.findings.filter((f) => DELETED.has(f.code)).map((f) => f.path)]);
    for (const [path, v] of r.verdicts) if (v.verdict === 'broken') bad.add(path);
    return new Set([...choice.keys()].filter((p) => !bad.has(p)));
  };

  let fixed = choice.size ? await fixedBy() : new Set<string>();
  // A kept text that did not pass (the seal was replaced since this device last looked, say) gives way to the one in history.
  const failed = [...choice].filter(([p, c]) => c.from === 'device' && !fixed.has(p)).map(([p]) => p);
  if (failed.length) {
    await readHistory(failed);
    if (useHistory(failed)) fixed = await fixedBy();
  }

  const items = todo.map((d): RepairItem => {
    const c = choice.get(d.path);
    const ok = c !== undefined && fixed.has(d.path);
    return { path: d.path, kind: d.kind, now: now(d.path), sealed: ok && c.text !== null ? c.text : null, from: ok ? c.from : null, fixable: ok };
  });
  return { head: s.head, items, historyError };
}

/** A plan item's sealed text as the comparison shows it: read and written out again, like the current file beside it. */
export const sealedShown = (item: RepairItem): string | null => (item.sealed === null ? null : shown(item.path, item.sealed));

/**
 * "Restore" (schema §7.20): put the sealed text back for the items given,
 * or for every item that can be, in one commit; a file the seal does not
 * list is removed. The write rules that keep a passage from changing do not
 * apply to putting it back, so this commits beside them, and it carries no
 * seal. The brain is then loaded and verified again.
 */
export async function restore(ctx: SealingContext, plan: RepairPlan, paths?: string[]): Promise<number> {
  const s = ctx.brain.snapshot;
  if (!s || s.head !== plan.head) throw new Error('The brain changed since this comparison was made. Wait for it to be compared again, then restore.');
  const items = plan.items.filter((i) => i.fixable && (!paths || paths.includes(i.path)));
  if (items.length === 0) throw new Error('nothing here can be restored');
  const writes = items.filter((i) => i.sealed !== null).map((i) => ({ path: i.path, text: i.sealed! }));
  const deletes = items.filter((i) => i.sealed === null && s.files.has(i.path)).map((i) => i.path);
  await ctx.brain.commitStored({ message: items.length === 1 ? `Restore: ${items[0]!.path}` : `Restore: ${items.length} files`, expectedHead: s.head, writes, deletes }, ctx.driver);
  await ctx.brain.refresh();
  await loadSealing(ctx);
  return items.length;
}
