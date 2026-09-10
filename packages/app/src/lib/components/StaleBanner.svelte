<script lang="ts">
  import Icon from './Icon.svelte';
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
    <Icon name="clock" /><span class="grow">Your repository has newer changes.</span>
    <button onclick={refresh} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</button>
  </div>
{/if}

<style>
  .banner { margin: 8px 8px 0; }
  .grow { flex: 1; }
</style>
