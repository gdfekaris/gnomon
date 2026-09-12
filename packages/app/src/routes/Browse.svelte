<script lang="ts">
  // Browse — proposal §6: the sources as a library. A search over what you
  // remember of a source (title, author, work, tags, slug, year; never the
  // passage text), tags with counts and a top twelve, shelves by author and
  // work under the author sort, month landmarks under the date sorts, and
  // fifty rows at a time. Sets live on the Sets screen, captures on Inbox,
  // proposals on Proposals; this screen is for reading what was collected
  // (maintainer, 2026-09-11; at scale, 2026-09-12).
  import { untrack } from 'svelte';
  import { type SourceFm } from '@gnomon/core';
  import { browseHref, linkLabel } from '../lib/markdown';
  import ConnectionNotice from '../lib/components/ConnectionNotice.svelte';
  import { snapshot } from '../lib/stores/snapshot.svelte';
  import { session } from '../lib/stores/session.svelte';
  import { type Prefs, savePrefs, settings } from '../lib/stores/settings.svelte';
  import { route } from '../lib/router.svelte';
  import { lastBrowse } from '../lib/lastBrowse';
  import { PAGE, authorSlug, browseHash, filterActive, filterSources, monthGroups, moreLabel, pageGroups, parseTags, shelfGroups, sortSources, tagCounts, topTags, workLabel } from '../lib/services/browse';

  type Sort = Prefs['browseSort'];
  const SORTS: Array<[Sort, string]> = [['newest', 'Newest'], ['oldest', 'Oldest'], ['author', 'Author']];

  const s = $derived(snapshot.current);
  const tags = $derived(parseTags(route.query.get('tag')));
  const sort = $derived(settings.prefs.browseSort);

  // The query is typed here and mirrored into the hash without a history entry per keystroke; a hash that
  // arrives with a different query (the file page's "← Browse", a reload) wins.
  const urlQ = $derived(route.query.get('q') ?? '');
  let q = $state('');
  $effect(() => { const u = urlQ; untrack(() => { if (u !== q) q = u; }); });
  $effect(() => {
    const hash = browseHash(q, tags);
    lastBrowse.hash = hash;
    if (route.name === 'browse' && route.path === '' && location.hash !== hash && (location.hash || '#/browse') !== hash) history.replaceState(null, '', hash);
  });

  const all = $derived(s ? s.byType('source') : []);
  const counts = $derived(tagCounts(all));
  let allTags = $state(false);
  const visibleTags = $derived(allTags ? [...counts.keys()] : topTags(counts, tags));
  const filter = $derived({ q, tags });
  const active = $derived(filterActive(filter));
  const filtered = $derived(sortSources(filterSources(all, filter), sort));
  const hrefTags = (list: string[]) => browseHash(q, list);
  const hrefToggle = (t: string) => hrefTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t]);

  // Shelves stay open for the session; a filter opens every shelf that has a match.
  let expanded = $state<Record<string, boolean>>({});
  const isOpen = (author: string) => active || !!expanded[author];
  const toggle = (author: string) => { expanded = { ...expanded, [author]: !expanded[author] }; };

  // Fifty rows at a time; the page resets when the search, the tags, or the sort change.
  let shown = $state(PAGE);
  let pageKey = $state('');
  $effect(() => {
    const key = `${q}|${tags.join(',')}|${sort}`;
    untrack(() => { if (key !== pageKey) { pageKey = key; shown = PAGE; } });
  });
  const groups = $derived(sort === 'author' ? shelfGroups(filtered, isOpen) : monthGroups(filtered));
  const paged = $derived(pageGroups(groups, shown));

  const notes = $derived(s && tags.length ? s.byType('notes').filter((f) => tags.every((t) => (f.fm.tags ?? []).includes(t))) : []);
  const detail = (fm: SourceFm) => [
    sort === 'author' ? workLabel(fm) : [fm.author, workLabel(fm)].filter(Boolean).join(', '),
    fm.attachment ? 'attachment' : '',
    fm.curated === 'agent-proposed' ? 'awaiting review' : '',
  ].filter(Boolean).join(' · ');
</script>

<h2>Browse</h2>
{#if !s}
  <ConnectionNotice />
{:else}
  <p class="meta">{session.label} at <code>{s.head.slice(0, 7)}</code> · {s.files.size} files</p>
  <p class="search">
    <input type="search" bind:value={q} placeholder="Search titles, authors, works, tags" aria-label="Search sources" autocomplete="off" data-testid="browse-search" />
    {#if q}<button type="button" class="link" onclick={() => (q = '')} aria-label="Clear the search" data-testid="browse-clear">×</button>{/if}
  </p>
  {#if counts.size}
    <p class="tags" data-testid="tag-filter">
      <a href={hrefTags([])} class="chip" class:active={!tags.length}>all</a>
      {#each visibleTags as t (t)}<a href={hrefToggle(t)} class="chip" class:active={tags.includes(t)}>{t} <small>{counts.get(t)}</small></a>{/each}
      {#if counts.size > visibleTags.length || allTags}
        <button type="button" class="chip" aria-pressed={allTags} onclick={() => (allTags = !allTags)} data-testid="all-tags">{allTags ? 'Fewer tags' : `All tags (${counts.size})`}</button>
      {/if}
    </p>
  {/if}
  <p class="tags sort" data-testid="sort">
    <span>Sort:</span>
    {#each SORTS as [value, label] (value)}
      <button type="button" class="chip" aria-pressed={sort === value} onclick={() => savePrefs({ browseSort: value })} data-testid="sort-{value}">{label}</button>
    {/each}
  </p>
  {#if active}<p class="meta" data-testid="browse-count">{filtered.length} of {all.length} sources</p>{/if}
  <div data-testid="sources">
    {#each paged.groups as g, i (g.author ? `a:${g.author.name}:${g.work?.label ?? ''}` : g.month ? `m:${g.month}` : i)}
      {#if g.author}
        <h3><button type="button" class="shelf" aria-expanded={g.author.open} onclick={() => toggle(g.author!.name)} data-testid="shelf-{authorSlug(g.author.name)}">{g.author.name} <small>· {g.author.count}</small></button></h3>
      {/if}
      {#if g.work}<h4>{g.work.label} <small>· {g.work.count}</small></h4>{/if}
      {#if g.month}<h3>{g.month}</h3>{/if}
      {#if g.rows.length}
        <ul>
          {#each g.rows as f (f.path)}
            <li class="source">
              <a class="title" href={browseHref(f.path)}>{f.fm.title}</a>
              <small class="detail">{detail(f.fm)}</small>
              <small><code>{f.path}</code>{#if sort !== 'author'} · {f.fm.created.slice(0, 10)}{/if}</small>
            </li>
          {/each}
        </ul>
      {/if}
    {/each}
    {#if paged.left > 0}
      <p><button type="button" onclick={() => (shown += PAGE)} data-testid="show-more">{moreLabel(paged.left)}</button></p>
    {/if}
    {#if filtered.length === 0}
      <p class="empty" data-testid="no-sources">
        {#if active && q.trim()}No source matches “{q.trim()}”. <button type="button" class="link" onclick={() => (q = '')}>Clear the search</button>{:else if tags.length}No source is tagged {tags.join(' and ')}.{:else}No sources yet. Filing a capture makes the first one.{/if}
      </p>
    {/if}
  </div>
  {#if notes.length}
    <h3>Notes tagged {tags.join(' and ')}</h3>
    <ul data-testid="notes">{#each notes as f (f.path)}<li><a href={browseHref(f.path)}>{linkLabel(f.path, s)}</a> <small><code>{f.path}</code></small></li>{/each}</ul>
  {/if}
{/if}

<style>
  .search { display: flex; align-items: center; gap: 0.5rem; }
  .search input { flex: 1; }
  /* WebKit draws its own clear glyph in a search field; the screen has one already. */
  .search input::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; }
  .search .link { font-size: var(--fs-h3); line-height: 1; }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .chip small { color: inherit; opacity: 0.75; }
  .sort span { font-size: var(--fs-small); color: var(--muted); }
  h3 .shelf { min-height: 0; padding: 0; border: 0; box-shadow: none; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
  h3 .shelf::before { content: '▸ '; }
  h3 .shelf[aria-expanded='true']::before { content: '▾ '; }
  h3 .shelf:active { background: none; color: inherit; transform: none; }
  h4 { margin: 0.5rem 0 0.4rem; }
  h3 small, h4 small { font-weight: normal; }
  ul { padding-left: 0; list-style: none; }
  /* One boxed row per source, as Inbox and Sets do, so entries stay apart while scrolling. */
  .source { display: grid; gap: 0.15rem; border: var(--bw) solid var(--edge); box-shadow: var(--raise); padding: 0.6rem 0.75rem; margin: 0 0 0.5rem; }
  .title { font-weight: 600; }
  .detail { color: var(--muted); }
  .detail:empty { display: none; }
</style>
