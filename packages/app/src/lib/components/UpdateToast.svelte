<script lang="ts">
  import { applyUpdate, pwa } from '../stores/pwa.svelte';
</script>

{#if pwa.needRefresh}
  <div class="toast" role="status" data-testid="update-toast">
    A new version of Gnomon is ready.
    <button onclick={applyUpdate}>Reload</button>
    <button class="quiet" onclick={() => (pwa.needRefresh = false)}>Later</button>
  </div>
{/if}

<style>
  .toast { position: fixed; left: 1rem; right: 1rem; bottom: calc(1rem + env(safe-area-inset-bottom)); background: #1c1917; color: #fafaf9; padding: 0.75rem 1rem; border-radius: 0.75rem; display: flex; gap: 0.75rem; align-items: center; justify-content: space-between; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3); }
  .quiet { opacity: 0.7; }
</style>
