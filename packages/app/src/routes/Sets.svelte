<script lang="ts">
  // Sets — proposal §6, US-18, US-20; the reserve, schema §7.14. The view of
  // every principle: one search over all of them; sets with ordinal and
  // sub-name (new, rename, reorder by drag or arrows, delete with a
  // confirmation naming the count and the dangling report, the per-set
  // description, principle reorder within a set); then "In reserve", the
  // principles held but not in force, newest first or A–Z, with tag chips
  // and pages of fifty. Reserve and place are one tap, two commits each.
  import { untrack } from 'svelte';
  import { hold } from '../lib/press';
  import { type Dangling, RESERVE_SLUG, setLabel } from '@gnomon/core';
  import { brain, describeError } from '../lib/services/index';
  import { type DeletePlan, describeSet, moveSet, movePrinciple, newSet, placePrinciple, placeSet, planDeletePrinciple, planDeleteSet, renameSet } from '../lib/services/sets';
  import { PAGE, TOP_TAGS, moreLabel, tagCounts, topTags } from '../lib/services/browse';
  import { type ReserveSort, filterPrinciples, place, principleFilterActive, principleSlug, reserve, reserveCount, sortReserve } from '../lib/services/reserve';
  import { browseHref } from '../lib/markdown';
  import ConnectionNotice from '../lib/components/ConnectionNotice.svelte';
  import { snapshot } from '../lib/stores/snapshot.svelte';
  import { setsView } from '../lib/stores/sets.svelte';

  const s = $derived(snapshot.current);
  // Every set and the reserve start collapsed (maintainer, 2026-09-16); a tap on the heading opens one, for the
  // session. While a search is on, a set with a match is open and one without stays shut, whatever was tapped.
  const toggleOpen = (key: string) => (setsView.open = setsView.open.includes(key) ? setsView.open.filter((k) => k !== key) : [...setsView.open, key]);
  const isOpen = (key: string, matches: number) => (searching ? matches > 0 : setsView.open.includes(key));
  let busy = $state(false);
  /** which control is doing the work, so it alone stays pressed while the rest are disabled */
  let pressed = $state<string | null>(null);
  let error = $state<string | null>(null);
  let newName = $state('');
  let renaming = $state<string | null>(null);
  let renameValue = $state('');
  let describing = $state<string | null>(null);
  let describeValue = $state('');
  // A principle's delete plan carries its path, so the confirmation can offer the reserve instead of deletion.
  let plan = $state<(DeletePlan & { kind: 'set' | 'principle'; path?: string; inReserve?: boolean }) | null>(null);
  let dragging = $state<{ kind: 'set' | 'principle'; slug: string; set?: string } | null>(null);
  // What the last reserve or place did, with the references that now name a path that is gone.
  let moved = $state<{ kind: 'reserved' | 'placed'; title: string; where: string; path: string; dangling: Dangling[] } | null>(null);

  // The search filters every principle, in sets and in the reserve; the tag chips and the sort apply to the
  // reserve only, since a set's order is precedence and is never re-sorted on screen. Component state: a
  // reload starts clean, and nothing is saved on the device.
  let q = $state('');
  let reserveTags = $state<string[]>([]);
  let allTags = $state(false);
  let sort = $state<ReserveSort>('newest');
  let shown = $state(PAGE);
  const totalPrinciples = $derived(s ? s.byType('principle').length : 0);
  const searching = $derived(principleFilterActive({ q, tags: [] }));
  const reserveAll = $derived(s ? s.reserve : []);
  const reserveFiltered = $derived(s ? sortReserve(filterPrinciples(s.reserve, { q, tags: reserveTags }, s), sort) : []);
  const reserveFilterActive = $derived(principleFilterActive({ q, tags: reserveTags }));
  const counts = $derived(tagCounts(reserveAll));
  const chips = $derived(allTags ? [...counts.keys()] : topTags(counts, reserveTags));
  const reservePage = $derived(reserveFiltered.slice(0, shown));
  const left = $derived(Math.max(0, reserveFiltered.length - shown));
  $effect(() => { void q; void reserveTags; void sort; untrack(() => { shown = PAGE; }); });
  const toggleTag = (t: string) => (reserveTags = reserveTags.includes(t) ? reserveTags.filter((x) => x !== t) : [...reserveTags, t]);
  /** the set each reserve row's select points at, by path */
  let placeTo = $state<Record<string, string>>({});

  const slugOf = (path: string) => path.split('/')[1]!;

  async function run(key: string, action: () => Promise<unknown>) {
    busy = true;
    pressed = key;
    error = null;
    try {
      await action();
    } catch (e) {
      error = describeError(e);
    } finally {
      busy = false;
      pressed = null;
    }
  }
  const create = () => run('new-set', async () => { await newSet(brain, { name: newName.trim() }); newName = ''; });
  const startRename = (slug: string, current: string | undefined) => { renaming = slug; renameValue = current ?? ''; };
  const saveRename = (slug: string) => run(`rename:${slug}`, async () => { await renameSet(brain, slug, renameValue); renaming = null; });
  // Describing a set opens it, so the framing is in view when it is saved.
  const startDescribe = (slug: string, body: string) => { describing = slug; describeValue = body; if (!setsView.open.includes(slug)) setsView.open = [...setsView.open, slug]; };
  const saveDescribe = (slug: string) => run(`describe:${slug}`, async () => { await describeSet(brain, slug, describeValue); describing = null; });
  const askDeleteSet = (slug: string) => { moved = null; plan = { ...planDeleteSet(brain, slug), kind: 'set' }; };
  const askDeletePrinciple = (path: string) => { moved = null; plan = { ...planDeletePrinciple(brain, path), kind: 'principle', path, inReserve: slugOf(path) === RESERVE_SLUG }; };
  const confirmDelete = () => run('delete', async () => { await plan!.commit(); plan = null; });
  // The reserve instead of deletion: the same second commit, after the copy (schema §7.14).
  const reserveInstead = () => run('reserve', async () => {
    const from = s!.sets.find((x) => x.path === `principles/${slugOf(plan!.path!)}/_set.md`);
    const m = await reserve(brain, plan!.path!);
    moved = { kind: 'reserved', title: plan!.label, where: from ? setLabel(from.fm) : 'its set', path: m.path, dangling: m.dangling };
    plan = null;
  });
  const doPlace = (path: string, title: string) => run(`place:${path}`, async () => {
    const to = placeTo[path];
    if (!to) return;
    const set = s!.sets.find((x) => x.path === `principles/${to}/_set.md`);
    const m = await place(brain, path, to);
    moved = { kind: 'placed', title, where: set ? setLabel(set.fm) : to, path: m.path, dangling: m.dangling };
    delete placeTo[path];
  });
  const nudgeSet = (slug: string, direction: -1 | 1) => run(`set:${slug}:${direction}`, () => moveSet(brain, slug, direction));
  const nudgePrinciple = (set: string, slug: string, direction: -1 | 1) => run(`principle:${set}/${slug}:${direction}`, () => movePrinciple(brain, set, slug, direction));

  function dropSet(e: DragEvent, index: number) {
    e.preventDefault();
    if (dragging?.kind === 'set') void run('drop', () => placeSet(brain, dragging!.slug, index));
    dragging = null;
  }
  function dropPrinciple(e: DragEvent, set: string, index: number) {
    e.preventDefault();
    if (dragging?.kind === 'principle' && dragging.set === set && !searching) void run('drop', () => placePrinciple(brain, set, dragging!.slug, index));
    dragging = null;
  }
</script>

<h2>Principle sets</h2>
{#if !s}
  <ConnectionNotice />
{:else}
  <p class="hint">A set is a stance. Order within a set is precedence: when two principles pull against each other, the earlier one governs.</p>

  {#if totalPrinciples > 0}
    <div class="search">
      <input type="search" bind:value={q} placeholder="Search principles: title, tags, grounds" aria-label="Search principles" data-testid="principles-search" />
      {#if q}<button type="button" class="quiet" onclick={() => (q = '')} aria-label="Clear the search" data-testid="principles-clear">×</button>{/if}
    </div>
  {/if}

  {#if moved}
    <p class="ok" role="status" data-testid="moved">
      <span>
        {#if moved.kind === 'reserved'}Kept in reserve: <a href={browseHref(moved.path)}>{moved.title}</a>. It left {moved.where}.{:else}Placed <a href={browseHref(moved.path)}>{moved.title}</a> in {moved.where}.{/if}
        {#if moved.dangling.length}
          These still name the old path: {#each moved.dangling as d, i (d.path + d.ref)}{i ? ', ' : ''}<a href={browseHref(d.path)}><code>{d.path}</code></a>{/each}.
        {/if}
      </span>
      <button type="button" class="quiet" onclick={() => (moved = null)} aria-label="Dismiss">×</button>
    </p>
  {/if}

  {#if plan}
    <div class="confirm" role="alertdialog" data-testid="delete-confirm">
      <p>
        {#if plan.kind === 'set'}
          Delete <strong>{plan.label}</strong> and its {plan.principleCount} principle{plan.principleCount === 1 ? '' : 's'}? Git history keeps them.
        {:else if plan.inReserve}
          Delete the principle <strong>{plan.label}</strong> from the reserve? Git history keeps it.
        {:else}
          Delete the principle <strong>{plan.label}</strong>? Git history keeps it. Or keep it in reserve: held, not in force, listed below.
        {/if}
      </p>
      {#if plan.dangling.length}
        <p>These references will dangle until you edit them:</p>
        <ul data-testid="dangling">{#each plan.dangling as d (d.path + d.ref)}<li><code>{d.path}</code> → {d.ref}</li>{/each}</ul>
      {/if}
      <div class="row">
        {#if plan.kind === 'principle' && !plan.inReserve}
          <button class="primary" onclick={reserveInstead} disabled={busy} use:hold={pressed === 'reserve'} data-testid="reserve-instead">{pressed === 'reserve' ? 'Reserving…' : 'Keep in reserve instead'}</button>
        {/if}
        <button onclick={confirmDelete} disabled={busy} use:hold={pressed === 'delete'} data-testid="delete-confirm-yes">{pressed === 'delete' ? 'Deleting…' : 'Delete'}</button>
        <button onclick={() => (plan = null)} disabled={busy}>Cancel</button>
      </div>
    </div>
  {/if}

  <ol class="sets" data-testid="sets">
    {#each s.sets as set, i (set.path)}
      {@const slug = slugOf(set.path)}
      {@const principles = s.principlesOf(slug)}
      {@const visible = searching ? filterPrinciples(principles, { q, tags: [] }, s) : principles}
      {@const opened = isOpen(slug, visible.length)}
      <li
        class="set"
        data-testid="set-{slug}"
        draggable="true"
        ondragstart={() => (dragging = { kind: 'set', slug })}
        ondragover={(e) => e.preventDefault()}
        ondrop={(e) => dropSet(e, i)}
      >
        <div class="head">
          {#if renaming === slug}
            <input bind:value={renameValue} placeholder="Sub-name (blank for none)" data-testid="rename-input" />
            <button onclick={() => saveRename(slug)} disabled={busy} use:hold={pressed === `rename:${slug}`} data-testid="rename-save">Save</button>
            <button onclick={() => (renaming = null)}>Cancel</button>
          {:else}
            <h3>
              <button type="button" class="toggle" onclick={() => toggleOpen(slug)} aria-expanded={opened} data-testid="set-toggle">
                <span class="caret" aria-hidden="true">{opened ? '▾' : '▸'}</span>
                <span data-testid="set-label">{setLabel(set.fm)}</span>
                {#if searching}
                  <small data-testid="set-match-count">· {visible.length} of {principles.length}</small>
                  {#if visible.length === 0}<small data-testid="no-match">No principle in this set matches.</small>{/if}
                {:else}
                  <small data-testid="set-count">· {principles.length} principle{principles.length === 1 ? '' : 's'}</small>
                {/if}
              </button>
            </h3>
            <span class="controls">
              <button onclick={() => nudgeSet(slug, -1)} disabled={busy || i === 0} use:hold={pressed === `set:${slug}:-1`} aria-label="Move set up" data-testid="set-up">↑</button>
              <button onclick={() => nudgeSet(slug, 1)} disabled={busy || i === s.sets.length - 1} use:hold={pressed === `set:${slug}:1`} aria-label="Move set down" data-testid="set-down">↓</button>
              <button onclick={() => startRename(slug, set.fm.name)} disabled={busy} data-testid="set-rename">Rename</button>
              <button onclick={() => startDescribe(slug, set.body)} disabled={busy} data-testid="set-describe">Describe</button>
              <button onclick={() => askDeleteSet(slug)} disabled={busy || s.sets.length === 1} data-testid="set-delete">Delete</button>
            </span>
          {/if}
        </div>
        {#if describing === slug}
          <label>
            Framing for this set <small>(sent to the model verbatim whenever the set is selected)</small>
            <textarea bind:value={describeValue} rows="4" data-testid="describe-input"></textarea>
          </label>
          <button onclick={() => saveDescribe(slug)} disabled={busy} use:hold={pressed === `describe:${slug}`} data-testid="describe-save">Save</button>
          <button onclick={() => (describing = null)}>Cancel</button>
        {:else if set.body && opened && !searching}
          <p class="framing">{set.body}</p>
        {/if}
        {#if opened}
          <ol class="principles" data-testid="principles-{slug}">
            {#each visible as p, j (p.path)}
              <li
                draggable={!searching}
                ondragstart={(e) => { e.stopPropagation(); dragging = { kind: 'principle', slug: principleSlug(p.path), set: slug }; }}
                ondragover={(e) => e.preventDefault()}
                ondrop={(e) => { e.stopPropagation(); dropPrinciple(e, slug, j); }}
              >
                <span class="num" aria-label="precedence {p.fm.order}">{p.fm.order}.</span>
                <a href={browseHref(p.path)} class="title">{p.fm.title}</a>
                <span class="controls">
                  {#if !searching}
                    <button onclick={() => nudgePrinciple(slug, principleSlug(p.path), -1)} disabled={busy || j === 0} use:hold={pressed === `principle:${slug}/${principleSlug(p.path)}:-1`} aria-label="Move principle up" data-testid="principle-up">↑</button>
                    <button onclick={() => nudgePrinciple(slug, principleSlug(p.path), 1)} disabled={busy || j === principles.length - 1} use:hold={pressed === `principle:${slug}/${principleSlug(p.path)}:1`} aria-label="Move principle down" data-testid="principle-down">↓</button>
                  {/if}
                  <button onclick={() => askDeletePrinciple(p.path)} disabled={busy} aria-label="Delete principle" data-testid="principle-delete">Delete</button>
                </span>
              </li>
            {:else}
              <li class="empty">No principles yet. Write one below, accept a proposal, or add one from the reserve.</li>
            {/each}
          </ol>
          {#if !searching}<p class="foot"><a href="#/sets/{slug}/new-principle" data-testid="new-principle">+ New principle</a> <a href={browseHref(set.path)} class="quiet-link" data-testid="set-file"><small>set file</small></a></p>{/if}
        {/if}
      </li>
    {/each}
  </ol>

  <form class="new" onsubmit={(e) => { e.preventDefault(); void create(); }}>
    <label>New set <input bind:value={newName} placeholder="Optional sub-name, e.g. Work" data-testid="new-set-name" /></label>
    <button type="submit" disabled={busy} use:hold={pressed === 'new-set'} data-testid="new-set">Create Set {s.sets.length + 1}</button>
  </form>

  {@const reserveOpen = isOpen(RESERVE_SLUG, reserveFiltered.length + (searching ? 1 : 0))}
  <section class="reserve" data-testid="reserve">
    <div class="head">
      <h3>
        <button type="button" class="toggle" onclick={() => toggleOpen(RESERVE_SLUG)} aria-expanded={reserveOpen} data-testid="set-toggle">
          <span class="caret" aria-hidden="true">{reserveOpen ? '▾' : '▸'}</span> In reserve <small data-testid="reserve-total">· {reserveAll.length}</small>
        </button>
      </h3>
      {#if reserveOpen && reserveAll.length > 1}
        <span class="controls" role="group" aria-label="Sort the reserve">
          <button type="button" class="chip" class:on={sort === 'newest'} aria-pressed={sort === 'newest'} onclick={() => (sort = 'newest')} data-testid="reserve-sort-newest">Newest</button>
          <button type="button" class="chip" class:on={sort === 'az'} aria-pressed={sort === 'az'} onclick={() => (sort = 'az')} data-testid="reserve-sort-az">A–Z</button>
        </span>
      {/if}
    </div>
    {#if reserveOpen}
    <p class="hint">Principles you hold but are not applying in any set. Nothing here is sent to a model; there is no order because nothing here is in force.</p>
    {#if counts.size}
      <div class="tags" data-testid="reserve-tags">
        {#each chips as t (t)}
          <button type="button" class="chip" class:on={reserveTags.includes(t)} aria-pressed={reserveTags.includes(t)} onclick={() => toggleTag(t)} data-testid="reserve-tag-{t}">{t} <small>{counts.get(t)}</small></button>
        {/each}
        {#if counts.size > TOP_TAGS}
          <button type="button" class="chip" onclick={() => (allTags = !allTags)} data-testid="reserve-all-tags">{allTags ? 'Fewer tags' : `All tags (${counts.size})`}</button>
        {/if}
        {#if reserveTags.length}<button type="button" class="link" onclick={() => (reserveTags = [])} data-testid="reserve-clear-tags">Clear tags</button>{/if}
      </div>
    {/if}
    {#if reserveFilterActive}<p class="meta" data-testid="reserve-count">{reserveCount(reserveFiltered.length, reserveAll.length, true)}</p>{/if}
    <ol class="principles" data-testid="reserve-list">
      {#each reservePage as p (p.path)}
        <li data-testid="reserve-{principleSlug(p.path)}">
          <span class="title"><a href={browseHref(p.path)}>{p.fm.title}</a>{#if p.fm.tags?.length} <small class="rtags">{p.fm.tags.join(', ')}</small>{/if}</span>
          <span class="controls">
            <select bind:value={placeTo[p.path]} aria-label="Add to a set" data-testid="place-set">
              <option value="">Add to…</option>
              {#each s.sets as set (set.path)}<option value={slugOf(set.path)}>{setLabel(set.fm)}</option>{/each}
            </select>
            <button onclick={() => doPlace(p.path, p.fm.title)} disabled={busy || !placeTo[p.path]} use:hold={pressed === `place:${p.path}`} data-testid="place">Add</button>
            <button onclick={() => askDeletePrinciple(p.path)} disabled={busy} aria-label="Delete principle" data-testid="principle-delete">Delete</button>
          </span>
        </li>
      {:else}
        <li class="empty">{reserveAll.length ? 'No reserve principle matches.' : 'Nothing in reserve. A principle you take out of a set can be kept here, and you can write one here directly.'}</li>
      {/each}
    </ol>
    {#if left}<button type="button" onclick={() => (shown += PAGE)} data-testid="reserve-more">{moreLabel(left)}</button>{/if}
    <p><a href="#/sets/{RESERVE_SLUG}/new-principle" data-testid="new-principle-reserve">+ New principle in reserve</a></p>
    {/if}
  </section>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
{/if}

<style>
  .search { display: flex; gap: 0.5rem; align-items: center; margin: 0 0 0.75rem; }
  .search input { flex: 1 1 auto; min-width: 0; }
  /* WebKit draws its own clear glyph in a search field; the page has one. */
  .search input::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; }
  .sets { list-style: none; padding: 0; }
  .set, .reserve { border: var(--bw) solid var(--edge); box-shadow: var(--raise); padding: 0.75rem; margin-bottom: 0.75rem; }
  .reserve { margin-top: 1rem; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  .head h3 { margin: 0; min-width: 0; flex: 1 1 auto; }
  /* The heading is the tap that opens a set: a plain button, text left, no chrome. */
  .head h3 .toggle { min-height: 0; min-width: 0; width: 100%; padding: 0.2rem 0; border: 0; box-shadow: none; background: none; color: var(--ink); text-align: left; font: inherit; border-radius: 0; white-space: normal; display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: baseline; }
  .head h3 .toggle:active { background: none; color: var(--ink); transform: none; }
  .caret { flex: 0 0 auto; color: var(--muted); }
  .foot { display: flex; gap: 0.75rem; align-items: baseline; margin: 0.5rem 0 0; }
  .controls { display: inline-flex; gap: 0.25rem; flex-wrap: nowrap; flex: 0 0 auto; align-items: center; }
  .controls button, .controls select { min-height: 0; padding: 0.25rem 0.5rem; font-size: var(--fs-small); border-radius: calc(var(--radius) - 2px); }
  .controls select { max-width: 9rem; }
  /* Order is precedence: each row carries its number from the file's `order`, which the arrows and drags
     rewrite, so the numbers follow a reorder. A flex row draws no list marker, hence the span. */
  .principles { padding-left: 0; list-style: none; }
  .principles li { display: flex; align-items: center; gap: 0.5rem; margin: 0; padding: 0.35rem 0; border-top: var(--status-border, 1px dotted var(--edge)); }
  .principles li:first-child { border-top: 0; }
  .principles li.empty { border-top: 0; }
  .num { flex: 0 0 1.5rem; text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; }
  .title { flex: 1 1 auto; min-width: 0; }
  .rtags { display: block; }
  .framing { color: var(--muted); font-size: var(--fs-small); white-space: pre-wrap; margin: 0.5rem 0; }
  .confirm { flex-direction: column; align-items: stretch; }
  .confirm p { margin: 0 0 6px; }
  .row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .tags { display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0.5rem 0; align-items: center; }
  .new { display: flex; gap: 0.5rem; align-items: end; flex-wrap: wrap; }
  .new label { flex: 1 1 12rem; }
  p.ok { display: flex; justify-content: space-between; gap: 0.5rem; align-items: start; }
</style>
