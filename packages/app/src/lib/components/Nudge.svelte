<script lang="ts">
  // The "what next" line (US-14): one sentence and one link, computed from
  // the snapshot in the CLI's order. The link is dropped on the screen it
  // points to.
  import { route } from '../router.svelte';
  import { brainStatus, nudge } from '../services/status';
  import { snapshot } from '../stores/snapshot.svelte';

  const n = $derived(snapshot.current ? nudge(brainStatus(snapshot.current)) : null);
  const here = $derived(n ? n.href === `#/${route.name}` : false);
</script>

{#if n}
  <p class="nudge" data-testid="nudge" data-kind={n.kind}>
    {n.text}{#if !here} <a href={n.href}>{n.label}</a>{/if}
  </p>
{/if}

<style>
  .nudge { background: rgba(127, 127, 127, 0.12); padding: 0.6rem 0.9rem; border-radius: 0.5rem; margin: 0 0 1rem; }
</style>
