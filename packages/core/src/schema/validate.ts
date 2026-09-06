// validateSnapshot and validateLayout (spec §7.4, schema §2, §9). Per-file
// rules run in parseFile and arrive here through snapshot.issues; this adds
// every rule that needs more than one file. validateWrite is block 5.

import type { BrainSnapshot, InboxFm, PrincipleFm, ProposalFm, SourceFm, TreeEntry } from './types';
import { type Issue, refusal, warning } from './issues';
import { FIELD_SPECS } from './fields';
import { pathInfo } from './paths';
import { linkedSourceSlugs } from '../links/index';

const TOP_FOLDERS = ['inbox', 'sources', 'principles', 'maps', 'templates'] as const;
const TEMPLATE_FILES = ['raw', 'notes', 'principle', 'set', 'inbox', 'proposal'].map((n) => `templates/${n}.md`);

/** Schema §2 scaffold: AGENTS.md, the five top-level folders, and the six templates. Sets are checked by validateSnapshot. */
export function validateLayout(tree: TreeEntry[]): Issue[] {
  const paths = new Set(tree.map((e) => e.path));
  const issues: Issue[] = [];
  if (!paths.has('AGENTS.md')) issues.push(refusal('AGENTS.md', 'layout.missing', 'AGENTS.md is missing'));
  for (const folder of TOP_FOLDERS) {
    if (![...paths].some((p) => p.startsWith(`${folder}/`))) {
      issues.push(refusal(`${folder}/`, 'layout.missing', `folder '${folder}/' is missing`));
    }
  }
  for (const t of TEMPLATE_FILES) {
    if (!paths.has(t)) issues.push(refusal(t, 'layout.missing', `template '${t}' is missing`));
  }
  return issues;
}

function contiguous(orders: number[]): boolean {
  const sorted = [...orders].sort((a, b) => a - b);
  return sorted.every((o, i) => o === i + 1);
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Every schema §9 rule over a whole brain, refusals and warnings, sorted by path then rule. */
export function validateSnapshot(s: BrainSnapshot): Issue[] {
  const issues: Issue[] = [...s.issues];
  const r = (path: string, rule: string, message: string) => issues.push(refusal(path, rule, message));
  const w = (path: string, rule: string, message: string) => issues.push(warning(path, rule, message));

  const sources = new Map(s.byType('source').map((f) => [pathInfo(f.path)!.folder!, f]));
  const principlePaths = new Set(s.byType('principle').map((f) => f.path));
  const setSlugs = new Set(s.sets.map((f) => pathInfo(f.path)!.folder!));
  const inbox = new Map(s.byType('inbox').map((f) => [pathInfo(f.path)!.name!, f]));

  // --- sets and order (refusals)
  if (s.sets.length === 0) r('principles/', 'sets.none', 'a brain needs at least one principle set');
  else if (!contiguous(s.sets.map((f) => f.fm.order))) {
    r('principles/', 'order.sets', `set order values must be 1..${s.sets.length} with no gaps or repeats`);
  }
  for (const slug of setSlugs) {
    const ps = s.principlesOf(slug);
    if (ps.length && !contiguous(ps.map((f) => f.fm.order))) {
      r(`principles/${slug}`, 'order.principles', `principle order values must be 1..${ps.length} with no gaps or repeats`);
    }
  }
  for (const f of s.byType('principle')) {
    const slug = pathInfo(f.path)!.folder!;
    if (!setSlugs.has(slug)) r(f.path, 'principle.no-set', `folder '${slug}' has no _set.md`);
  }

  // --- source folders and attachments (refusals)
  for (const f of s.byType('notes')) {
    const slug = pathInfo(f.path)!.folder!;
    if (!sources.has(slug)) r(f.path, 'source.missing-raw', `sources/${slug}/ has notes.md but no raw.md`);
  }
  for (const [slug, f] of sources) {
    const fm = f.fm as SourceFm;
    if (fm.attachment !== undefined) {
      if (!/^original\.[a-z0-9]+$/.test(fm.attachment)) {
        r(f.path, 'attachment.name', `a source attachment must be named original.<ext>, not '${fm.attachment}'`);
      } else if (!s.attachments.has(`sources/${slug}/${fm.attachment}`)) {
        r(f.path, 'attachment.missing', `declared attachment '${fm.attachment}' does not exist`);
      }
    }
  }
  for (const stem of inbox.keys()) {
    const f = inbox.get(stem)!;
    const fm = f.fm as InboxFm;
    if (fm.attachment !== undefined) {
      if (!fm.attachment.startsWith(`${stem}.`) || !/^[^./]+\.[a-z0-9]+$/.test(fm.attachment)) {
        r(f.path, 'attachment.name', `an inbox attachment must be named ${stem}.<ext>, not '${fm.attachment}'`);
      } else if (!s.attachments.has(`inbox/${fm.attachment}`)) {
        r(f.path, 'attachment.missing', `declared attachment '${fm.attachment}' does not exist`);
      }
    }
  }
  for (const path of s.attachments.keys()) {
    const parts = path.split('/');
    if (parts[0] === 'sources' && parts.length === 3) {
      const src = sources.get(parts[1]!);
      const declared = src ? (src.fm as SourceFm).attachment : undefined;
      if (!src) r(path, 'source.unexpected-file', `file in a source folder that has no raw.md`);
      else if (parts[2] !== declared) r(path, 'source.unexpected-file', `not raw.md, notes.md, or the declared attachment`);
    } else if (parts[0] === 'inbox' && parts.length === 2) {
      const stem = parts[1]!.replace(/\.[^.]*$/, '');
      const capture = inbox.get(stem);
      if (!capture) r(path, 'inbox.orphan-attachment', `no capture inbox/${stem}.md for this attachment`);
      else if ((capture.fm as InboxFm).attachment !== parts[1]) r(path, 'attachment.undeclared', `inbox/${stem}.md does not declare this attachment`);
    } else {
      w(path, 'attachment.stray', 'file outside inbox/ and sources/ is not part of the brain');
    }
  }

  // --- inbox filing (refusals) and inbox_ref (warnings)
  for (const [stem, f] of inbox) {
    const fm = f.fm as InboxFm;
    if (fm.status === 'filed' && fm.filed_as !== undefined && !sources.has(fm.filed_as)) {
      r(f.path, 'inbox.filed-as-missing', `filed_as '${fm.filed_as}' names no existing source`);
    }
    void stem;
  }
  for (const [slug, f] of sources) {
    const fm = f.fm as SourceFm;
    if (fm.inbox_ref === undefined) continue;
    const capture = inbox.get(fm.inbox_ref);
    if (!capture) w(f.path, 'inbox-ref.stale', `inbox_ref '${fm.inbox_ref}' names no capture (cleared?)`);
    else if ((capture.fm as InboxFm).filed_as !== slug) {
      w(f.path, 'inbox-ref.stale', `inbox/${fm.inbox_ref}.md is filed as '${(capture.fm as InboxFm).filed_as ?? '(unfiled)'}', not '${slug}'`);
    }
  }

  // --- references (warnings)
  for (const f of s.byType('principle')) {
    const fm = f.fm as PrincipleFm;
    for (const g of fm.grounds) {
      if (!sources.has(g)) w(f.path, 'grounds.dangling', `grounds names no source '${g}'`);
    }
    for (const ref of fm.related ?? []) {
      if (!principlePaths.has(`principles/${ref}.md`)) w(f.path, 'related.dangling', `related names no principle '${ref}'`);
    }
    const linked = linkedSourceSlugs(f.body);
    const inBodyOnly = linked.filter((x) => !fm.grounds.includes(x));
    const inGroundsOnly = fm.grounds.filter((x) => !linked.includes(x));
    if (inBodyOnly.length || inGroundsOnly.length) {
      w(f.path, 'grounds.drift', `body links and grounds disagree: body only [${inBodyOnly.join(', ')}], grounds only [${inGroundsOnly.join(', ')}]`);
    }
  }
  for (const f of s.byType('proposal')) {
    const fm = f.fm as ProposalFm;
    if (fm.target_set !== undefined && !setSlugs.has(fm.target_set)) {
      w(f.path, 'target-set.dangling', `target_set names no set '${fm.target_set}'`);
    }
    if (fm.target !== undefined) {
      const ok = fm.kind === 'tag' ? sources.has(fm.target) : principlePaths.has(`principles/${fm.target}.md`);
      if (!ok) w(f.path, 'target.dangling', `target names no ${fm.kind === 'tag' ? 'source' : 'principle'} '${fm.target}'`);
    }
    if (fm.from_source !== undefined && !sources.has(fm.from_source)) {
      w(f.path, 'from-source.dangling', `from_source names no source '${fm.from_source}'`);
    }
    for (const g of fm.grounds ?? []) {
      if (!sources.has(g)) w(f.path, 'grounds.dangling', `grounds names no source '${g}'`);
    }
  }

  // --- unknown frontmatter keys (warnings)
  for (const f of s.files.values()) {
    for (const k of Object.keys(f.fm)) {
      if (!(k in FIELD_SPECS)) w(f.path, 'field.unknown', `unknown field '${k}' is preserved but means nothing to Gnomon`);
    }
  }

  return issues.sort((a, b) => cmp(a.path, b.path) || cmp(a.rule, b.rule) || cmp(a.message, b.message));
}

export const hasRefusals = (issues: Issue[]): boolean => issues.some((i) => i.level === 'refusal');
