<script lang="ts">
  import { brain } from '../services/index';
  import { snapshot } from '../stores/snapshot.svelte';
  let busy = $state(false);
  async function refresh() {
    busy = true;
    try {
      await brain.refresh();
    } finally {
      busy = false;
    }
  }
</script>

{#if snapshot.stale}
  <div class="banner" role="status">
    Your repository has newer changes.
    <button onclick={refresh} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</button>
  </div>
{/if}

<style>
  .banner { background: #fef3c7; color: #78350f; padding: 0.75rem 1rem; display: flex; gap: 1rem; align-items: center; justify-content: space-between; }
  @media (prefers-color-scheme: dark) { .banner { background: #78350f; color: #fef3c7; } }
</style>
