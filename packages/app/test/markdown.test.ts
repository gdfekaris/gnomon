import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type TreeEntry, buildSnapshot, isFrontmatterPath } from '@gnomon/core';
import { browseHref, headingId, linkLabel, renderMarkdown } from '../src/lib/markdown';
import { attachmentKind, mimeFor } from '../src/lib/attachments';
import { inAppHash, parseRoute } from '../src/lib/route';

const here = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE = join(here, '..', '..', 'core', 'fixtures', 'brain');
const all = new Map<string, string>();
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else all.set(relative(FIXTURE, full).split('\\').join('/'), readFileSync(full, 'utf8'));
  }
};
walk(FIXTURE);
const tree: TreeEntry[] = [...all.keys()].map((path) => ({ path, sha: '', size: 1 }));
const texts = new Map([...all].filter(([p]) => isFrontmatterPath(p)).map(([p, text]) => [p, { text, sha: '' }]));
const snapshot = buildSnapshot({ head: 'h', tree, texts });

describe('renderMarkdown (spec §7.1, §15)', () => {
  const from = 'principles/ps-g8xw/courage-before-comfort.md';
  it('collapses a dual link to one anchor into the app', () => {
    const html = renderMarkdown('See [[sources/aurelius-meditations-4-3/raw]] ([raw](../../sources/aurelius-meditations-4-3/raw.md)).', from, snapshot);
    expect(html).toBe('<p>See <a href="#/browse/sources/aurelius-meditations-4-3/raw.md">raw</a>.</p>\n');
    expect(html.match(/<a /g)!.length).toBe(1);
    expect(html).not.toContain('[[');
  });
  it('labels a lone wikilink with the target title and keeps anchors', () => {
    expect(renderMarkdown('[[sources/didion-why-i-write/raw#part-2]]', from, snapshot)).toBe(
      '<p><a href="#/browse/sources/didion-why-i-write/raw.md#part-2">To find out what I\'m thinking</a></p>\n',
    );
    expect(renderMarkdown('[[principles/ps-7k2m/_set]]', from, snapshot)).toContain('>ps-7k2m<');
    expect(renderMarkdown('[[maps/proposals/P-19990101-001]]', from, snapshot)).toContain('>maps/proposals/P-19990101-001<');
  });
  it('turns lone relative links into app links and leaves external links opening a new tab', () => {
    expect(renderMarkdown('[notes](../../sources/weil-attention/notes.md)', from, snapshot)).toContain('href="#/browse/sources/weil-attention/notes.md"');
    const ext = renderMarkdown('[site](https://example.com/x)', from, snapshot);
    expect(ext).toContain('target="_blank"');
    expect(ext).toContain('rel="noopener noreferrer"');
    expect(renderMarkdown('[a](#/browse/x.md)', from, snapshot)).not.toContain('target=');
  });
  it('never renders raw HTML', () => {
    const html = renderMarkdown('<script>window.pwned = 1</script><b>bold</b>', from, snapshot);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<b>');
  });
  it('gives headings GitHub-style ids', () => {
    expect(headingId('1. The short answer')).toBe('1-the-short-answer');
    expect(headingId('Sense A — The meta as equilibrium (the strict, original sense)')).toBe('sense-a--the-meta-as-equilibrium-the-strict-original-sense');
    expect(renderMarkdown('## What Is "the Meta"?', from, snapshot)).toBe('<h2 id="what-is-the-meta">What Is &quot;the Meta&quot;?</h2>\n');
  });
  it('helpers', () => {
    expect(browseHref('sources/a-b/raw.md', 'x')).toBe('#/browse/sources/a-b/raw.md#x');
    expect(linkLabel('principles/ps-g8xw/courage-before-comfort.md', snapshot)).toBe('Courage before comfort');
    expect(linkLabel('nowhere.md', snapshot)).toBe('nowhere');
  });
});

describe('attachments (spec §15)', () => {
  it('classifies by extension and never gives HTML an HTML mime type', () => {
    expect(attachmentKind('a/original.PNG')).toBe('image');
    expect(attachmentKind('a/original.pdf')).toBe('pdf');
    expect(attachmentKind('a/original.html')).toBe('html');
    expect(attachmentKind('a/original.txt')).toBe('text');
    expect(attachmentKind('a/original.docx')).toBe('other');
    expect(mimeFor('x.jpg')).toBe('image/jpeg');
    expect(mimeFor('x.html')).toBe('application/octet-stream');
  });
});

describe('parseRoute', () => {
  it('splits name, path, query, and heading anchor', () => {
    expect(parseRoute('#/browse/sources/x-y/raw.md#1-the-short-answer')).toMatchObject({ name: 'browse', path: 'sources/x-y/raw.md', anchor: '1-the-short-answer' });
    expect(parseRoute('#/browse?tag=stoicism').query.get('tag')).toBe('stoicism');
    expect(parseRoute('#/browse').path).toBe('');
    expect(parseRoute('').name).toBe('capture');
    expect(parseRoute('#/nope/x').name).toBe('capture');
  });
  it('carries an encoded in-app hash through a query, and inAppHash keeps only those', () => {
    const back = parseRoute(`#/edit/sources/x-y/raw.md?back=${encodeURIComponent('#/inbox?filing=x-y')}`);
    expect(back).toMatchObject({ name: 'edit', path: 'sources/x-y/raw.md', anchor: undefined });
    expect(inAppHash(back.query.get('back'))).toBe('#/inbox?filing=x-y');
    expect(inAppHash('https://example.org/')).toBeUndefined();
    expect(inAppHash('javascript:alert(1)')).toBeUndefined();
    expect(inAppHash(null)).toBeUndefined();
  });
});
