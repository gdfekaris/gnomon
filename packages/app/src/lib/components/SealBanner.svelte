<script lang="ts">
  // A finding about the seal record itself (schema §11.6), or a root record this
  // device does not trust, is a banner on every screen until the brain verifies
  // again (spec §6.5). Settings → Sealing lists what was found.
  import { session } from '../stores/session.svelte';

  const s = $derived(session.sealing);
  const broken = $derived(Object.values(s.verdicts).filter((v) => v.verdict === 'broken').length);
</script>

{#if s.status === 'mismatch' || s.findings.length || broken}
  <p class="error banner" role="alert" data-testid="seal-banner">
    {#if s.status === 'mismatch'}
      The brain’s root record is not the one this device trusts.
    {:else if s.findings.length}
      The seal record was altered: {s.findings.length} problem{s.findings.length === 1 ? '' : 's'}.
    {/if}
    {#if broken}{broken} passage{broken === 1 ? ' does' : 's do'} not match {broken === 1 ? 'its' : 'their'} seal.{/if}
    <a href="#/settings">Settings → Sealing</a> says what.
  </p>
{/if}

<style>
  .banner { margin: 8px 8px 0; }
</style>
