<script lang="ts">
  import { route } from './lib/router.svelte';
  import { SET_ONE_SLUG } from '@gnomon/core';
</script>

<main>
  <h1>Gnomon</h1>
  <p>Scaffold. Route: <code>{route.name}</code>. Set 1 slug: <code>{SET_ONE_SLUG}</code>.</p>
  <nav>
    <a href="#/capture">capture</a> · <a href="#/browse">browse</a> · <a href="#/inbox">inbox</a> ·
    <a href="#/proposals">proposals</a> · <a href="#/sets">sets</a> · <a href="#/reason">reason</a> ·
    <a href="#/settings">settings</a>
  </nav>
</main>
