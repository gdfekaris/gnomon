<script lang="ts">
  // Browse — proposal §6: the sources, by author then work then title as the
  // index groups them, with a tag filter. Sets live on the Sets screen,
  // captures on Inbox, proposals on Proposals; this screen is for reading
  // what was collected (maintainer, 2026-09-11).
  import { type BrainFile, type SourceFm, cmpCodepoint } from '@gnomon/core';
  import { browseHref, linkLabel } from '../lib/markdown';
  import ConnectionNotice from '../lib/components/ConnectionNotice.svelte';
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
  const sources = $derived.by(() => {
    const list = s ? s.byType('source').filter(has) : [];
    return [...list].sort((a, b) => cmpCodepoint(a.fm.author, b.fm.author) || cmpCodepoint(a.fm.work ?? '', b.fm.work ?? '') || cmpCodepoint(a.fm.title, b.fm.title) || cmpCodepoint(a.path, b.path));
  });
  // Sources by author, in the order above; an author's captures from the same work sit together.
  const byAuthor = $derived.by(() => {
    const groups: Array<{ author: string; sources: BrainFile<SourceFm>[] }> = [];
    for (const f of sources) {
      const last = groups[groups.length - 1];
      if (last && last.author === f.fm.author) last.sources.push(f);
      else groups.push({ author: f.fm.author, sources: [f] });
    }
    return groups;
  });
  const notes = $derived(s && tag ? s.byType('notes').filter(has) : []);
  const work = (fm: SourceFm) => (fm.work ? `${fm.work}${fm.year ? ` (${fm.year})` : ''}` : fm.year ? String(fm.year) : '');
</script>

<h2>Browse</h2>
{#if !s}
  <ConnectionNotice />
{:else}
  <p class="meta">{session.label} at <code>{s.head.slice(0, 7)}</code> · {s.files.size} files</p>
  {#if tags.length}
    <p class="tags" data-testid="tag-filter">
      <a href="#/browse" class="chip" class:active={!tag}>all</a>
      {#each tags as t (t)}<a href="#/browse?tag={t}" class="chip" class:active={tag === t}>{t}</a>{/each}
    </p>
  {/if}
  <div data-testid="sources">
    {#each byAuthor as group (group.author)}
      <h3>{group.author}</h3>
      <ul>
        {#each group.sources as f (f.path)}
          <li>
            <a href={browseHref(f.path)}>{f.fm.title}</a>{#if work(f.fm)}<span class="work">, {work(f.fm)}</span>{/if}{#if f.fm.attachment}{' · attachment'}{/if}{#if f.fm.curated !== 'ratified' && f.fm.curated !== 'human'}{` · ${f.fm.curated}`}{/if}
            <small><code>{f.path}</code></small>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="empty" data-testid="no-sources">{tag ? `No source is tagged ${tag}.` : 'No sources yet. Filing a capture makes the first one.'}</p>
    {/each}
  </div>
  {#if notes.length}
    <h3>Notes tagged {tag}</h3>
    <ul data-testid="notes">{#each notes as f (f.path)}<li><a href={browseHref(f.path)}>{linkLabel(f.path, s)}</a> <small><code>{f.path}</code></small></li>{/each}</ul>
  {/if}
{/if}

<style>
  .tags { display: flex; flex-wrap: wrap; gap: 6px; }
  ul { padding-left: 0.25rem; list-style: none; }
  li { margin: 0.35rem 0; }
  .work { color: var(--muted); }
</style>
