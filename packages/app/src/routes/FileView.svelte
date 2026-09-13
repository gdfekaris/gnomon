<script lang="ts">
  // One brain file: frontmatter summary, rendered body, backlinks, attachment.
  // No editor in Phase 1; raw.md bodies never get one at all (US-5).
  import ConnectionNotice from '../lib/components/ConnectionNotice.svelte';
  import { type BrainFile, backlinks, setLabel } from '@gnomon/core';
  import MarkdownView from '../lib/components/MarkdownView.svelte';
  import AttachmentView from '../lib/components/AttachmentView.svelte';
  import { browseHref, linkLabel } from '../lib/markdown';
  import { snapshot } from '../lib/stores/snapshot.svelte';
  import { lastBrowse } from '../lib/lastBrowse';
  import { route } from '../lib/router.svelte';

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
  // `filed_as` folds into the status line. The files keep the schema's words (schema §4, §5); the page
  // shows the app's: yours, ratified, awaiting review, not filed, filed as, filed from.
  const skip = new Set(['type', 'title', 'tags', 'filed_as']);
  const CURATED: Record<string, string> = { human: 'yours', ratified: 'ratified', 'agent-proposed': 'awaiting review' };
  const curatedLabel = (v: unknown) => (fm?.['type'] === 'proposal' && v === 'agent-proposed' ? "the model's" : (CURATED[String(v)] ?? String(v)));
  // Arriving from an accepted link proposal: say which ground was added, or that it was one already.
  const added = $derived((route.query.get('added') ?? '').split(',').filter(Boolean));
  const already = $derived(route.query.get('already') === '1');
</script>

<p><a href={lastBrowse.hash} data-testid="back-to-browse">← Browse</a></p>
{#if !s}
  <ConnectionNotice />
{:else if attachment}
  <h2>Attachment</h2>
  <AttachmentView path={attachment} />
{:else if !file || !fm}
  <p class="error">No file at <code>{path}</code>.</p>
{:else}
  <h2>{typeof fm['title'] === 'string' ? fm['title'] : fm['type'] === 'principle-set' ? setLabel(file.fm as never) : path}</h2>
  <p class="meta"><code>{path}</code></p>
  {#if added.length}
    <p class="ok" role="status" data-testid="ground-added"><span>Added {#each added as g, i (g)}{i ? ', ' : ''}<a href={browseHref(`sources/${g}/raw.md`)}>{linkLabel(`sources/${g}/raw.md`, s)}</a>{/each} to the grounds.</span></p>
  {:else if already}
    <p class="ok" role="status" data-testid="ground-added"><span>Already a ground; the proposal is accepted.</span></p>
  {/if}
  <dl data-testid="frontmatter">
    {#each Object.entries(fm).filter(([k]) => !skip.has(k)) as [k, v] (k)}
      {#if k === 'curated'}
        <dt>curated</dt>
        <dd data-testid="fm-curated">{curatedLabel(v)}</dd>
      {:else if k === 'status' && fm['type'] === 'inbox'}
        <dt>status</dt>
        <dd data-testid="fm-status">{#if v === 'filed'}filed as <a href={browseHref(`sources/${fm['filed_as']}/raw.md`)}>{fm['filed_as']}</a>{:else}not filed{/if}</dd>
      {:else if k === 'inbox_ref'}
        <dt>filed from</dt>
        <dd data-testid="fm-filed-from"><a href={browseHref(`inbox/${v}.md`)}>{v}</a></dd>
      {:else}
        <dt>{k}</dt>
        <dd>{Array.isArray(v) ? v.join(', ') : String(v)}</dd>
      {/if}
    {/each}
    {#if Array.isArray(fm['tags']) && fm['tags'].length}
      <dt>tags</dt>
      <dd>{#each fm['tags'] as t}<a class="chip" href="#/browse?tag={t}">{t}</a> {/each}</dd>
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
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1rem; font-size: var(--fs-small); margin: 0 0 12px; }
  dt { color: var(--muted); }
  dd { margin: 0; }
  ul { padding-left: 0.25rem; list-style: none; }
</style>
