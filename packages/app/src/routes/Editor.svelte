<script lang="ts">
  // Editor — US-4, US-6, US-7. One route, dispatched by file type:
  // principle (create or edit), notes, or source metadata. Sets are edited
  // on the Sets screen; raw.md bodies and attachments have no editor.
  import { hold } from '../lib/press';
  import { untrack } from 'svelte';
  import { type BrainFile, type NotesFm, type PrincipleFm, type SourceFm, setLabel } from '@gnomon/core';
  import ConnectionNotice from '../lib/components/ConnectionNotice.svelte';
  import { brain, describeError } from '../lib/services/index';
  import { appendGroundingLink, createPrincipleIn, driftOf, parseList, saveNotes, savePrinciple, saveSourceMeta, slugOfSource, tagList } from '../lib/services/edit';
  import { browseHref } from '../lib/markdown';
  import { prefillFrom } from '../lib/services/proposals';
  import { type DeletePlan, planDeletePrinciple } from '../lib/services/sets';
  import { session } from '../lib/stores/session.svelte';
  import { snapshot } from '../lib/stores/snapshot.svelte';

  // `copy`: a new principle pre-filled from an existing one in another set (files never move, schema §1 rule 1:
  // a principle changes set by being created there and deleted here, two commits). `copied`: the copy has been
  // made; this editor is on the original and offers to delete it, dangling references listed.
  // `returnTo`: where Back and a plain save return to when the editor was opened from somewhere other than
  // the file view (the Inbox review panel sends `#/inbox?filing=<slug>` so the filing is open again on return).
  let { path, newIn = undefined, from = undefined, copy = undefined, copied = undefined, returnTo = undefined }: { path: string; newIn?: string | undefined; from?: string | undefined; copy?: string | undefined; copied?: string | undefined; returnTo?: string | undefined } = $props();
  const s = $derived(snapshot.current);
  const file = $derived(newIn ? undefined : s?.files.get(path));
  const kind = $derived<'principle' | 'notes' | 'source' | 'none'>(newIn ? 'principle' : file?.fm.type === 'principle' || file?.fm.type === 'notes' || file?.fm.type === 'source' ? file.fm.type : 'none');
  const targetPath = $derived(newIn ? `principles/${newIn}/new.md` : path);

  let busy = $state(false);
  let error = $state<string | null>(null);
  let loadedFor = $state<string | null>(null);
  // principle fields
  let title = $state('');
  let body = $state('');
  let grounds = $state<string[]>([]);
  let related = $state('');
  let tags = $state('');
  let picker = $state('');
  // source fields
  let author = $state('');
  let work = $state('');
  let year = $state('');
  let locator = $state('');
  let origin = $state('');

  // A proposal being accepted (schema §4.7): pre-fill a new principle, or show the suggestion beside an existing file.
  const prefill = $derived(from && s ? prefillFrom(s, from, newIn ?? path.split('/')[1] ?? '') : null);
  const source = $derived(newIn && copy && s ? (s.files.get(copy) as BrainFile<PrincipleFm> | undefined) : undefined);
  const setOf = (p: string) => s?.sets.find((x) => x.path === `principles/${p.split('/')[1]}/_set.md`);
  const otherSets = $derived(kind === 'principle' && !newIn && s ? s.sets.filter((x) => x.path !== `principles/${path.split('/')[1]}/_set.md`) : []);
  let copyTo = $state('');
  const copyFile = $derived(copied && s ? s.files.get(copied) : undefined);
  let deletePlan = $state<DeletePlan | null>(null);

  // What the fields held when they were loaded, so Back can tell an edited form from an untouched one.
  const signature = () => JSON.stringify({ title, body, grounds, related, tags, author, work, year, locator, origin });
  let baseline = $state('');
  const dirty = $derived(signature() !== baseline);
  const backHref = $derived(newIn ? '#/sets' : returnTo ?? browseHref(path));
  let leaving = $state(false);
  function back(e: Event) {
    if (!dirty) return;
    e.preventDefault();
    leaving = true;
  }

  $effect(() => {
    // The fields load once per file, and only once the brain is here: on a cold start into this
    // route (the phone relaunching the app, say) the snapshot arrives after the editor mounted,
    // and locking the key before then would leave a proposal's draft empty for good.
    if (!s) return;
    const key = `${newIn ?? ''}|${path}|${file?.sha ?? ''}|${from ?? ''}|${copy ?? ''}`;
    if (loadedFor === key) return;
    loadedFor = key;
    error = null;
    leaving = false;
    if (kind === 'principle' && file) {
      const fm = file.fm as PrincipleFm;
      title = fm.title; body = file.body; grounds = [...fm.grounds]; related = (fm.related ?? []).join(', '); tags = (fm.tags ?? []).join(', ');
    } else if (kind === 'principle' && source) {
      title = source.fm.title; body = source.body; grounds = [...source.fm.grounds]; related = (source.fm.related ?? []).join(', '); tags = (source.fm.tags ?? []).join(', ');
    } else if (kind === 'principle') {
      title = prefill?.title ?? ''; body = prefill?.body ?? ''; grounds = prefill ? [...prefill.grounds] : []; related = ''; tags = '';
    } else if (kind === 'notes' && file) {
      body = file.body;
    } else if (kind === 'source' && file) {
      const fm = file.fm as SourceFm;
      title = fm.title; author = fm.author; work = fm.work ?? ''; year = fm.year === undefined ? '' : String(fm.year); locator = fm.locator ?? ''; origin = fm.origin ?? ''; tags = (fm.tags ?? []).join(', ');
    }
    // The effect wrote these; reading them back must not make it its own trigger.
    untrack(() => { baseline = signature(); });
  });

  const drift = $derived(kind === 'principle' ? driftOf(targetPath, body, grounds) : { inBodyOnly: [], inGroundsOnly: [] });
  const drifted = $derived(drift.inBodyOnly.length > 0 || drift.inGroundsOnly.length > 0);
  const sources = $derived(s ? s.byType('source') : []);

  async function run(action: () => Promise<string | void>) {
    busy = true;
    error = null;
    try {
      const to = await action();
      location.hash = typeof to === 'string' ? browseHref(to) : returnTo ?? browseHref(path);
    } catch (e) {
      error = describeError(e);
    } finally {
      busy = false;
    }
  }
  const fields = () => ({ title, body, grounds, related: parseList(related), tags: tagList(tags) });
  const save = () => (newIn && copy ? saveCopy() : run(() => (newIn ? createPrincipleIn(brain, newIn, fields()) : kind === 'principle' ? savePrinciple(brain, path, fields()) : kind === 'notes' ? saveNotes(brain, path, body) : saveSourceMeta(brain, path, { title, author, work, year, locator, origin, tags: tagList(tags) }))));
  // The copy is one create commit; then the original's editor asks about deleting it.
  async function saveCopy() {
    busy = true;
    error = null;
    try {
      const created = await createPrincipleIn(brain, newIn!, fields());
      location.hash = `#/edit/${copy}?copied=${encodeURIComponent(created)}`;
    } catch (e) {
      error = describeError(e);
    } finally {
      busy = false;
    }
  }
  const startCopy = () => { if (copyTo) location.hash = `#/sets/${copyTo}/new-principle?copy=${encodeURIComponent(path)}`; };
  const askDeleteOriginal = () => { deletePlan = planDeletePrinciple(brain, path); };
  const deleteOriginal = () => run(async () => { await deletePlan!.commit(); deletePlan = null; return copied; });
  function insertLink() {
    if (!picker) return;
    body = appendGroundingLink(body, targetPath, picker);
    if (!grounds.includes(picker)) grounds = [...grounds, picker];
    picker = '';
  }
  const useBodyLinks = () => { grounds = [...grounds.filter((g) => !drift.inGroundsOnly.includes(g)), ...drift.inBodyOnly]; };
  const addLinksForGrounds = () => { for (const g of drift.inGroundsOnly) body = appendGroundingLink(body, targetPath, g); };
</script>

{#if !s}
  <ConnectionNotice />
{:else if kind === 'none'}
  <p><a href={browseHref(path)}>← Back</a></p>
  <p class="error">Nothing editable at <code>{path}</code>. Passages and attachments are immutable; corrections go in the notes file.</p>
{:else}
  <p><a href={backHref} onclick={back} data-testid="edit-back">← Back</a></p>
  {#if leaving}
    <div class="confirm" role="alertdialog" data-testid="discard-confirm">
      <p>This {kind === 'principle' ? 'principle' : kind === 'notes' ? 'note' : 'source'} has changes that are not saved. Leave without saving them?</p>
      <div class="row">
        <button type="button" onclick={() => { leaving = false; location.hash = backHref; }} data-testid="discard-yes">Leave without saving</button>
        <button type="button" class="primary" onclick={() => (leaving = false)} data-testid="discard-no">Keep editing</button>
      </div>
    </div>
  {/if}
  {#if prefill}
    <div class="from" role="status" data-testid="from-proposal">
      <p><strong>From proposal <code>{prefill.id}</code></strong> ({prefill.kind}){#if prefill.kind !== 'principle'}: <em>{s.files.get(`maps/proposals/${prefill.id}.md`) && 'title' in s.files.get(`maps/proposals/${prefill.id}.md`)!.fm ? (s.files.get(`maps/proposals/${prefill.id}.md`)!.fm as { title: string }).title : ''}</em>{/if}</p>
      {#if prefill.rationale}<p class="rationale">{prefill.rationale}</p>{/if}
      <p class="hint">{prefill.kind === 'principle' ? 'The draft below is the proposal\'s wording. A principle is yours only once you have rewritten it in your own words.' : prefill.kind === 'link' ? 'This proposes a ground: pick the source below and add it to this principle\'s grounds if you agree. The proposal is only a suggestion.' : 'Apply what you agree with by hand; the proposal is only a suggestion.'}</p>
    </div>
  {/if}
  {#if kind === 'principle'}
    <h2>{newIn ? `New principle in ${setLabel(s.sets.find((x) => x.path === `principles/${newIn}/_set.md`)!.fm)}` : 'Edit principle'}</h2>
    {#if source}
      <div class="from" role="status" data-testid="from-copy">
        <p><strong>Copied from {source.fm.title}</strong> in {setLabel(setOf(copy!)?.fm ?? { order: 0 } as never)}.</p>
        <p class="hint">Files never move: adding it here makes a new file, and you then decide about the original. Links that named the original will not follow it; you will be shown which.</p>
      </div>
    {/if}
    {#if copyFile}
      <div class="from" role="status" data-testid="copied">
        <p><strong>The copy is in place:</strong> <a href={browseHref(copied!)}>{(copyFile.fm as PrincipleFm).title}</a> in {setLabel(setOf(copied!)?.fm ?? { order: 0 } as never)}.</p>
        {#if deletePlan}
          <p>Delete the original <strong>{deletePlan.label}</strong> from {setLabel(setOf(path)?.fm ?? { order: 0 } as never)}? Git history keeps it.</p>
          {#if deletePlan.dangling.length}
            <p>These references name the original and will dangle:</p>
            <ul data-testid="dangling">{#each deletePlan.dangling as d (d.path + d.ref)}<li><code>{d.path}</code> → {d.ref}</li>{/each}</ul>
          {:else}
            <p class="hint">Nothing in the brain references the original.</p>
          {/if}
          <div class="row">
            <button type="button" class="primary" onclick={deleteOriginal} disabled={busy} use:hold={busy} data-testid="delete-original-yes">Delete the original</button>
            <button type="button" onclick={() => (deletePlan = null)} disabled={busy}>Not now</button>
          </div>
        {:else}
          <div class="row">
            <button type="button" onclick={askDeleteOriginal} disabled={busy} data-testid="delete-original">Delete the original</button>
            <a href={browseHref(copied!)} data-testid="keep-both">Keep both</a>
          </div>
        {/if}
      </div>
    {/if}
    <p class="hint">In your own words. A principle is not a summary of a source: if the source turned out to be wrong, the principle should survive.</p>
    <form onsubmit={(e) => { e.preventDefault(); void save(); }}>
      <label>Title <input bind:value={title} required data-testid="edit-title" /></label>
      <label>Body <textarea bind:value={body} rows="10" data-testid="edit-body"></textarea></label>
      <div class="grounds">
        <span>Grounds:</span>
        {#each grounds as g (g)}
          <span class="chip" data-testid="ground-{g}">{g} <button type="button" onclick={() => (grounds = grounds.filter((x) => x !== g))} aria-label="Remove {g}">×</button></span>
        {:else}
          <em>none</em>
        {/each}
      </div>
      <label>
        Insert a grounding passage
        <span class="row">
          <select bind:value={picker} data-testid="link-picker">
            <option value="">Choose a source…</option>
            {#each sources as src (src.path)}<option value={slugOfSource(src.path)}>{src.fm.title} — {src.fm.author}</option>{/each}
          </select>
          <button type="button" onclick={insertLink} disabled={!picker} data-testid="link-insert">Insert link</button>
        </span>
      </label>
      {#if drifted}
        <div class="drift" role="status" data-testid="drift">
          <p>The body's links and the grounds list disagree.
            {#if drift.inBodyOnly.length}Linked in the body only: {drift.inBodyOnly.join(', ')}.{/if}
            {#if drift.inGroundsOnly.length}In grounds only: {drift.inGroundsOnly.join(', ')}.{/if}</p>
          <button type="button" onclick={useBodyLinks} data-testid="sync-grounds">Use the body's links as grounds</button>
          <button type="button" onclick={addLinksForGrounds} disabled={!drift.inGroundsOnly.length} data-testid="sync-body">Add links for the grounds to the body</button>
        </div>
      {/if}
      <label>Related principles <small>(set/slug, comma-separated)</small> <input bind:value={related} data-testid="edit-related" /></label>
      <label>Tags <small>(comma-separated)</small> <input bind:value={tags} data-testid="edit-tags" /></label>
      <button type="submit" class="primary" disabled={busy || !title.trim()} use:hold={busy} data-testid="edit-save">{busy ? (newIn ? 'Adding…' : 'Saving…') : newIn ? 'Add principle' : 'Save'}</button>
      {#if busy}<span role="status" class="hint" data-testid="saving">One commit to your repository; a few seconds.</span>{/if}
      {#if kind === 'principle' && !newIn && !otherSets.length}
        <p class="hint" data-testid="copy-needs-set">To copy this principle to another set, <a href="#/sets">create that set first</a>; a copy control appears here once the brain has more than one set.</p>
      {:else if otherSets.length}
        <div class="row copy" data-testid="copy-to">
          <label>Copy to another set
            <select bind:value={copyTo} data-testid="copy-set">
              <option value="">Choose a set…</option>
              {#each otherSets as x (x.path)}<option value={x.path.split('/')[1]}>{setLabel(x.fm)}</option>{/each}
            </select>
          </label>
          <button type="button" onclick={startCopy} disabled={busy || !copyTo} data-testid="copy-go">Copy</button>
        </div>
        <p class="hint">A principle belongs to one set. Copying makes a new principle there; you then choose whether to delete this one.</p>
      {/if}
    </form>
  {:else if kind === 'notes'}
    <h2>Notes on {slugOfSource(path)}</h2>
    <p class="hint">Marginalia, corrections, and context. Saving makes this file yours ({(file!.fm as NotesFm).curated === 'human' ? 'it already is' : `it is ${(file!.fm as NotesFm).curated} now`}).</p>
    <form onsubmit={(e) => { e.preventDefault(); void save(); }}>
      <label>Notes <textarea bind:value={body} rows="12" data-testid="edit-body"></textarea></label>
      <button type="submit" class="primary" disabled={busy} use:hold={busy} data-testid="edit-save">{busy ? 'Saving…' : 'Save'}</button>
    </form>
  {:else}
    <h2>Edit source metadata</h2>
    <p class="hint">The passage itself is immutable; it is shown below but cannot be changed. Saving makes this file yours.</p>
    <form onsubmit={(e) => { e.preventDefault(); void save(); }}>
      <label>Title <input bind:value={title} required data-testid="edit-title" /></label>
      <label>Author <input bind:value={author} data-testid="edit-author" /></label>
      <label>Work <input bind:value={work} data-testid="edit-work" /></label>
      <label>Year <input bind:value={year} inputmode="numeric" data-testid="edit-year" /></label>
      <label>Locator <input bind:value={locator} /></label>
      <label>Origin <input bind:value={origin} /></label>
      <label>Tags <small>(comma-separated)</small> <input bind:value={tags} data-testid="edit-tags" /></label>
      <button type="submit" class="primary" disabled={busy || !title.trim()} use:hold={busy} data-testid="edit-save">{busy ? 'Saving…' : 'Save'}</button>
    </form>
    <h3>Passage (read-only)</h3>
    <pre class="passage" data-testid="passage-readonly">{(file as BrainFile<SourceFm>).body}</pre>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
{/if}

<style>
  form { display: grid; gap: 0.75rem; }
  label { display: grid; gap: 0.3rem; }
  .row { display: flex; gap: 0.5rem; align-items: stretch; }
  .grounds { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; }
  .chip { display: inline-flex; align-items: center; gap: 4px; cursor: default; }
  .chip button { min-height: 0; padding: 0 2px; border: 0; box-shadow: none; background: none; color: inherit; font-size: var(--fs); line-height: 1; }
  .drift, .from, .confirm { flex-direction: column; align-items: stretch; }
  .from p, .drift p, .confirm p { margin: 0.25rem 0; }
  .rationale { white-space: pre-wrap; }
  form button.primary { justify-self: center; }
</style>
