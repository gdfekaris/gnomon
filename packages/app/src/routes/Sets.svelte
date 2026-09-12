<script lang="ts">
  // Sets — proposal §6, US-18, US-20. Sets with ordinal and sub-name; new,
  // rename, reorder (drag, plus Move up/down for keyboards), delete with a
  // confirmation naming the principle count and the dangling report; the
  // per-set description; principle reorder within a set.
  import { hold } from '../lib/press';
  import { setLabel } from '@gnomon/core';
  import { brain, describeError } from '../lib/services/index';
  import { type DeletePlan, describeSet, moveSet, movePrinciple, newSet, placePrinciple, placeSet, planDeletePrinciple, planDeleteSet, renameSet } from '../lib/services/sets';
  import { browseHref } from '../lib/markdown';
  import ConnectionNotice from '../lib/components/ConnectionNotice.svelte';
  import { snapshot } from '../lib/stores/snapshot.svelte';

  const s = $derived(snapshot.current);
  let busy = $state(false);
  /** which control is doing the work, so it alone stays pressed while the rest are disabled */
  let pressed = $state<string | null>(null);
  let error = $state<string | null>(null);
  let newName = $state('');
  let renaming = $state<string | null>(null);
  let renameValue = $state('');
  let describing = $state<string | null>(null);
  let describeValue = $state('');
  let plan = $state<(DeletePlan & { kind: 'set' | 'principle' }) | null>(null);
  let dragging = $state<{ kind: 'set' | 'principle'; slug: string; set?: string } | null>(null);

  const slugOf = (path: string) => path.split('/')[1]!;
  const principleSlug = (path: string) => path.split('/')[2]!.replace(/\.md$/, '');

  async function run(key: string, action: () => Promise<unknown>) {
    busy = true;
    pressed = key;
    error = null;
    try {
      await action();
    } catch (e) {
      error = describeError(e);
    } finally {
      busy = false;
      pressed = null;
    }
  }
  const create = () => run('new-set', async () => { await newSet(brain, { name: newName.trim() }); newName = ''; });
  const startRename = (slug: string, current: string | undefined) => { renaming = slug; renameValue = current ?? ''; };
  const saveRename = (slug: string) => run(`rename:${slug}`, async () => { await renameSet(brain, slug, renameValue); renaming = null; });
  const startDescribe = (slug: string, body: string) => { describing = slug; describeValue = body; };
  const saveDescribe = (slug: string) => run(`describe:${slug}`, async () => { await describeSet(brain, slug, describeValue); describing = null; });
  const askDeleteSet = (slug: string) => { plan = { ...planDeleteSet(brain, slug), kind: 'set' }; };
  const askDeletePrinciple = (path: string) => { plan = { ...planDeletePrinciple(brain, path), kind: 'principle' }; };
  const confirmDelete = () => run('delete', async () => { await plan!.commit(); plan = null; });
  const nudgeSet = (slug: string, direction: -1 | 1) => run(`set:${slug}:${direction}`, () => moveSet(brain, slug, direction));
  const nudgePrinciple = (set: string, slug: string, direction: -1 | 1) => run(`principle:${set}/${slug}:${direction}`, () => movePrinciple(brain, set, slug, direction));

  function dropSet(e: DragEvent, index: number) {
    e.preventDefault();
    if (dragging?.kind === 'set') void run('drop', () => placeSet(brain, dragging!.slug, index));
    dragging = null;
  }
  function dropPrinciple(e: DragEvent, set: string, index: number) {
    e.preventDefault();
    if (dragging?.kind === 'principle' && dragging.set === set) void run('drop', () => placePrinciple(brain, set, dragging!.slug, index));
    dragging = null;
  }
</script>

<h2>Principle sets</h2>
{#if !s}
  <ConnectionNotice />
{:else}
  <p class="hint">A set is a stance. Order within a set is precedence: when two principles pull against each other, the earlier one governs.</p>

  {#if plan}
    <div class="confirm" role="alertdialog" data-testid="delete-confirm">
      <p>
        {#if plan.kind === 'set'}
          Delete <strong>{plan.label}</strong> and its {plan.principleCount} principle{plan.principleCount === 1 ? '' : 's'}? Git history keeps them.
        {:else}
          Delete the principle <strong>{plan.label}</strong>? Git history keeps it.
        {/if}
      </p>
      {#if plan.dangling.length}
        <p>These references will dangle until you edit them:</p>
        <ul data-testid="dangling">{#each plan.dangling as d (d.path + d.ref)}<li><code>{d.path}</code> → {d.ref}</li>{/each}</ul>
      {/if}
      <button onclick={confirmDelete} disabled={busy} use:hold={pressed === 'delete'} data-testid="delete-confirm-yes">{pressed === 'delete' ? 'Deleting…' : 'Delete'}</button>
      <button onclick={() => (plan = null)} disabled={busy}>Cancel</button>
    </div>
  {/if}

  <ol class="sets" data-testid="sets">
    {#each s.sets as set, i (set.path)}
      {@const slug = slugOf(set.path)}
      {@const principles = s.principlesOf(slug)}
      <li
        class="set"
        data-testid="set-{slug}"
        draggable="true"
        ondragstart={() => (dragging = { kind: 'set', slug })}
        ondragover={(e) => e.preventDefault()}
        ondrop={(e) => dropSet(e, i)}
      >
        <div class="head">
          {#if renaming === slug}
            <input bind:value={renameValue} placeholder="Sub-name (blank for none)" data-testid="rename-input" />
            <button onclick={() => saveRename(slug)} disabled={busy} use:hold={pressed === `rename:${slug}`} data-testid="rename-save">Save</button>
            <button onclick={() => (renaming = null)}>Cancel</button>
          {:else}
            <h3><a href={browseHref(set.path)} data-testid="set-label">{setLabel(set.fm)}</a></h3>
            <span class="controls">
              <button onclick={() => nudgeSet(slug, -1)} disabled={busy || i === 0} use:hold={pressed === `set:${slug}:-1`} aria-label="Move set up" data-testid="set-up">↑</button>
              <button onclick={() => nudgeSet(slug, 1)} disabled={busy || i === s.sets.length - 1} use:hold={pressed === `set:${slug}:1`} aria-label="Move set down" data-testid="set-down">↓</button>
              <button onclick={() => startRename(slug, set.fm.name)} disabled={busy} data-testid="set-rename">Rename</button>
              <button onclick={() => startDescribe(slug, set.body)} disabled={busy} data-testid="set-describe">Describe</button>
              <button onclick={() => askDeleteSet(slug)} disabled={busy || s.sets.length === 1} data-testid="set-delete">Delete</button>
            </span>
          {/if}
        </div>
        {#if describing === slug}
          <label>
            Framing for this set <small>(sent to the model verbatim whenever the set is selected)</small>
            <textarea bind:value={describeValue} rows="4" data-testid="describe-input"></textarea>
          </label>
          <button onclick={() => saveDescribe(slug)} disabled={busy} use:hold={pressed === `describe:${slug}`} data-testid="describe-save">Save</button>
          <button onclick={() => (describing = null)}>Cancel</button>
        {:else if set.body}
          <p class="framing">{set.body}</p>
        {/if}
        <ol class="principles" data-testid="principles-{slug}">
          {#each principles as p, j (p.path)}
            <li
              draggable="true"
              ondragstart={(e) => { e.stopPropagation(); dragging = { kind: 'principle', slug: principleSlug(p.path), set: slug }; }}
              ondragover={(e) => e.preventDefault()}
              ondrop={(e) => { e.stopPropagation(); dropPrinciple(e, slug, j); }}
            >
              <span class="num" aria-label="precedence {p.fm.order}">{p.fm.order}.</span>
              <a href={browseHref(p.path)} class="title">{p.fm.title}</a>
              <span class="controls">
                <button onclick={() => nudgePrinciple(slug, principleSlug(p.path), -1)} disabled={busy || j === 0} use:hold={pressed === `principle:${slug}/${principleSlug(p.path)}:-1`} aria-label="Move principle up" data-testid="principle-up">↑</button>
                <button onclick={() => nudgePrinciple(slug, principleSlug(p.path), 1)} disabled={busy || j === principles.length - 1} use:hold={pressed === `principle:${slug}/${principleSlug(p.path)}:1`} aria-label="Move principle down" data-testid="principle-down">↓</button>
                <button onclick={() => askDeletePrinciple(p.path)} disabled={busy} aria-label="Delete principle" data-testid="principle-delete">Delete</button>
              </span>
            </li>
          {:else}
            <li class="empty">No principles yet. Write one below, or accept a proposal.</li>
          {/each}
        </ol>
        <p><a href="#/sets/{slug}/new-principle" data-testid="new-principle">+ New principle</a></p>
      </li>
    {/each}
  </ol>

  <form class="new" onsubmit={(e) => { e.preventDefault(); void create(); }}>
    <label>New set <input bind:value={newName} placeholder="Optional sub-name, e.g. Work" data-testid="new-set-name" /></label>
    <button type="submit" disabled={busy} use:hold={pressed === 'new-set'} data-testid="new-set">Create Set {s.sets.length + 1}</button>
  </form>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
{/if}

<style>
  .sets { list-style: none; padding: 0; }
  .set { border: var(--bw) solid var(--edge); box-shadow: var(--raise); padding: 0.75rem; margin-bottom: 0.75rem; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  .head h3 { margin: 0; }
  .controls { display: inline-flex; gap: 0.25rem; flex-wrap: nowrap; }
  .controls button { min-height: 0; padding: 0.25rem 0.5rem; font-size: var(--fs-small); border-radius: calc(var(--radius) - 2px); }
  /* Order is precedence: each row carries its number from the file's `order`, which the arrows and drags
     rewrite, so the numbers follow a reorder. A flex row draws no list marker, hence the span. */
  .principles { padding-left: 0; list-style: none; }
  .principles li { display: flex; align-items: center; gap: 0.5rem; margin: 0; padding: 0.35rem 0; border-top: var(--status-border, 1px dotted var(--edge)); }
  .principles li:first-child { border-top: 0; }
  .principles li.empty { border-top: 0; }
  .num { flex: 0 0 1.5rem; text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; }
  .title { flex: 1 1 auto; min-width: 0; }
  .framing { color: var(--muted); font-size: var(--fs-small); white-space: pre-wrap; margin: 0.5rem 0; }
  .confirm { flex-direction: column; align-items: stretch; }
  .confirm p { margin: 0 0 6px; }
  .new { display: flex; gap: 0.5rem; align-items: end; flex-wrap: wrap; }
  .new label { flex: 1 1 12rem; }
</style>
