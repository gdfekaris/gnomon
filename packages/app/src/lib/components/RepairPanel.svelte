<script lang="ts">
  // Settings → Sealing, repair (spec §6.5; schema §7.20 "Restore"): everything
  // the last verification found changed, gone, or added, each beside the text
  // that was sealed, with a way to put the sealed text back. The sealed texts
  // come from this device's kept copies or the repository's history, and are
  // offered only after the brain verified with them in place.
  import { untrack } from 'svelte';
  import { hold } from '../press';
  import { describeError, sealingFlows } from '../services/index';
  import { type RepairItem, type RepairKind, type RepairPlan, damage, sealedShown } from '../services/repair';
  import { browseHref } from '../markdown';
  import { session } from '../stores/session.svelte';
  import TextDiff from './TextDiff.svelte';

  const s = $derived(session.sealing);
  const wrong = $derived(s.status === 'on' && s.verifiedHead && !s.locked ? damage(s) : []);
  /** what the comparison belongs to: it is made again only when this changes */
  const key = $derived(wrong.length ? `${s.verifiedHead}|${wrong.map((w) => `${w.path}:${w.kind}`).join('|')}` : '');
  let plan = $state<RepairPlan | null>(null);
  let comparing = $state(false);
  let compareError = $state<string | null>(null);
  let busy = $state<string | null>(null);
  let error = $state<{ at: string; text: string } | null>(null);
  let done = $state<string | null>(null);
  let run = 0;

  function compare() {
    const mine = ++run;
    comparing = true;
    compareError = null;
    sealingFlows.planRepair().then(
      (p) => { if (mine === run) plan = p; },
      (e: unknown) => { if (mine === run) { plan = null; compareError = describeError(e); } },
    ).finally(() => { if (mine === run) comparing = false; });
  }
  $effect(() => {
    if (key === '') {
      run++;
      plan = null;
      comparing = false;
      compareError = null;
    } else untrack(compare);
  });

  const KIND: Record<RepairKind, string> = {
    edited: 'edited', reordered: 'moved in the order', added: 'added', removed: 'removed', 'description-edited': 'name or description edited',
    changed: 'does not match its seal', deleted: 'deleted',
  };
  const fixable = $derived(plan?.items.filter((i) => i.fixable) ?? []);
  const plural = (n: number) => `${n} file${n === 1 ? '' : 's'}`;

  async function restore(at: string, paths?: string[]) {
    if (!plan) return;
    busy = at;
    error = null;
    done = null;
    try {
      const n = await sealingFlows.restore(plan, paths);
      done = `Restored ${plural(n)} to what you sealed.`;
    } catch (e) {
      error = { at, text: describeError(e) };
    } finally {
      busy = null;
    }
  }
  const sealedOf = (i: RepairItem) => sealedShown(i) ?? '';
</script>

{#if done}<p class="ok" role="status" data-testid="repair-done">{done}</p>{/if}
{#if wrong.length}
  <div class="panel" data-testid="seal-repair">
    <p><strong>What changed, beside what you sealed</strong></p>
    {#if comparing && !plan}
      <p class="hint" data-testid="repair-comparing">Comparing with the sealed texts…</p>
    {:else if compareError}
      <p class="error" role="alert" data-testid="repair-error">{compareError}</p>
      <button onclick={compare}>Compare again</button>
    {:else if plan}
      <p class="hint">In each text below, <del>struck through</del> is what you sealed and is gone now; <ins>underlined</ins> is there now and was not in what you sealed.</p>
      {#if plan.historyError}<p class="error" data-testid="repair-history-error">The repository’s history could not be read: {plan.historyError}</p>{/if}
      <ul class="items">
        {#each plan.items as item (item.path)}
          <li data-testid="repair-item" data-path={item.path}>
            <p>{#if item.now !== null}<a href={browseHref(item.path)}><code>{item.path}</code></a>{:else}<code>{item.path}</code>{/if}: {KIND[item.kind]}</p>
            {#if item.fixable}
              {#if item.kind === 'added'}
                <p class="hint">It is not in what you sealed. As it stands:</p>
                <TextDiff was="" now={item.now ?? ''} />
              {:else if item.now === null}
                <p class="hint">It is gone from the brain. What you sealed:</p>
                <pre class="plain" data-testid="repair-sealed">{sealedOf(item)}</pre>
              {:else}
                <TextDiff was={sealedOf(item)} now={item.now} />
              {/if}
              {#if item.from}<p class="hint" data-testid="repair-from">The sealed text is from {item.from === 'device' ? 'the copy on this device' : 'the repository’s history'}, and matches the seal.</p>{/if}
              <button onclick={() => restore(item.path, [item.path])} disabled={busy !== null} use:hold={busy === item.path} data-testid="repair-restore">
                {busy === item.path ? 'Restoring…' : item.kind === 'added' ? 'Remove it' : 'Restore the sealed text'}
              </button>
              {#if error?.at === item.path}<p class="error" role="alert">{error.text}</p>{/if}
            {:else}
              <p class="hint" data-testid="repair-unfound">
                No text that matches the seal was found on this device or in the repository’s history, so it cannot be restored here.
                {#if item.kind === 'changed'}An attached file that changed is not restored by this app.{/if}
              </p>
            {/if}
          </li>
        {/each}
      </ul>
      {#if fixable.length > 1}
        <button onclick={() => restore('all')} disabled={busy !== null} use:hold={busy === 'all'} data-testid="repair-restore-all">{busy === 'all' ? 'Restoring…' : `Restore all ${fixable.length} as sealed`}</button>
        {#if error?.at === 'all'}<p class="error" role="alert">{error.text}</p>{/if}
      {/if}
    {/if}
  </div>
{/if}

<style>
  .items { list-style: none; padding-left: 0; margin: 0.5rem 0; }
  .items li { margin: 0 0 1rem; overflow-wrap: anywhere; }
  .plain { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0.5rem 0; }
</style>
