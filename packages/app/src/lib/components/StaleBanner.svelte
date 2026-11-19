<script lang="ts">
  import { hold } from '../press';
  import Icon from './Icon.svelte';
  import { brain } from '../services/index';
  import { snapshot } from '../stores/snapshot.svelte';
  let busy = $state(false);
  async function refresh() {
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

{#if snapshot.stale}
  <div class="banner" role="status">
    <Icon name="clock" /><span class="grow">Your repository has newer changes.</span>
    <button onclick={refresh} disabled={busy} use:hold={busy}>{busy ? 'Refreshing…' : 'Refresh'}</button>
  </div>
{:else if snapshot.current && snapshot.error}
  <!-- The brain is open from the copy on this device, and the repository refused the check (a rejected token, most often). -->
  <div class="banner" role="alert" data-testid="check-error">
    <Icon name="clock" /><span class="grow">The repository could not be checked: {snapshot.error} <a href="#/settings">Open Settings</a></span>
    <button onclick={refresh} disabled={busy} use:hold={busy}>{busy ? 'Trying…' : 'Try again'}</button>
  </div>
{/if}

<style>
  .banner { margin: 8px 8px 0; }
  .grow { flex: 1; }
</style>
