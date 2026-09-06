// Markdown rendering for the file view (spec §2, §7.1, §15). markdown-it with
// html off; a dual link collapses to one anchor into the app; external links
// open in a new tab with noopener; headings carry GitHub-style ids so the
// `#anchor` half of a link lands on the passage.

import MarkdownIt from 'markdown-it';
import { type BrainSnapshot, parseLinks } from '@gnomon/core';

const md = new MarkdownIt({ html: false, linkify: false, breaks: false });

// Heading ids as GitHub writes them: lowercase, punctuation dropped, spaces to hyphens.
export function headingId(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s/g, '-');
}

md.renderer.rules['heading_open'] = (tokens, idx, options, _env, self) => {
  const inline = tokens[idx + 1];
  const text = inline?.children?.filter((t) => t.type === 'text' || t.type === 'code_inline').map((t) => t.content).join('') ?? '';
  tokens[idx]!.attrSet('id', headingId(text));
  return self.renderToken(tokens, idx, options);
};

md.renderer.rules['link_open'] = (tokens, idx, options, _env, self) => {
  const href = String(tokens[idx]!.attrGet('href') ?? '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('#')) {
    tokens[idx]!.attrSet('target', '_blank');
    tokens[idx]!.attrSet('rel', 'noopener noreferrer');
  }
  return self.renderToken(tokens, idx, options);
};

/** The in-app route for a brain path, with an optional heading anchor. */
export function browseHref(path: string, anchor?: string): string {
  return `#/browse/${path}${anchor ? `#${anchor}` : ''}`;
}

/** A label for a link to `path`: the target's title when the snapshot has one, else the path without `.md`. */
export function linkLabel(path: string, snapshot: BrainSnapshot | null): string {
  const fm = snapshot?.files.get(path)?.fm;
  if (fm && 'title' in fm && typeof fm.title === 'string') return fm.title;
  if (fm?.type === 'principle-set') return path.split('/')[1]!;
  return path.replace(/\.md$/, '');
}

/**
 * Rewrite every brain link in `body` to a single markdown link into the app,
 * then render. Spans come from parseLinks, replaced back to front so offsets hold.
 */
export function renderMarkdown(body: string, fromPath: string, snapshot: BrainSnapshot | null): string {
  let text = body;
  const refs = parseLinks(body, fromPath).sort((a, b) => b.start - a.start);
  for (const ref of refs) {
    const label = ref.form === 'wiki' ? linkLabel(ref.path, snapshot) : (ref.label || linkLabel(ref.path, snapshot));
    const link = `[${label.replace(/[[\]]/g, '')}](${browseHref(ref.path, ref.anchor)})`;
    text = text.slice(0, ref.start) + link + text.slice(ref.end);
  }
  return md.render(text);
}
