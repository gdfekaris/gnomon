<script lang="ts">
  // Proposals — US-3, schema §4.7, §7.10, §7.16. Two streams, two shapes
  // (tracker, 2026-09-16). "For your reserve": the principles a filing
  // raised, as a triage list, keep or drop, singly or several at once in one
  // commit, with a near-duplicate hint. "For your sets": the proposals a
  // Relate or Derive run raised for a set, as cards with the context to judge
  // them. One search over both. Accepting a principle or amendment opens the
  // editor pre-filled; the curator writes the principle, the app never does.
  import { untrack } from 'svelte';
  import { hold } from '../lib/press';
  import { type BrainFile, type PrincipleFm, type ProposalFm, RESERVE_SLUG, setLabel } from '@gnomon/core';
  import MarkdownView from '../lib/components/MarkdownView.svelte';
  import { browseHref, linkLabel } from '../lib/markdown';
  import ConnectionNotice from '../lib/components/ConnectionNotice.svelte';
  import { brain, describeError } from '../lib/services/index';
  import { PAGE, moreLabel } from '../lib/services/browse';
  import { acceptLink, acceptanceRoute, addGround, closeTo, decide, declineMany, filterProposals, groundsToAdd, groupProposals, keepMany, proposalId, writeAsProposed, writtenAs } from '../lib/services/proposals';
  import { session } from '../lib/stores/session.svelte';
  import { snapshot } from '../lib/stores/snapshot.svelte';
  import { route } from '../lib/router.svelte';

  const s = $derived(snapshot.current);
  const groups = $derived(s ? groupProposals(s) : []);
  const reserveGroup = $derived(groups.find((g) => g.key === RESERVE_SLUG));
  const setGroups = $derived(groups.filter((g) => g.key !== RESERVE_SLUG));
  const openTotal = $derived(groups.reduce((n, g) => n + g.open.length, 0));
  let busy = $state<string | null>(null);
  let acting = $state<'accepted' | 'declined' | 'written' | 'kept' | 'dropped' | null>(null);
  let error = $state<string | null>(null);
  let showDecided = $state<Record<string, boolean>>({});
  // Decided proposals stay in the brain as the record of what was accepted or declined (schema §4.7), but the
  // list shows the latest few first; the rest are a tap away. Newest decision first.
  const RECENT_DECIDED = 5;
  let allDecided = $state<Record<string, boolean>>({});
  const recentFirst = (list: BrainFile<ProposalFm>[]) => [...list].sort((a, b) => (a.fm.updated < b.fm.updated ? 1 : a.fm.updated > b.fm.updated ? -1 : a.path < b.path ? 1 : -1));

  // The search narrows both parts; the count line says so. Component state, never saved.
  let q = $state('');
  const searching = $derived(q.trim() !== '');
  const reserveOpen = $derived(reserveGroup && s ? filterProposals(reserveGroup.open, q, s) : []);
  const openMatching = $derived(s ? groups.reduce((n, g) => n + filterProposals(g.open, q, s).length, 0) : 0);
  // The triage list: picks, the unfolded rationale, and pages of fifty.
  let picked = $state<string[]>([]);
  let unfolded = $state<string[]>([]);
  let shown = $state(PAGE);
  $effect(() => { void q; untrack(() => { shown = PAGE; }); });
  const reservePage = $derived(reserveOpen.slice(0, shown));
  const reserveLeft = $derived(Math.max(0, reserveOpen.length - shown));
  const pickedOpen = $derived(picked.filter((id) => reserveOpen.some((p) => proposalId(p.path) === id)));
  const togglePick = (id: string) => (picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const toggleUnfold = (id: string) => (unfolded = unfolded.includes(id) ? unfolded.filter((x) => x !== id) : [...unfolded, id]);
  /** what the last batch did, for the notice above the list */
  let did = $state<{ kept: number; dropped: number } | null>(null);

  // An error belongs under the proposal whose button was tapped, not at the foot of the page.
  let failedOn = $state<string | null>(null);
  async function act(p: BrainFile<ProposalFm>, status: 'accepted' | 'declined') {
    const id = proposalId(p.path);
    busy = id;
    acting = status;
    error = null;
    failedOn = null;
    try {
      if (status === 'accepted' && p.fm.kind === 'link') {
        // A link proposal proposes a ground; accepting it adds the ground and shows the principle.
        const r = await acceptLink(brain, p);
        location.hash = `${browseHref(r.path)}?${r.added.length ? `added=${encodeURIComponent(r.added.join(','))}` : 'already=1'}`;
        return;
      }
      await decide(brain, id, status);
      if (status === 'accepted') {
        const to = acceptanceRoute(p);
        if (to) location.hash = to;
      }
    } catch (e) {
      error = describeError(e);
      failedOn = id;
    } finally {
      busy = null;
      acting = null;
    }
  }
  // A principle proposal written as proposed: the decision, then the principle, from the pre-fill; the row moves to decided.
  async function writeIt(p: BrainFile<ProposalFm>) {
    const id = proposalId(p.path);
    busy = id;
    acting = 'written';
    error = null;
    failedOn = null;
    try {
      await writeAsProposed(brain, p);
    } catch (e) {
      error = describeError(e);
      failedOn = id;
    } finally {
      busy = null;
      acting = null;
    }
  }
  // The triage: one or several reserve proposals kept or dropped in one commit (schema §7.16).
  async function triage(ids: string[], what: 'kept' | 'dropped') {
    if (!ids.length) return;
    busy = ids.length === 1 ? ids[0]! : 'picked';
    acting = what;
    error = null;
    failedOn = null;
    did = null;
    try {
      if (what === 'kept') await keepMany(brain, ids);
      else await declineMany(brain, ids);
      picked = picked.filter((id) => !ids.includes(id));
      did = { kept: what === 'kept' ? ids.length : 0, dropped: what === 'dropped' ? ids.length : 0 };
    } catch (e) {
      error = describeError(e);
      failedOn = ids.length === 1 ? ids[0]! : 'picked';
    } finally {
      busy = null;
      acting = null;
    }
  }
  // An accepted link proposal whose ground never landed (the head moved between the two commits): add it now.
  async function addIt(p: BrainFile<ProposalFm>) {
    const id = proposalId(p.path);
    busy = id;
    error = null;
    failedOn = null;
    try {
      const r = await addGround(brain, p);
      location.hash = `${browseHref(r.path)}?added=${encodeURIComponent(r.added.join(','))}`;
    } catch (e) {
      error = describeError(e);
      failedOn = id;
    } finally {
      busy = null;
    }
  }
  const acceptLabel = (p: ProposalFm) => (p.kind === 'principle' ? 'Accept and edit' : p.kind === 'link' ? 'Accept and add the ground' : p.kind === 'amendment' ? 'Accept and edit the principle' : p.kind === 'tag' && p.target ? 'Accept and edit the tags' : 'Accept');
  // A link proposal proposes a ground and nothing looser (schema §4.7): the sources it names, or the one it came from.
  const groundsOf = (p: ProposalFm): string[] => (p.grounds?.length ? p.grounds : p.from_source ? [p.from_source] : []);
  const targetHref = (p: ProposalFm) => (p.target ? (p.kind === 'tag' ? browseHref(`sources/${p.target}/raw.md`) : browseHref(`principles/${p.target}.md`)) : null);
  const targetOf = (p: ProposalFm): BrainFile<PrincipleFm> | undefined => (p.target && p.kind !== 'tag' && s ? (s.files.get(`principles/${p.target}.md`) as BrainFile<PrincipleFm> | undefined) : undefined);
  const sourceOf = (p: ProposalFm): string | undefined => p.from_source ?? p.grounds?.[0];
</script>

<h2>Proposals</h2>
{#if !s}
  <ConnectionNotice />
{:else}
  {#if route.query.get('related')}
    {@const from = (route.query.get('from') ?? '').split(',').filter(Boolean)}
    {@const set = s.sets.find((f) => f.path === `principles/${route.query.get('set')}/_set.md`)}
    <p class="ok" role="status" data-testid="related"><span>{route.query.get('related')} proposal{route.query.get('related') === '1' ? '' : 's'} for {set ? setLabel(set.fm) : 'the set'} from {#each from as slug, i (slug)}{i ? (i === from.length - 1 ? ' and ' : ', ') : ''}<a href={browseHref(`sources/${slug}/raw.md`)}>{linkLabel(`sources/${slug}/raw.md`, s)}</a>{/each}. Decide each below.</span></p>
  {/if}
  {#if route.query.get('derived')}
    {@const from = (route.query.get('from') ?? '').split(',').filter(Boolean)}
    <p class="ok" role="status" data-testid="derived"><span>{route.query.get('derived')} proposal{route.query.get('derived') === '1' ? '' : 's'} derived from {#each from as slug, i (slug)}{i ? (i === from.length - 1 ? ' and ' : ', ') : ''}<a href={browseHref(`sources/${slug}/raw.md`)}>{linkLabel(`sources/${slug}/raw.md`, s)}</a>{/each}. Write each as proposed, edit it, or decline it.</span></p>
  {/if}
  <p class="hint">Filing raises principles for your reserve: keep or drop them. Relating or deriving raises proposals for a set: judge each with its context. Nothing changes until you decide.</p>
  {#if openTotal > 0 || searching}
    <div class="search">
      <input type="search" bind:value={q} placeholder="Search proposals: title, kind, source, principle" aria-label="Search proposals" data-testid="proposals-search" />
      {#if q}<button type="button" class="quiet" onclick={() => (q = '')} aria-label="Clear the search" data-testid="proposals-clear">×</button>{/if}
    </div>
    {#if searching}<p class="meta" data-testid="proposals-count">{openMatching} of {openTotal} open match</p>{/if}
  {/if}

  {#if reserveGroup}
    <section class="reserve" data-testid="group-_reserve">
      <h3>For your reserve <small>· {reserveGroup.open.length} open</small></h3>
      {#if did}
        <p class="ok" role="status" data-testid="triaged"><span>{#if did.kept}Kept {did.kept} in the reserve{#if did.dropped}, {/if}{/if}{#if did.dropped}Dropped {did.dropped}{/if}.{#if did.kept} <a href="#/sets">See the reserve</a>.{/if}</span><button type="button" class="quiet" onclick={() => (did = null)} aria-label="Dismiss">×</button></p>
      {/if}
      {#if reserveOpen.length > 1}
        <p class="hint pick-all">
          Tick several to decide them together, in one commit.
          <button type="button" class="link" onclick={() => (picked = reserveOpen.map((p) => proposalId(p.path)))} disabled={pickedOpen.length === reserveOpen.length} data-testid="reserve-pick-all">All</button>
          <button type="button" class="link" onclick={() => (picked = [])} disabled={!pickedOpen.length} data-testid="reserve-pick-none">None</button>
          <button type="button" class="primary" onclick={() => triage(pickedOpen, 'kept')} disabled={busy !== null || !pickedOpen.length} use:hold={busy === 'picked' && acting === 'kept'} data-testid="keep-picked">{busy === 'picked' && acting === 'kept' ? 'Keeping…' : `Keep ${pickedOpen.length}`}</button>
          <button type="button" onclick={() => triage(pickedOpen, 'dropped')} disabled={busy !== null || !pickedOpen.length} use:hold={busy === 'picked' && acting === 'dropped'} data-testid="drop-picked">{busy === 'picked' && acting === 'dropped' ? 'Dropping…' : `Drop ${pickedOpen.length}`}</button>
        </p>
        {#if error && failedOn === 'picked'}<p class="error" role="alert" data-testid="decide-error">{error}</p>{/if}
      {/if}
      <ol class="triage" data-testid="reserve-open">
        {#each reservePage as p (p.path)}
          {@const id = proposalId(p.path)}
          {@const near = closeTo(s, p)}
          {@const src = sourceOf(p.fm)}
          {@const open = unfolded.includes(id)}
          <li data-testid="proposal-{id}">
            <div class="row">
              {#if reserveOpen.length > 1}<input type="checkbox" checked={picked.includes(id)} onchange={() => togglePick(id)} aria-label="Pick {p.fm.title}" data-testid="pick-{id}" />{/if}
              <span class="what">
                <button type="button" class="title" onclick={() => toggleUnfold(id)} aria-expanded={open} data-testid="unfold-{id}">{p.fm.title}</button>
                <small>{#if src}from <a href={browseHref(`sources/${src}/raw.md`)}>{linkLabel(`sources/${src}/raw.md`, s)}</a>{/if}{#if p.fm.curated === 'human'} · yours{/if}</small>
                {#if near.length}
                  <small class="close" data-testid="close-to">Close to: {#each near as m, i (m.path)}{i ? ', ' : ''}<a href={browseHref(m.path)}>{m.title}</a> ({m.what}){/each}</small>
                {/if}
              </span>
              <span class="controls">
                <button class="primary" onclick={() => triage([id], 'kept')} disabled={busy !== null} use:hold={busy === id && acting === 'kept'} data-testid="keep">{busy === id && acting === 'kept' ? 'Keeping…' : 'Keep'}</button>
                <button onclick={() => triage([id], 'dropped')} disabled={busy !== null} use:hold={busy === id && acting === 'dropped'} data-testid="drop">{busy === id && acting === 'dropped' ? 'Dropping…' : 'Drop'}</button>
              </span>
            </div>
            {#if open}
              <div class="rationale" data-testid="rationale-{id}">
                {#if p.body}<MarkdownView body={p.body} path={p.path} />{:else}<p class="empty">(no rationale)</p>{/if}
                <p class="links"><span><code>{id}</code></span>{#if p.fm.grounds?.length}<span>Grounds: {p.fm.grounds.join(', ')}</span>{/if}<a href={browseHref(p.path)}>file</a></p>
              </div>
            {/if}
            {#if error && failedOn === id}<p class="error" role="alert" data-testid="decide-error">{error}</p>{/if}
          </li>
        {:else}
          <li class="empty">{reserveGroup.open.length ? 'No reserve proposal matches.' : 'Nothing open. Filing a capture raises principles here when a passage supports any.'}</li>
        {/each}
      </ol>
      {#if reserveLeft}<button type="button" onclick={() => (shown += PAGE)} data-testid="proposals-more">{moreLabel(reserveLeft)}</button>{/if}
      {#if reserveGroup.decided.length}
        <button class="quiet" onclick={() => (showDecided = { ...showDecided, [RESERVE_SLUG]: !showDecided[RESERVE_SLUG] })} data-testid="toggle-decided">{showDecided[RESERVE_SLUG] ? 'Hide' : 'Show'} {reserveGroup.decided.length} decided</button>
        {#if showDecided[RESERVE_SLUG]}
          <ul class="decided" data-testid="decided-_reserve">
            {#each (allDecided[RESERVE_SLUG] ? recentFirst(reserveGroup.decided) : recentFirst(reserveGroup.decided).slice(0, RECENT_DECIDED)) as p (p.path)}
              {@const became = writtenAs(s, p.path)}
              <li data-testid="proposal-{proposalId(p.path)}">
                {p.fm.title} <small>· <span data-testid="status">{p.fm.status === 'accepted' ? 'kept' : p.fm.status}</span></small>
                {#if became.length}<span> → <a href={browseHref(became[0]!.path)} data-testid="written-as">in the reserve</a></span>
                {:else if p.fm.status === 'accepted'}<span> · not written yet: <a href={acceptanceRoute(p) ?? '#/sets'} data-testid="write-it">Write it</a></span>{/if}
                <a href={browseHref(p.path)}><small>file</small></a>
              </li>
            {/each}
          </ul>
          {#if reserveGroup.decided.length > RECENT_DECIDED && !allDecided[RESERVE_SLUG]}
            <button class="quiet" onclick={() => (allDecided = { ...allDecided, [RESERVE_SLUG]: true })} data-testid="all-decided">Show all {reserveGroup.decided.length} decided</button>
          {/if}
        {/if}
      {/if}
    </section>
  {/if}

  {#if setGroups.length}<h3 class="part">For your sets</h3>{/if}
  {#each setGroups as g (g.key)}
    {@const open = filterProposals(g.open, q, s)}
    <section data-testid="group-{g.key}">
      <h3>{g.label} <small>· {g.open.length} open{#if searching && open.length !== g.open.length}, {open.length} match{/if}</small></h3>
      {#each open as p (p.path)}
        {@const id = proposalId(p.path)}
        {@const target = targetOf(p.fm)}
        {@const set = s.sets.find((f) => f.path === `principles/${p.fm.target_set}/_set.md`)}
        <article class="proposal" data-testid="proposal-{id}">
          <h4><span class="kind">{p.fm.kind}</span> {p.fm.title} <small><code>{id}</code>{#if p.fm.curated === 'human'} · yours{/if}</small></h4>
          {#if p.fm.kind === 'link' && p.fm.target}
            <p class="proposes" data-testid="proposes">Proposes a ground: add {#each groundsOf(p.fm) as g, i (g)}{i ? ', ' : ''}<a href={browseHref(`sources/${g}/raw.md`)}>{linkLabel(`sources/${g}/raw.md`, s)}</a>{/each} to the grounds of <a href={targetHref(p.fm)}>{linkLabel(`principles/${p.fm.target}.md`, s)}</a>.</p>
            {#if target}<p class="context" data-testid="target-context">{target.fm.title} has {target.fm.grounds.length} ground{target.fm.grounds.length === 1 ? '' : 's'} now{#if target.fm.grounds.length}: {target.fm.grounds.join(', ')}{/if}.</p>{/if}
          {:else if p.fm.kind === 'amendment' && target}
            <details class="context" data-testid="target-body">
              <summary>{target.fm.title}, as it stands</summary>
              <MarkdownView body={target.body} path={target.path} />
            </details>
          {:else if p.fm.kind === 'principle' && set}
            <p class="context" data-testid="set-context">{setLabel(set.fm)} holds {s.principlesOf(g.key).length} principle{s.principlesOf(g.key).length === 1 ? '' : 's'}{#if s.principlesOf(g.key).length}: {s.principlesOf(g.key).map((x) => x.fm.title).join('; ')}{/if}.</p>
          {/if}
          <p class="links">
            {#if p.fm.target}<span>Target: <a href={targetHref(p.fm)}>{p.fm.target}</a></span>{/if}
            {#if p.fm.from_source}<span>From: <a href={browseHref(`sources/${p.fm.from_source}/raw.md`)}>{linkLabel(`sources/${p.fm.from_source}/raw.md`, s)}</a></span>{/if}
            {#if p.fm.grounds?.length}<span>Grounds: {p.fm.grounds.join(', ')}</span>{/if}
            <a href={browseHref(p.path)}>file</a>
          </p>
          {#if p.body}<MarkdownView body={p.body} path={p.path} />{/if}
          <div class="row">
            {#if p.fm.kind === 'principle' && p.fm.target_set}
              <button class="primary" onclick={() => writeIt(p)} disabled={busy !== null} use:hold={busy === id && acting === 'written'} data-testid="write-as-proposed">{busy === id && acting === 'written' ? 'Writing…' : 'Write it as proposed'}</button>
            {/if}
            <button onclick={() => act(p, 'accepted')} disabled={busy !== null} use:hold={busy === id && acting === 'accepted'} data-testid="accept">{busy === id && acting === 'accepted' ? 'Accepting…' : acceptLabel(p.fm)}</button>
            <button onclick={() => act(p, 'declined')} disabled={busy !== null} use:hold={busy === id && acting === 'declined'} data-testid="decline">{busy === id && acting === 'declined' ? 'Declining…' : 'Decline'}</button>
            {#if busy === id}<span role="status" class="hint" data-testid="deciding">{acting === 'written' ? 'Two commits to your repository: the decision, then the principle; a few seconds.' : p.fm.kind === 'link' && acting === 'accepted' ? 'Two commits to your repository: the decision, then the ground; a few seconds.' : 'One commit to your repository; a few seconds.'}</span>{/if}
          </div>
          {#if error && failedOn === id}<p class="error" role="alert" data-testid="decide-error">{error}</p>{/if}
        </article>
      {:else}
        <p class="empty">{g.open.length ? 'No proposal here matches.' : 'Nothing open.'}</p>
      {/each}
      {#if g.decided.length}
        <button class="quiet" onclick={() => (showDecided = { ...showDecided, [g.key]: !showDecided[g.key] })} data-testid="toggle-decided">{showDecided[g.key] ? 'Hide' : 'Show'} {g.decided.length} decided</button>
        {#if showDecided[g.key]}
          <ul class="decided" data-testid="decided-{g.key}">
            {#each (allDecided[g.key] ? recentFirst(g.decided) : recentFirst(g.decided).slice(0, RECENT_DECIDED)) as p (p.path)}
              {@const became = writtenAs(s, p.path)}
              {@const pending = p.fm.status === 'accepted' && p.fm.kind === 'link' ? groundsToAdd(s, p) : null}
              <li data-testid="proposal-{proposalId(p.path)}">
                <span class="kind">{p.fm.kind}</span> {p.fm.title} <small>· <span data-testid="status">{p.fm.status}</span></small>
                {#if became.length}<span> → written as {#each became as f (f.path)}<a href={browseHref(f.path)} data-testid="written-as">{linkLabel(f.path, s)}</a> {/each}</span>
                {:else if p.fm.status === 'accepted' && p.fm.kind === 'principle'}
                  <!-- Accepted, but nothing in the brain points back at it: the editor was left before the principle was added. -->
                  <span> · not written yet: <a href={acceptanceRoute(p) ?? '#/sets'} data-testid="write-it">Write it</a></span>
                {:else if pending && pending.add.length}
                  <!-- Accepted, but the ground never landed (the head moved between the two commits). -->
                  <span> · not added yet: <button type="button" class="link" onclick={() => addIt(p)} disabled={busy !== null} data-testid="add-ground">Add it</button></span>
                {:else if pending}
                  <span> → ground of <a href={browseHref(pending.path)} data-testid="ground-of">{linkLabel(pending.path, s)}</a></span>
                {/if}
                {#if error && failedOn === proposalId(p.path)}<span class="error" role="alert" data-testid="decide-error">{error}</span>{/if}
                <a href={browseHref(p.path)}><small>file</small></a>
              </li>
            {/each}
          </ul>
          {#if g.decided.length > RECENT_DECIDED && !allDecided[g.key]}
            <button class="quiet" onclick={() => (allDecided = { ...allDecided, [g.key]: true })} data-testid="all-decided">Show all {g.decided.length} decided</button>
          {/if}
        {/if}
      {/if}
    </section>
  {/each}
  {#if !groups.length}
    <p class="empty">No proposals yet. Filing a capture raises principles for your reserve; relating or deriving from a source raises proposals for a set.</p>
  {/if}
  {#if error && !failedOn}<p class="error" role="alert">{error}</p>{/if}
{/if}

<style>
  .search { display: flex; gap: 0.5rem; align-items: center; margin: 0 0 0.5rem; }
  .search input { flex: 1 1 auto; min-width: 0; }
  .search input::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; }
  .reserve { border: var(--bw) solid var(--edge); box-shadow: var(--raise); padding: 0.6rem 0.75rem; margin-bottom: 1rem; }
  .reserve h3 { margin: 0 0 0.25rem; }
  h3.part { margin: 1rem 0 0.25rem; }
  .pick-all { margin: 0.25rem 0 0.5rem; display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center; }
  .pick-all button { padding: 4px 8px; }
  .triage { padding-left: 0; list-style: none; margin: 0; }
  .triage > li { padding: 0.35rem 0; border-top: var(--status-border, 1px dotted var(--edge)); }
  .triage > li:first-child { border-top: 0; }
  .triage > li.empty { border-top: 0; }
  /* The controls stay on the right; the title, a button for the unfold, is the one button that may shrink and wrap. */
  .triage .row { display: flex; flex-wrap: nowrap; align-items: center; gap: 0.5rem; margin: 0; }
  .triage .row input[type='checkbox'] { flex: 0 0 auto; width: 1.1em; height: 1.1em; margin: 0; }
  .what { flex: 1 1 auto; min-width: 0; display: grid; gap: 0.1rem; }
  .what button.title { min-height: 0; min-width: 0; flex-shrink: 1; width: 100%; padding: 0; border: 0; box-shadow: none; background: none; color: var(--ink); text-align: left; font-weight: normal; border-radius: 0; white-space: normal; overflow-wrap: anywhere; }
  button.title[aria-expanded='true'] { text-decoration: underline; }
  .close { color: var(--warn, var(--muted)); }
  .controls { display: inline-flex; gap: 0.25rem; flex: 0 0 auto; }
  .controls button { min-height: 0; padding: 0.25rem 0.5rem; font-size: var(--fs-small); border-radius: calc(var(--radius) - 2px); }
  .rationale { margin: 0.35rem 0 0 1.5rem; }
  .proposal { border: var(--bw) solid var(--edge); box-shadow: var(--raise); padding: 0.6rem 0.75rem; margin-bottom: 0.75rem; }
  .proposal h4 { margin: 0 0 0.25rem; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .context { font-size: var(--fs-small); color: var(--muted); margin: 0 0 0.5rem; }
  details.context summary { cursor: pointer; }
  .links { display: flex; flex-wrap: wrap; gap: 0.25rem 0.75rem; font-size: var(--fs-small); color: var(--muted); margin: 0 0 0.5rem; }
  .row { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.5rem; }
  .decided { padding-left: 0.25rem; list-style: none; }
  p.ok { display: flex; justify-content: space-between; gap: 0.5rem; align-items: start; }
</style>
