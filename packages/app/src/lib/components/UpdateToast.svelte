<script lang="ts">
  import { applyUpdate, pwa } from '../stores/pwa.svelte';
</script>

{#if pwa.needRefresh}
  <div class="toast" role="status" data-testid="update-toast">
    A new version of Gnomon is ready.
    <button class="primary" onclick={applyUpdate} data-testid="update-apply">Update now</button>
    <button class="quiet" onclick={() => (pwa.needRefresh = false)}>Later</button>
  </div>
{/if}
