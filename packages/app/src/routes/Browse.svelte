<script lang="ts">
  // Browse — proposal §6: folder-aware list with a tag filter; principles
  // grouped by set in set order and precedence order within each set.
  import { setLabel } from '@gnomon/core';
  import { browseHref, linkLabel } from '../lib/markdown';
  import ConnectionNotice from '../lib/components/ConnectionNotice.svelte';
  import Nudge from '../lib/components/Nudge.svelte';
  import { snapshot } from '../lib/stores/snapshot.svelte';
  import { session } from '../lib/stores/session.svelte';
  import { route } from '../lib/router.svelte';

  const s = $derived(snapshot.current);
  const tag = $derived(route.query.get('tag'));
  const tags = $derived.by(() => {
    const all = new Set<string>();
    for (const f of s?.files.values() ?? []) if (f.fm.type !== 'index') for (const t of f.fm.tags ?? []) all.add(t);
    return [...all].sort();
  });
  const has = (f: { fm: { type: string; tags?: string[] } }) => !tag || (f.fm.type !== 'index' && (f.fm.tags ?? []).includes(tag));
  const sources = $derived(s ? s.byType('source').filter(has) : []);
  const captures = $derived(s ? s.byType('inbox').filter(has) : []);
  const proposals = $derived(s ? s.byType('proposal').filter(has) : []);
  const notes = $derived(s ? s.byType('notes').filter(has) : []);
</script>

<h2>Browse</h2>
{#if !s}
  <ConnectionNotice />
{:else}
  <Nudge />
  <p class="meta">{session.label} at <code>{s.head.slice(0, 7)}</code> · {s.files.size} files</p>
  {#if tags.length}
    <p class="tags" data-testid="tag-filter">
      <a href="#/browse" class:active={!tag}>all</a>
      {#each tags as t (t)}<a href="#/browse?tag={t}" class:active={tag === t}>{t}</a>{/each}
    </p>
  {/if}
  {#each s.sets as set (set.path)}
    {@const slug = set.path.split('/')[1]!}
    <h3><a href={browseHref(set.path)}>{setLabel(set.fm)}</a></h3>
    <ol data-testid="set-{slug}">
      {#each s.principlesOf(slug).filter(has) as p (p.path)}
        <li><a href={browseHref(p.path)}>{p.fm.title}</a> <small>· grounds: {p.fm.grounds.length}</small></li>
      {:else}
        <li class="empty">No principles yet. <a href="#/sets/{slug}/new-principle">Write one</a>, or accept a proposal.</li>
      {/each}
    </ol>
  {/each}
  <h3>Sources</h3>
  <ul data-testid="sources">
    {#each sources as f (f.path)}
      <li><a href={browseHref(f.path)}>{f.fm.title}</a>, {f.fm.author}{#if f.fm.attachment}{' · attachment'}{/if}{#if f.fm.curated !== 'ratified' && f.fm.curated !== 'human'}{` · ${f.fm.curated}`}{/if} <small><code>{f.path}</code></small></li>
    {:else}
      <li class="empty">No sources yet. Filing a capture makes the first one.</li>
    {/each}
  </ul>
  {#if notes.length && tag}
    <h3>Notes</h3>
    <ul>{#each notes as f (f.path)}<li><a href={browseHref(f.path)}>{linkLabel(f.path, s)}</a></li>{/each}</ul>
  {/if}
  <h3>Inbox</h3>
  <ul data-testid="inbox">
    {#each captures as f (f.path)}
      <li><a href={browseHref(f.path)}><code>{f.path}</code></a> · {f.fm.status}{#if f.fm.attachment}{' · attachment'}{/if}{#if f.fm.note}{` — ${f.fm.note}`}{/if}</li>
    {:else}
      <li class="empty">Nothing captured yet. <a href="#/capture">Capture something.</a></li>
    {/each}
  </ul>
  <h3>Proposals</h3>
  <ul data-testid="proposals">
    {#each proposals as f (f.path)}
      <li><a href={browseHref(f.path)}>{f.fm.title}</a> · {f.fm.kind} · {f.fm.status} <small><code>{f.path}</code></small></li>
    {:else}
      <li class="empty">No proposals yet. Filing a capture produces them.</li>
    {/each}
  </ul>
  {#if s.issues.length}
    <h3>Files that did not parse</h3>
    <ul>{#each s.issues as i}<li><code>{i.path}</code>: {i.message}</li>{/each}</ul>
  {/if}
{/if}

<style>
  .meta { opacity: 0.7; }
  .empty { opacity: 0.6; list-style: none; }
  small { opacity: 0.7; }
  .tags a { margin-right: 0.5rem; }
  .tags a.active { font-weight: 600; text-decoration: underline; }
</style>
