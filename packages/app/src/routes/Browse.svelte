<script lang="ts">
  // Browse — proposal §6. Block 14 ships the file list grouped by kind;
  // block 16 adds the file view, links, backlinks, and attachments.
  import { setLabel } from '@gnomon/core';
  import { snapshot } from '../lib/stores/snapshot.svelte';
  import { session } from '../lib/stores/session.svelte';

  const s = $derived(snapshot.current);
  const sources = $derived(s ? s.byType('source') : []);
  const captures = $derived(s ? s.byType('inbox') : []);
  const proposals = $derived(s ? s.byType('proposal') : []);
</script>

<h2>Browse</h2>
{#if !session.driver}
  <p>No brain connected. <a href="#/settings">Connect one in Settings.</a></p>
{:else if snapshot.loading && !s}
  <p>Loading {session.label}…</p>
{:else if snapshot.error && !s}
  <p class="error">Could not load {session.label}: {snapshot.error}</p>
{:else if s}
  <p class="meta">{session.label} at <code>{s.head.slice(0, 7)}</code> · {s.files.size} files</p>
  {#each s.sets as set (set.path)}
    <h3>{setLabel(set.fm)}</h3>
    <ol data-testid="set-{set.path.split('/')[1]}">
      {#each s.principlesOf(set.path.split('/')[1]!) as p (p.path)}
        <li>{p.fm.title} <small>· grounds: {p.fm.grounds.length}</small></li>
      {:else}
        <li class="empty">(no principles)</li>
      {/each}
    </ol>
  {/each}
  <h3>Sources</h3>
  <ul data-testid="sources">
    {#each sources as f (f.path)}
      <li><code>{f.path}</code> — {f.fm.title}, {f.fm.author}{#if f.fm.curated !== 'ratified' && f.fm.curated !== 'human'} <small>· {f.fm.curated}</small>{/if}</li>
    {:else}
      <li class="empty">(no sources)</li>
    {/each}
  </ul>
  <h3>Inbox</h3>
  <ul data-testid="inbox">
    {#each captures as f (f.path)}
      <li><code>{f.path}</code> · {f.fm.status}{#if f.fm.attachment}{' · attachment'}{/if}{#if f.fm.note}{` — ${f.fm.note}`}{/if}</li>
    {:else}
      <li class="empty">(empty)</li>
    {/each}
  </ul>
  <h3>Proposals</h3>
  <ul data-testid="proposals">
    {#each proposals as f (f.path)}
      <li><code>{f.path}</code> · {f.fm.kind} · {f.fm.status} — {f.fm.title}</li>
    {:else}
      <li class="empty">(none)</li>
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
  .error { color: #b91c1c; }
  small { opacity: 0.7; }
</style>
