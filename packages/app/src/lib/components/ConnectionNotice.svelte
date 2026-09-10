<script lang="ts">
  // What a screen shows instead of its content while there is no snapshot:
  // not connected, still loading, or failed to load with a retry (spec §14).
  import { brain } from '../services/index';
  import { session } from '../stores/session.svelte';
  import { snapshot } from '../stores/snapshot.svelte';

  let busy = $state(false);
  async function retry() {
    busy = true;
    try {
      await brain.refresh();
    } catch {
      // snapshot.error carries the sentence
    } finally {
      busy = false;
    }
  }
</script>

{#if !session.driver}
  <p data-testid="not-connected">No brain connected. <a href="#/onboarding">Set one up</a>, or <a href="#/settings">open Settings</a>.</p>
{:else if snapshot.error && !snapshot.current}
  <p class="error" role="alert" data-testid="load-error">
    Could not load {session.label}: {snapshot.error}
    <button onclick={retry} disabled={busy}>{busy ? 'Trying…' : 'Try again'}</button>
  </p>
{:else}
  <p role="status" data-testid="loading">Loading {session.label}…</p>
{/if}

<style>
  button { margin-left: 0.5rem; }
</style>
