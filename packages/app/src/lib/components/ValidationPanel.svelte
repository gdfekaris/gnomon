<script lang="ts">
  // Connect-existing results (US-15): refusals with an Add button for each
  // missing scaffold item, warnings, and the index offer. Content is never
  // touched; what the app cannot fix is listed for the curator.
  import { hold } from '../press';
  import type { CommitBatch } from '@gnomon/core';
  import { SCAFFOLD } from '../scaffold';
  import { brain, describeError } from '../services/index';
  import { type ConnectReport, applyOffer, inspectBrain } from '../services/connect';
  import { session } from '../stores/session.svelte';
  import { snapshot } from '../stores/snapshot.svelte';

  let report = $state<ConnectReport | null>(null);
  let busy = $state(false);
  /** which control is doing the work, so it alone stays pressed */
  let pressed = $state<string | null>(null);
  let error = $state<string | null>(null);

  async function check() {
    const driver = session.driver;
    if (!driver) return;
    busy = true;
    pressed = 'check';
    error = null;
    try {
      report = await inspectBrain(brain, driver, SCAFFOLD);
    } catch (e) {
      error = describeError(e);
    } finally {
      busy = false;
      pressed = null;
    }
  }
  async function apply(batch: CommitBatch, key: string) {
    const driver = session.driver;
    if (!driver) return;
    busy = true;
    pressed = key;
    error = null;
    try {
      report = await applyOffer(brain, driver, SCAFFOLD, batch);
    } catch (e) {
      error = describeError(e);
    } finally {
      busy = false;
      pressed = null;
    }
  }
  // Re-check whenever a different brain (head) is loaded.
  $effect(() => {
    void snapshot.current?.head;
    if (session.driver && snapshot.current) void check();
    else report = null;
  });
  const offerFor = (path: string) => report?.offers.find((o) => o.path === path || o.path === `${path}`);
</script>

{#if report}
  <div data-testid="validation">
    <p>
      <strong data-testid="refusal-count">{report.refusals.length} refusal{report.refusals.length === 1 ? '' : 's'}</strong>,
      <span data-testid="warning-count">{report.warnings.length} warning{report.warnings.length === 1 ? '' : 's'}</span>
      <button onclick={check} disabled={busy} use:hold={pressed === 'check'}>Re-check</button>
    </p>
    {#if report.refusals.length}
      <ul class="issues" data-testid="refusals">
        {#each report.refusals as i (i.path + i.rule + i.message)}
          {@const offer = offerFor(i.path) ?? (i.rule === 'sets.none' ? report.offers.find((o) => o.label === 'Add Set 1') : undefined)}
          <li>
            <code>{i.path}</code> — {i.message} <small>({i.rule})</small>
            {#if offer}
              <button onclick={() => apply(offer.batch, offer.path)} disabled={busy} use:hold={pressed === offer.path} data-testid="offer-{offer.path}">{offer.label}</button>
            {:else}
              <em>fix by hand; the app never rewrites your files</em>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if report.warnings.length}
      <ul class="issues warnings" data-testid="warnings">
        {#each report.warnings as i (i.path + i.rule + i.message)}
          <li><code>{i.path}</code> — {i.message} <small>({i.rule})</small></li>
        {/each}
      </ul>
    {/if}
    {#if report.indexes}
      <p>The generated index files are stale. <button onclick={() => apply(report!.indexes!, 'indexes')} disabled={busy} use:hold={pressed === 'indexes'} data-testid="offer-indexes">Regenerate indexes</button></p>
    {/if}
    {#if !report.refusals.length && !report.warnings.length && !report.indexes}
      <p class="ok">The brain is valid and its indexes are current.</p>
    {/if}
  </div>
{:else if busy}
  <p>Checking…</p>
{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}

<style>
  .issues { padding-left: 1rem; }
  .issues li { margin: 0.35rem 0; }
  .warnings { color: var(--muted); }
  button { margin-left: 0.5rem; }
</style>
