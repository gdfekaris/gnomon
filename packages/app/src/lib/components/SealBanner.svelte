<script lang="ts">
  // A finding about the seal record itself (schema §11.6), or a root record this
  // device does not trust, is a banner on every screen until the brain verifies
  // again (spec §6.5). Settings → Sealing lists what was found.
  import { session } from '../stores/session.svelte';

  const s = $derived(session.sealing);
  const broken = $derived(Object.entries(s.verdicts).filter(([p, v]) => v.verdict === 'broken' && !p.startsWith('principles/')).length);
  const other = $derived(s.findings.filter((f) => f.code !== 'principles-changed' && f.code !== 'unsealed-source').length);
  const unsealedSources = $derived(s.findings.filter((f) => f.code === 'unsealed-source').length);
</script>

{#if s.status === 'mismatch' || s.findings.length || broken}
  <p class="error banner" role="alert" data-testid="seal-banner">
    {#if s.status === 'mismatch'}
      The brain’s root record is not the one this device trusts.
    {:else if other}
      The seal record was altered: {other} problem{other === 1 ? '' : 's'}.
    {/if}
    {#if s.status !== 'mismatch' && s.differences.length}Your principles differ from what you sealed, in {s.differences.length} place{s.differences.length === 1 ? '' : 's'}.{/if}
    {#if s.status !== 'mismatch' && unsealedSources}{unsealedSources} source{unsealedSources === 1 ? ' is' : 's are'} marked as yours with no seal.{/if}
    {#if broken}{broken} passage{broken === 1 ? ' does' : 's do'} not match {broken === 1 ? 'its' : 'their'} seal.{/if}
    <a href="#/settings">Settings → Sealing</a> says what.
  </p>
{/if}

<style>
  .banner { margin: 8px 8px 0; }
</style>
