<script lang="ts">
  // Capture — spec §10.4. Block 15 builds the real screen; this is the default route's placeholder.
  import { session } from '../lib/stores/session.svelte';
</script>

<h2>Capture</h2>
{#if session.driver}
  <p>Connected to {session.label}. The capture form arrives in block 15.</p>
{:else}
  <p>No brain connected yet. <a href="#/settings">Open Settings</a> to use the demo brain or connect a repository.</p>
{/if}
