<script lang="ts">
  // Browse — proposal §6: the sources, with a tag filter and a sort. Newest
  // first by default (a source's `created` is when it was filed), oldest
  // first, or grouped by author then work then title as the index groups
  // them. Sets live on the Sets screen, captures on Inbox, proposals on
  // Proposals; this screen is for reading what was collected (maintainer,
  // 2026-09-11).
  import { type BrainFile, type SourceFm, cmpCodepoint } from '@gnomon/core';
  import { browseHref, linkLabel } from '../lib/markdown';
  import ConnectionNotice from '../lib/components/ConnectionNotice.svelte';
  import { snapshot } from '../lib/stores/snapshot.svelte';
  import { session } from '../lib/stores/session.svelte';
  import { type Prefs, savePrefs, settings } from '../lib/stores/settings.svelte';
  import { route } from '../lib/router.svelte';

  type Sort = Prefs['browseSort'];
  const SORTS: Array<[Sort, string]> = [['newest', 'Newest'], ['oldest', 'Oldest'], ['author', 'Author']];

  const s = $derived(snapshot.current);
  const tag = $derived(route.query.get('tag'));
  const sort = $derived(settings.prefs.browseSort);
  const tags = $derived.by(() => {
    const all = new Set<string>();
    for (const f of s?.files.values() ?? []) if (f.fm.type !== 'index') for (const t of f.fm.tags ?? []) all.add(t);
    return [...all].sort();
  });
  const has = (f: { fm: { type: string; tags?: string[] } }) => !tag || (f.fm.type !== 'index' && (f.fm.tags ?? []).includes(tag));
  const byAuthorWorkTitle = (a: BrainFile<SourceFm>, b: BrainFile<SourceFm>) =>
    cmpCodepoint(a.fm.author, b.fm.author) || cmpCodepoint(a.fm.work ?? '', b.fm.work ?? '') || cmpCodepoint(a.fm.title, b.fm.title) || cmpCodepoint(a.path, b.path);
  const byDate = (a: BrainFile<SourceFm>, b: BrainFile<SourceFm>) => cmpCodepoint(a.fm.created, b.fm.created) || cmpCodepoint(a.path, b.path);
  const sources = $derived.by(() => {
    const list = s ? [...s.byType('source').filter(has)] : [];
    if (sort === 'author') return list.sort(byAuthorWorkTitle);
    list.sort(byDate);
    return sort === 'newest' ? list.reverse() : list;
  });
  // Under the author sort, an author's captures sit together under one heading; under a date sort the list is flat.
  const groups = $derived.by(() => {
    if (sort !== 'author') return [{ author: null as string | null, sources }];
    const out: Array<{ author: string | null; sources: BrainFile<SourceFm>[] }> = [];
    for (const f of sources) {
      const last = out[out.length - 1];
      if (last && last.author === f.fm.author) last.sources.push(f);
      else out.push({ author: f.fm.author, sources: [f] });
    }
    return out;
  });
  const notes = $derived(s && tag ? s.byType('notes').filter(has) : []);
  const work = (fm: SourceFm) => (fm.work ? `${fm.work}${fm.year ? ` (${fm.year})` : ''}` : fm.year ? String(fm.year) : '');
  const detail = (fm: SourceFm) => [
    sort === 'author' ? work(fm) : [fm.author, work(fm)].filter(Boolean).join(', '),
    fm.attachment ? 'attachment' : '',
    fm.curated !== 'ratified' && fm.curated !== 'human' ? fm.curated : '',
  ].filter(Boolean).join(' · ');
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
  <p class="tags sort" data-testid="sort">
    <span>Sort:</span>
    {#each SORTS as [value, label] (value)}
      <button type="button" class="chip" aria-pressed={sort === value} onclick={() => savePrefs({ browseSort: value })} data-testid="sort-{value}">{label}</button>
    {/each}
  </p>
  <div data-testid="sources">
    {#each groups as group (group.author ?? '')}
      {#if group.author !== null}<h3>{group.author}</h3>{/if}
      <ul>
        {#each group.sources as f (f.path)}
          <li class="source">
            <a class="title" href={browseHref(f.path)}>{f.fm.title}</a>
            <small class="detail">{detail(f.fm)}</small>
            <small><code>{f.path}</code>{#if sort !== 'author'} · {f.fm.created.slice(0, 10)}{/if}</small>
          </li>
        {/each}
      </ul>
    {/each}
    {#if sources.length === 0}
      <p class="empty" data-testid="no-sources">{tag ? `No source is tagged ${tag}.` : 'No sources yet. Filing a capture makes the first one.'}</p>
    {/if}
  </div>
  {#if notes.length}
    <h3>Notes tagged {tag}</h3>
    <ul data-testid="notes">{#each notes as f (f.path)}<li><a href={browseHref(f.path)}>{linkLabel(f.path, s)}</a> <small><code>{f.path}</code></small></li>{/each}</ul>
  {/if}
{/if}

<style>
  .tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .sort span { font-size: var(--fs-small); color: var(--muted); }
  ul { padding-left: 0; list-style: none; }
  /* One boxed row per source, as Inbox and Sets do, so entries stay apart while scrolling. */
  .source { display: grid; gap: 0.15rem; border: var(--bw) solid var(--edge); box-shadow: var(--raise); padding: 0.6rem 0.75rem; margin: 0 0 0.5rem; }
  .title { font-weight: 600; }
  .detail { color: var(--muted); }
  .detail:empty { display: none; }
</style>
