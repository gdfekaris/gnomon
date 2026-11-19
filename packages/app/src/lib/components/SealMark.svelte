<script lang="ts">
  // The seal verdict of a capture, a source, a set, or a principle (spec
  // §6.5, schema §11.6), shown only once this device verifies the brain:
  // changed loud, unsealed quiet. A set or principle carries no mark until
  // the principles have been sealed once, since none could be sealed before.
  import { session } from '../stores/session.svelte';
  import { snapshot } from '../stores/snapshot.svelte';

  let { path }: { path: string } = $props();
  const tree = $derived(path.startsWith('principles/'));
  const v = $derived(session.sealing.verifiedHead && !(tree && !session.sealing.fullySealed) ? session.sealing.verdicts[path] : undefined);
  // A source the curator already ratified, from before sources were sealed: its text is the sealed capture's, but no seal of its own says it is the curator's yet.
  const mineUnsealed = $derived(v?.verdict === 'pending' && (snapshot.current?.files.get(path)?.fm as { curated?: string } | undefined)?.curated !== 'agent-proposed');
  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
</script>

{#if v?.verdict === 'verified'}
  <span class="seal ok" title={tree ? 'Exactly as you last sealed it, in its place.' : path.startsWith('sources/') ? 'Byte for byte the text you ratified, with its title and author.' : 'Byte for byte what was captured, signed when it was captured.'} data-testid="seal-mark" data-verdict="verified">sealed</span>
{:else if v?.verdict === 'attested'}
  <span class="seal ok" title="Sealed after the fact: unchanged since {day(v.since)}." data-testid="seal-mark" data-verdict="attested">sealed since {day(v.since)}</span>
{:else if mineUnsealed}
  <span class="seal quiet" title="The text is the sealed capture’s, but nothing yet seals this source as yours. Settings → Sealing seals everything that exists." data-testid="seal-mark" data-verdict="pending">not sealed yet</span>
{:else if v?.verdict === 'pending'}
  <span class="seal quiet" title="The text is the sealed capture’s. It becomes yours, and usable in reasoning, when you ratify it." data-testid="seal-mark" data-verdict="pending">awaiting your review</span>
{:else if v?.verdict === 'unsealed'}
  <span class="seal quiet" title={tree ? 'Not in the list of principles you sealed.' : 'No seal: made before sealing, or written by an agent.'} data-testid="seal-mark" data-verdict="unsealed">{tree ? 'not sealed' : 'unsealed'}</span>
{:else if v?.verdict === 'broken'}
  <span class="seal broken" title={v.why} data-testid="seal-mark" data-verdict="broken">{tree ? 'changed' : 'broken'}: {v.why}</span>
{/if}

<style>
  .seal { font-size: 0.8em; padding: 0 0.3em; border: var(--bw, 1px) solid currentColor; white-space: nowrap; }
  .ok { color: var(--ok, inherit); }
  .quiet { color: var(--muted); border-style: dotted; }
  .broken { color: var(--danger-ink, var(--danger)); background: var(--danger-bg, transparent); font-weight: bold; white-space: normal; }
</style>
