<script lang="ts">
  // One brain file: frontmatter summary, rendered body, backlinks, attachment.
  // No editor in Phase 1; raw.md bodies never get one at all (US-5).
  import { type BrainFile, backlinks, setLabel } from '@gnomon/core';
  import MarkdownView from '../lib/components/MarkdownView.svelte';
  import AttachmentView from '../lib/components/AttachmentView.svelte';
  import { browseHref, linkLabel } from '../lib/markdown';
  import { snapshot } from '../lib/stores/snapshot.svelte';

  let { path, anchor = undefined }: { path: string; anchor?: string | undefined } = $props();
  const s = $derived(snapshot.current);
  const file = $derived(s?.files.get(path) as BrainFile | undefined);
  const attachment = $derived(s?.attachments.has(path) ? path : null);
  const inbound = $derived(s ? (backlinks(s).get(path) ?? []) : []);
  const fm = $derived(file?.fm as Record<string, unknown> | undefined);
  const attachmentPath = $derived.by(() => {
    if (!fm || typeof fm['attachment'] !== 'string') return null;
    return `${path.slice(0, path.lastIndexOf('/'))}/${fm['attachment']}`;
  });
  const skip = new Set(['type', 'title', 'tags']);
</script>

<p><a href="#/browse">← Browse</a></p>
{#if !s}
  <p>No brain loaded.</p>
{:else if attachment}
  <h2>Attachment</h2>
  <AttachmentView path={attachment} />
{:else if !file || !fm}
  <p class="error">No file at <code>{path}</code>.</p>
{:else}
  <h2>{typeof fm['title'] === 'string' ? fm['title'] : fm['type'] === 'principle-set' ? setLabel(file.fm as never) : path}</h2>
  <p class="meta"><code>{path}</code></p>
  <dl data-testid="frontmatter">
    {#each Object.entries(fm).filter(([k]) => !skip.has(k)) as [k, v] (k)}
      <dt>{k}</dt>
      <dd>{Array.isArray(v) ? v.join(', ') : String(v)}</dd>
    {/each}
    {#if Array.isArray(fm['tags']) && fm['tags'].length}
      <dt>tags</dt>
      <dd>{#each fm['tags'] as t}<a class="tag" href="#/browse?tag={t}">{t}</a> {/each}</dd>
    {/if}
  </dl>
  {#if attachmentPath}
    <p><a href={browseHref(attachmentPath)} data-testid="attachment-link">Attachment: {fm['attachment']}</a></p>
  {/if}
  {#if fm['type'] === 'principle' || fm['type'] === 'notes'}
    <p><a href="#/edit/{path}" data-testid="edit-link">Edit</a></p>
  {:else if fm['type'] === 'source'}
    <p><a href="#/edit/{path}" data-testid="edit-link">Edit metadata</a> <small>· the passage text is immutable; corrections go in <a href={browseHref(path.replace(/raw\.md$/, 'notes.md'))}>notes</a></small></p>
  {/if}
  {#if file.body}
    <MarkdownView body={file.body} {path} {anchor} />
  {:else}
    <p class="empty">(empty body)</p>
  {/if}
  <h3>Backlinks</h3>
  <ul data-testid="backlinks">
    {#each inbound as from (from)}
      <li><a href={browseHref(from)}>{linkLabel(from, s)}</a> <small><code>{from}</code></small></li>
    {:else}
      <li class="empty">Nothing links here yet.</li>
    {/each}
  </ul>
{/if}

<style>
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1rem; font-size: 0.9rem; }
  dt { opacity: 0.7; }
  dd { margin: 0; overflow-wrap: anywhere; }
  .meta { opacity: 0.7; }
  .empty { opacity: 0.6; list-style: none; }
  .error { color: #b91c1c; }
  .tag { margin-right: 0.25rem; }
  small { opacity: 0.6; }
</style>
