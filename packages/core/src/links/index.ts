// links — spec §7.1, schema §6. Dual links are `[[repo/path/no-ext]]` followed
// by ` ([label](relative.md))`; both halves may carry a `#anchor`. Bodies may
// also contain lone wikilinks and lone relative markdown links to `.md` files.

import type { BrainFile, BrainSnapshot, PrincipleFm } from '../schema/types';

export interface LinkRef {
  /** resolved repo-relative path, with `.md` */
  path: string;
  /** heading anchor without the `#`, when present */
  anchor?: string;
  form: 'dual' | 'wiki' | 'relative';
  /** the markdown half's label (dual and relative forms) */
  label?: string;
  /** dual form only: where the relative half resolves when it disagrees with the wikilink */
  mismatch?: string;
  /** span in the body, `[start, end)` */
  start: number;
  end: number;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

/** Resolve `rel` (as written in a markdown link) against the directory of `fromPath`. */
export function resolveRelative(fromPath: string, rel: string): string {
  const out = dirname(fromPath) === '' ? [] : dirname(fromPath).split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

/** The relative link from `fromPath` to `toPath`, as os.path.relpath would write it. */
export function relativePath(fromPath: string, toPath: string): string {
  const from = dirname(fromPath) === '' ? [] : dirname(fromPath).split('/');
  const to = toPath.split('/');
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/');
}

function splitAnchor(target: string): { path: string; anchor?: string } {
  const i = target.indexOf('#');
  if (i === -1) return { path: target };
  const anchor = target.slice(i + 1);
  return anchor ? { path: target.slice(0, i), anchor } : { path: target.slice(0, i) };
}

const WIKI = /\[\[([^\]\n]+?)\]\](?: \(\[([^\]\n]*)\]\(([^)\s]+)\)\))?/g;
const MD = /\[([^\]\n]*)\]\(([^)\s]+)\)/g;
const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i;

/** Every link in a body, in order of appearance. `fromPath` resolves relative links. */
export function parseLinks(body: string, fromPath: string): LinkRef[] {
  const refs: LinkRef[] = [];
  const covered: Array<[number, number]> = [];

  for (const m of body.matchAll(WIKI)) {
    const start = m.index;
    const end = start + m[0].length;
    covered.push([start, end]);
    const target = m[1]!.split('|')[0]!.trim();
    const { path: raw, anchor } = splitAnchor(target);
    const path = raw.endsWith('.md') ? raw : `${raw}.md`;
    const ref: LinkRef = { path, form: m[2] === undefined ? 'wiki' : 'dual', start, end };
    if (anchor !== undefined) ref.anchor = anchor;
    if (m[2] !== undefined) {
      ref.label = m[2];
      const other = resolveRelative(fromPath, splitAnchor(m[3]!).path);
      if (other !== path) ref.mismatch = other;
    }
    refs.push(ref);
  }

  for (const m of body.matchAll(MD)) {
    const start = m.index;
    const end = start + m[0].length;
    if (covered.some(([s, e]) => start >= s && end <= e)) continue;
    const href = m[2]!;
    if (EXTERNAL.test(href) || href.startsWith('/')) continue;
    const { path: rel, anchor } = splitAnchor(href);
    if (!rel.endsWith('.md')) continue;
    const ref: LinkRef = { path: resolveRelative(fromPath, rel), form: 'relative', label: m[1]!, start, end };
    if (anchor !== undefined) ref.anchor = anchor;
    refs.push(ref);
  }

  return refs.sort((a, b) => a.start - b.start);
}

/** The conventional label for a link to `toPath`: raw, notes, principle, set, proposal, capture, or file. */
export function defaultLabel(toPath: string): string {
  if (toPath.endsWith('/raw.md')) return 'raw';
  if (toPath.endsWith('/notes.md')) return 'notes';
  if (toPath.endsWith('/_set.md')) return 'set';
  if (toPath.startsWith('principles/')) return 'principle';
  if (toPath.startsWith('maps/proposals/')) return 'proposal';
  if (toPath.startsWith('inbox/')) return 'capture';
  return 'file';
}

/** The canonical dual-link string (schema §6), as written from `fromPath`. */
export function renderDualLink(fromPath: string, toPath: string, label: string = defaultLabel(toPath), anchor?: string): string {
  const a = anchor ? `#${anchor}` : '';
  return `[[${toPath.replace(/\.md$/, '')}${a}]] ([${label}](${relativePath(fromPath, toPath)}${a}))`;
}

/** Source slugs a body links to via `sources/<slug>/raw`, in order of first reference, deduplicated. */
export function linkedSourceSlugs(body: string, fromPath = 'principles/_/_.md'): string[] {
  const out: string[] = [];
  for (const ref of parseLinks(body, fromPath)) {
    const m = /^sources\/([^/]+)\/raw\.md$/.exec(ref.path);
    if (m && !out.includes(m[1]!)) out.push(m[1]!);
  }
  return out;
}

/** Body source links versus the `grounds` list, in both directions (schema §9 warning, spec §7.1). */
export function groundsDrift(principle: BrainFile<PrincipleFm>): { inBodyOnly: string[]; inGroundsOnly: string[] } {
  const linked = linkedSourceSlugs(principle.body, principle.path);
  return {
    inBodyOnly: linked.filter((s) => !principle.fm.grounds.includes(s)),
    inGroundsOnly: principle.fm.grounds.filter((s) => !linked.includes(s)),
  };
}

/** Inbound references per path, from body links and the referencing frontmatter fields. Index files are ignored. */
export function backlinks(snapshot: BrainSnapshot): Map<string, string[]> {
  const map = new Map<string, Set<string>>();
  const add = (to: string, from: string) => {
    if (to === from) return;
    const set = map.get(to) ?? new Set<string>();
    set.add(from);
    map.set(to, set);
  };
  for (const f of snapshot.files.values()) {
    if (f.fm.type === 'index') continue;
    for (const ref of parseLinks(f.body, f.path)) add(ref.path, f.path);
    switch (f.fm.type) {
      case 'principle':
        for (const g of f.fm.grounds) add(`sources/${g}/raw.md`, f.path);
        for (const r of f.fm.related ?? []) add(`principles/${r}.md`, f.path);
        break;
      case 'proposal':
        if (f.fm.target !== undefined) add(f.fm.kind === 'tag' ? `sources/${f.fm.target}/raw.md` : `principles/${f.fm.target}.md`, f.path);
        if (f.fm.target_set !== undefined) add(`principles/${f.fm.target_set}/_set.md`, f.path);
        if (f.fm.from_source !== undefined) add(`sources/${f.fm.from_source}/raw.md`, f.path);
        for (const g of f.fm.grounds ?? []) add(`sources/${g}/raw.md`, f.path);
        break;
    }
  }
  const out = new Map<string, string[]>();
  for (const to of [...map.keys()].sort(cmp)) out.set(to, [...map.get(to)!].sort(cmp));
  return out;
}
