<script lang="ts">
  // A capture's or a source's seal verdict (spec §6.5, schema §11.6), shown
  // only once this device verifies the brain: broken loud, unsealed quiet.
  import { session } from '../stores/session.svelte';

  let { path }: { path: string } = $props();
  const v = $derived(session.sealing.verifiedHead ? session.sealing.verdicts[path] : undefined);
  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
</script>

{#if v?.verdict === 'verified'}
  <span class="seal ok" title="Byte for byte what was captured, signed when it was captured." data-testid="seal-mark" data-verdict="verified">sealed</span>
{:else if v?.verdict === 'attested'}
  <span class="seal ok" title="Sealed after the fact: unchanged since {day(v.since)}." data-testid="seal-mark" data-verdict="attested">sealed since {day(v.since)}</span>
{:else if v?.verdict === 'unsealed'}
  <span class="seal quiet" title="No seal: captured before sealing, or written by an agent." data-testid="seal-mark" data-verdict="unsealed">unsealed</span>
{:else if v?.verdict === 'broken'}
  <span class="seal broken" title={v.why} data-testid="seal-mark" data-verdict="broken">broken: {v.why}</span>
{/if}

<style>
  .seal { font-size: 0.8em; padding: 0 0.3em; border: var(--bw, 1px) solid currentColor; white-space: nowrap; }
  .ok { color: var(--ok, inherit); }
  .quiet { color: var(--muted); border-style: dotted; }
  .broken { color: var(--danger-ink, var(--danger)); background: var(--danger-bg, transparent); font-weight: bold; white-space: normal; }
</style>
