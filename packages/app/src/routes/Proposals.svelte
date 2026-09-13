<script lang="ts">
  // Proposals — US-3, schema §4.7, §7.10. Open proposals grouped by target
  // set with kind, title, rationale, and links; accept and decline record
  // one Decide: commit each; accepting a principle or amendment opens the
  // editor pre-filled. The curator writes the principle; the app never does.
  import { hold } from '../lib/press';
  import type { BrainFile, ProposalFm } from '@gnomon/core';
  import MarkdownView from '../lib/components/MarkdownView.svelte';
  import { browseHref, linkLabel } from '../lib/markdown';
  import ConnectionNotice from '../lib/components/ConnectionNotice.svelte';
  import { brain, describeError } from '../lib/services/index';
  import { acceptLink, acceptanceRoute, addGround, decide, groundsToAdd, groupProposals, proposalId, writtenAs } from '../lib/services/proposals';
  import { session } from '../lib/stores/session.svelte';
  import { snapshot } from '../lib/stores/snapshot.svelte';

  const s = $derived(snapshot.current);
  const groups = $derived(s ? groupProposals(s) : []);
  let busy = $state<string | null>(null);
  let acting = $state<'accepted' | 'declined' | null>(null);
  let error = $state<string | null>(null);
  let showDecided = $state<Record<string, boolean>>({});
  // Decided proposals stay in the brain as the record of what was accepted or declined (schema §4.7), but the
  // list shows the latest few first; the rest are a tap away. Newest decision first.
  const RECENT_DECIDED = 5;
  let allDecided = $state<Record<string, boolean>>({});
  const recentFirst = (list: BrainFile<ProposalFm>[]) => [...list].sort((a, b) => (a.fm.updated < b.fm.updated ? 1 : a.fm.updated > b.fm.updated ? -1 : a.path < b.path ? 1 : -1));

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
  const acceptLabel = (p: ProposalFm) => (p.kind === 'principle' ? 'Accept and write it' : p.kind === 'link' ? 'Accept and add the ground' : p.kind === 'amendment' ? 'Accept and edit the principle' : p.kind === 'tag' && p.target ? 'Accept and edit the tags' : 'Accept');
  // A link proposal proposes a ground and nothing looser (schema §4.7): the sources it names, or the one it came from.
  const groundsOf = (p: ProposalFm): string[] => (p.grounds?.length ? p.grounds : p.from_source ? [p.from_source] : []);
  const targetHref = (p: ProposalFm) => (p.target ? (p.kind === 'tag' ? browseHref(`sources/${p.target}/raw.md`) : browseHref(`principles/${p.target}.md`)) : null);
</script>

<h2>Proposals</h2>
{#if !s}
  <ConnectionNotice />
{:else}
  <p class="hint">Suggestions from filing and desktop sessions. You decide; accepting a link adds the ground; everything else changes only when you write it yourself.</p>
  {#each groups as g (g.key)}
    <section data-testid="group-{g.key}">
      <h3>{g.label} <small>· {g.open.length} open</small></h3>
      {#each g.open as p (p.path)}
        {@const id = proposalId(p.path)}
        <article class="proposal" data-testid="proposal-{id}">
          <h4><span class="kind">{p.fm.kind}</span> {p.fm.title} <small><code>{id}</code>{#if p.fm.curated === 'human'} · yours{/if}</small></h4>
          {#if p.fm.kind === 'link' && p.fm.target}
            <p class="proposes" data-testid="proposes">Proposes a ground: add {#each groundsOf(p.fm) as g, i (g)}{i ? ', ' : ''}<a href={browseHref(`sources/${g}/raw.md`)}>{linkLabel(`sources/${g}/raw.md`, s)}</a>{/each} to the grounds of <a href={targetHref(p.fm)}>{linkLabel(`principles/${p.fm.target}.md`, s)}</a>.</p>
          {/if}
          <p class="links">
            {#if p.fm.target}<span>Target: <a href={targetHref(p.fm)}>{p.fm.target}</a></span>{/if}
            {#if p.fm.from_source}<span>From: <a href={browseHref(`sources/${p.fm.from_source}/raw.md`)}>{linkLabel(`sources/${p.fm.from_source}/raw.md`, s)}</a></span>{/if}
            {#if p.fm.grounds?.length}<span>Grounds: {p.fm.grounds.join(', ')}</span>{/if}
            <a href={browseHref(p.path)}>file</a>
          </p>
          {#if p.body}<MarkdownView body={p.body} path={p.path} />{/if}
          <div class="row">
            <button onclick={() => act(p, 'accepted')} disabled={busy !== null} use:hold={busy === id && acting === 'accepted'} data-testid="accept">{busy === id && acting === 'accepted' ? 'Accepting…' : acceptLabel(p.fm)}</button>
            <button onclick={() => act(p, 'declined')} disabled={busy !== null} use:hold={busy === id && acting === 'declined'} data-testid="decline">{busy === id && acting === 'declined' ? 'Declining…' : 'Decline'}</button>
            {#if busy === id}<span role="status" class="hint" data-testid="deciding">{p.fm.kind === 'link' && acting === 'accepted' ? 'Two commits to your repository: the decision, then the ground; a few seconds.' : 'One commit to your repository; a few seconds.'}</span>{/if}
          </div>
          {#if error && failedOn === id}<p class="error" role="alert" data-testid="decide-error">{error}</p>{/if}
        </article>
      {:else}
        <p class="empty">Nothing open.</p>
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
  {:else}
    <p class="empty">No proposals yet. Filing a capture from the Inbox produces the first ones.</p>
  {/each}
  {#if error && !failedOn}<p class="error" role="alert">{error}</p>{/if}
{/if}

<style>
  .proposal { border: var(--bw) solid var(--edge); box-shadow: var(--raise); padding: 0.6rem 0.75rem; margin-bottom: 0.75rem; }
  .proposal h4 { margin: 0 0 0.25rem; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .links { display: flex; flex-wrap: wrap; gap: 0.25rem 0.75rem; font-size: var(--fs-small); color: var(--muted); margin: 0 0 0.5rem; }
  .row { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.5rem; }
  .decided { padding-left: 0.25rem; list-style: none; }
</style>
