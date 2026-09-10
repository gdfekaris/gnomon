<script lang="ts">
  // Save a Relate answer's proposal as your own (Phase 3 block 5): kind and
  // target chosen in a small form pre-filled from the answer, one commit.
  import { untrack } from 'svelte';
  import { setLabel } from '@gnomon/core';
  import { brain, describeError } from '../services/index';
  import { type ProposalDraft, saveProposal } from '../services/proposals';
  import { snapshot } from '../stores/snapshot.svelte';

  let { draft, onsaved, oncancel }: { draft: ProposalDraft; onsaved: (id: string) => void; oncancel: () => void } = $props();
  // The draft seeds the fields once; from then on they are the curator's.
  const initial = untrack(() => ({ ...draft }));
  let kind = $state(initial.kind);
  let targetSet = $state(initial.target_set);
  let target = $state(initial.target ?? '');
  let title = $state(initial.title);
  let rationale = $state(initial.rationale);
  let grounds = $state(initial.grounds.join(', '));
  let busy = $state(false);
  let error = $state<string | null>(null);

  const s = $derived(snapshot.current);
  const sets = $derived(s ? s.sets.map((f) => ({ slug: f.path.split('/')[1]!, label: setLabel(f.fm) })) : []);
  const principles = $derived(s && targetSet ? s.principlesOf(targetSet).map((p) => ({ ref: `${targetSet}/${p.path.split('/')[2]!.replace(/\.md$/, '')}`, title: p.fm.title })) : []);

  async function save() {
    busy = true;
    error = null;
    try {
      const id = await saveProposal(brain, {
        kind, title, target_set: targetSet, rationale,
        grounds: grounds.split(',').map((g) => g.trim()).filter(Boolean),
        ...(kind === 'amendment' && target ? { target } : {}),
      });
      onsaved(id);
    } catch (e) {
      error = describeError(e);
    } finally {
      busy = false;
    }
  }
</script>

<form class="panel" data-testid="proposal-form" onsubmit={(e) => { e.preventDefault(); void save(); }}>
  <p class="hint">Saved as your own proposal, open, in the target set. Nothing changes a principle until you decide it there.</p>
  <div class="row">
    <label>Kind
      <select bind:value={kind} data-testid="proposal-kind">
        <option value="principle">principle</option>
        <option value="amendment">amendment</option>
      </select>
    </label>
    <label>Target set
      <select bind:value={targetSet} data-testid="proposal-set">
        {#each sets as set (set.slug)}<option value={set.slug}>{set.label}</option>{/each}
      </select>
    </label>
  </div>
  {#if kind === 'amendment'}
    <label>Principle to amend
      <select bind:value={target} data-testid="proposal-target">
        <option value="">Choose a principle…</option>
        {#each principles as p (p.ref)}<option value={p.ref}>{p.title}</option>{/each}
      </select>
    </label>
  {/if}
  <label>Wording <input bind:value={title} required data-testid="proposal-title" /></label>
  <label>Rationale <textarea bind:value={rationale} rows="4" data-testid="proposal-rationale"></textarea></label>
  <label>Grounds <small>(source slugs, comma-separated)</small> <input bind:value={grounds} data-testid="proposal-grounds" /></label>
  <div class="row">
    <button type="submit" class="primary" disabled={busy || !title.trim() || !targetSet || (kind === 'amendment' && !target)} data-testid="proposal-save">{busy ? 'Saving…' : 'Save proposal'}</button>
    <button type="button" class="quiet" onclick={oncancel} disabled={busy}>Cancel</button>
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</form>

<style>
  form { display: grid; gap: 0.6rem; }
  label { display: grid; gap: 0.25rem; }
  .row { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: end; }
  .row label { flex: 1 1 8rem; }
  .hint { margin: 0; }
</style>
