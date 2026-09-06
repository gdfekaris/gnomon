// Per-write rules (spec §7.4, schema §4.1, §4.2, §4.6, §5, §9): what may
// change between the committed version of a file and the version about to
// be written. validateBatch applies them to a whole CommitBatch against a
// snapshot; applyBatch computes the snapshot that batch would produce.

import type { BrainFile, BrainSnapshot, CommitBatch, CurationState, InboxFm, TreeEntry } from './types';
import { type Issue, refusal } from './issues';
import { isFrontmatterPath } from './paths';
import { tryParseFile } from './parse';
import { serializeFile } from './serialize';
import { buildSnapshot } from './snapshot';

/** Curation transitions a write may make (schema §5). Everything else is a refusal. */
const TRANSITIONS: Record<CurationState, readonly CurationState[]> = {
  'agent-proposed': ['ratified', 'human'],
  ratified: ['human'],
  human: [],
};

/** Rules for rewriting one file. `prev` is the committed version, or undefined for a new file. */
export function validateWrite(prev: BrainFile | undefined, next: BrainFile): Issue[] {
  const issues: Issue[] = [];
  const r = (rule: string, message: string) => issues.push(refusal(next.path, rule, message));
  if (!prev) return issues;

  if (prev.path !== next.path) {
    r('write.path-mismatch', `previous version is '${prev.path}'; files never move`);
    return issues;
  }
  if (prev.fm.type !== next.fm.type) {
    r('write.type-change', `type cannot change from '${prev.fm.type}' to '${next.fm.type}'`);
    return issues;
  }
  if (prev.fm.type === 'index' || next.fm.type === 'index') return issues;

  if (prev.fm.created !== next.fm.created) r('created.immutable', "'created' is set once and never changes");

  if (prev.fm.curated !== next.fm.curated && !TRANSITIONS[prev.fm.curated].includes(next.fm.curated)) {
    r('curated.transition', `curated cannot go from '${prev.fm.curated}' to '${next.fm.curated}'`);
  }

  if (next.fm.type === 'source') {
    if (prev.body !== next.body) r('raw.immutable', 'a raw.md body is immutable in every state; corrections go in notes.md');
    const pa = (prev.fm as { attachment?: string }).attachment;
    const na = next.fm.attachment;
    if (pa !== na) r('attachment.immutable', 'a source attachment cannot be added, removed, or renamed after filing');
  }

  if (next.fm.type === 'inbox') {
    const pf = prev.fm as InboxFm;
    if (prev.body !== next.body) r('inbox.immutable', 'a capture body is never edited');
    if (pf.attachment !== next.fm.attachment) r('inbox.immutable', "a capture's attachment is never changed");
    if (pf.note !== next.fm.note) r('inbox.immutable', "a capture's note is never changed");
  }
  return issues;
}

/** Every refusal a batch would commit: per-file parse rules, per-write rules, and attachment immutability. */
export function validateBatch(snapshot: BrainSnapshot, batch: CommitBatch): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  for (const w of batch.writes) {
    if (seen.has(w.path)) issues.push(refusal(w.path, 'write.duplicate', 'written twice in one batch'));
    seen.add(w.path);
    if (batch.deletes.includes(w.path)) issues.push(refusal(w.path, 'write.duplicate', 'both written and deleted in one batch'));

    if (snapshot.attachments.has(w.path)) {
      issues.push(refusal(w.path, 'attachment.immutable', 'an attachment is immutable from creation; a wrong one is corrected by rejecting the filing'));
      continue;
    }
    if (isFrontmatterPath(w.path)) {
      if (!('text' in w)) {
        issues.push(refusal(w.path, 'write.kind', 'a markdown file must be written as text'));
        continue;
      }
      const parsed = tryParseFile(w.path, w.text);
      if (!parsed.ok) issues.push(...parsed.issues);
      else issues.push(...validateWrite(snapshot.files.get(w.path), parsed.file));
    } else if (w.path.endsWith('.md') && 'bytes' in w) {
      issues.push(refusal(w.path, 'write.kind', 'a markdown file must be written as text'));
    }
  }
  for (const d of batch.deletes) {
    if (d.startsWith('sources/')) {
      issues.push(refusal(d, 'write.delete-source', 'source files are removed only by rejecting the filing (a revert)'));
    }
  }
  return issues;
}

/** The snapshot a batch would produce, computed in memory. Head is left as the batch's expectedHead. */
export function applyBatch(snapshot: BrainSnapshot, batch: CommitBatch): BrainSnapshot {
  const tree = new Map<string, TreeEntry>();
  const texts = new Map<string, { text: string; sha: string }>();
  const enc = new TextEncoder();

  for (const f of snapshot.files.values()) {
    const text = serializeFile(f);
    tree.set(f.path, { path: f.path, sha: f.sha, size: enc.encode(text).length });
    texts.set(f.path, { text, sha: f.sha });
  }
  for (const a of snapshot.attachments.values()) tree.set(a.path, { path: a.path, sha: a.sha, size: a.size });

  for (const d of batch.deletes) {
    tree.delete(d);
    texts.delete(d);
  }
  for (const w of batch.writes) {
    if ('text' in w) {
      tree.set(w.path, { path: w.path, sha: '', size: enc.encode(w.text).length });
      texts.set(w.path, { text: w.text, sha: '' });
    } else {
      tree.set(w.path, { path: w.path, sha: '', size: w.bytes.length });
      texts.delete(w.path);
    }
  }
  return buildSnapshot({ head: batch.expectedHead, tree: [...tree.values()], texts });
}
