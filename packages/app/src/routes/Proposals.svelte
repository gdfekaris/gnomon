<script lang="ts">
  // Proposals — US-3, schema §4.7, §7.10. Open proposals grouped by target
  // set with kind, title, rationale, and links; accept and decline record
  // one Decide: commit each; accepting a principle or amendment opens the
  // editor pre-filled. The curator writes the principle; the app never does.
  import type { BrainFile, ProposalFm } from '@gnomon/core';
  import MarkdownView from '../lib/components/MarkdownView.svelte';
  import { browseHref, linkLabel } from '../lib/markdown';
  import ConnectionNotice from '../lib/components/ConnectionNotice.svelte';
  import { brain, describeError } from '../lib/services/index';
  import { acceptanceRoute, decide, groupProposals, proposalId, writtenAs } from '../lib/services/proposals';
  import { session } from '../lib/stores/session.svelte';
  import { snapshot } from '../lib/stores/snapshot.svelte';

  const s = $derived(snapshot.current);
  const groups = $derived(s ? groupProposals(s) : []);
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  let showDecided = $state<Record<string, boolean>>({});

  async function act(p: BrainFile<ProposalFm>, status: 'accepted' | 'declined') {
    const id = proposalId(p.path);
    busy = id;
    error = null;
    try {
      await decide(brain, id, status);
      if (status === 'accepted') {
        const to = acceptanceRoute(p);
        if (to) location.hash = to;
      }
    } catch (e) {
      error = describeError(e);
    } finally {
      busy = null;
    }
  }
  const targetHref = (p: ProposalFm) => (p.target ? (p.kind === 'tag' ? browseHref(`sources/${p.target}/raw.md`) : browseHref(`principles/${p.target}.md`)) : null);
</script>

<h2>Proposals</h2>
{#if !s}
  <ConnectionNotice />
{:else}
  <p class="hint">Suggestions from filing and desktop sessions. You decide; nothing here changes a principle until you write it yourself.</p>
  {#each groups as g (g.key)}
    <section data-testid="group-{g.key}">
      <h3>{g.label} <small>· {g.open.length} open</small></h3>
      {#each g.open as p (p.path)}
        {@const id = proposalId(p.path)}
        <article class="proposal" data-testid="proposal-{id}">
          <h4><span class="kind">{p.fm.kind}</span> {p.fm.title} <small><code>{id}</code>{#if p.fm.curated === 'human'} · yours{/if}</small></h4>
          <p class="links">
            {#if p.fm.target}<span>Target: <a href={targetHref(p.fm)}>{p.fm.target}</a></span>{/if}
            {#if p.fm.from_source}<span>From: <a href={browseHref(`sources/${p.fm.from_source}/raw.md`)}>{linkLabel(`sources/${p.fm.from_source}/raw.md`, s)}</a></span>{/if}
            {#if p.fm.grounds?.length}<span>Grounds: {p.fm.grounds.join(', ')}</span>{/if}
            <a href={browseHref(p.path)}>file</a>
          </p>
          {#if p.body}<MarkdownView body={p.body} path={p.path} />{/if}
          <div class="row">
            <button onclick={() => act(p, 'accepted')} disabled={busy !== null} data-testid="accept">{p.fm.kind === 'principle' ? 'Accept and write it' : p.fm.kind === 'amendment' || p.fm.kind === 'link' ? 'Accept and edit the principle' : p.fm.kind === 'tag' && p.fm.target ? 'Accept and edit the tags' : 'Accept'}</button>
            <button onclick={() => act(p, 'declined')} disabled={busy !== null} data-testid="decline">Decline</button>
          </div>
        </article>
      {:else}
        <p class="empty">Nothing open.</p>
      {/each}
      {#if g.decided.length}
        <button class="quiet" onclick={() => (showDecided = { ...showDecided, [g.key]: !showDecided[g.key] })} data-testid="toggle-decided">{showDecided[g.key] ? 'Hide' : 'Show'} {g.decided.length} decided</button>
        {#if showDecided[g.key]}
          <ul class="decided" data-testid="decided-{g.key}">
            {#each g.decided as p (p.path)}
              {@const became = writtenAs(s, p.path)}
              <li data-testid="proposal-{proposalId(p.path)}">
                <span class="kind">{p.fm.kind}</span> {p.fm.title} <small>· <span data-testid="status">{p.fm.status}</span></small>
                {#if became.length}<span> → written as {#each became as f (f.path)}<a href={browseHref(f.path)} data-testid="written-as">{linkLabel(f.path, s)}</a> {/each}</span>{/if}
                <a href={browseHref(p.path)}><small>file</small></a>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </section>
  {:else}
    <p class="empty">No proposals yet. Filing a capture from the Inbox produces the first ones.</p>
  {/each}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
{/if}

<style>
  section { margin-bottom: 1.5rem; }
  .proposal { border: 1px solid rgba(127, 127, 127, 0.3); border-radius: 0.5rem; padding: 0.6rem 0.75rem; margin-bottom: 0.6rem; }
  .proposal h4 { margin: 0 0 0.25rem; }
  .kind { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.7; border: 1px solid rgba(127, 127, 127, 0.5); border-radius: 0.25rem; padding: 0 0.3rem; margin-right: 0.3rem; }
  .links { display: flex; flex-wrap: wrap; gap: 0.75rem; font-size: 0.9rem; opacity: 0.85; margin: 0.25rem 0; }
  .row { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
  .decided li { margin: 0.25rem 0; }
  .quiet { opacity: 0.7; }
  .empty, .hint { opacity: 0.7; }
  .error { color: #b91c1c; }
  small { opacity: 0.75; }
</style>
