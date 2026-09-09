<script lang="ts">
  // Editor — US-4, US-6, US-7. One route, dispatched by file type:
  // principle (create or edit), notes, or source metadata. Sets are edited
  // on the Sets screen; raw.md bodies and attachments have no editor.
  import { type BrainFile, type NotesFm, type PrincipleFm, type SourceFm, setLabel } from '@gnomon/core';
  import ConnectionNotice from '../lib/components/ConnectionNotice.svelte';
  import { brain, describeError } from '../lib/services/index';
  import { appendGroundingLink, createPrincipleIn, driftOf, parseList, saveNotes, savePrinciple, saveSourceMeta, slugOfSource, tagList } from '../lib/services/edit';
  import { browseHref } from '../lib/markdown';
  import { prefillFrom } from '../lib/services/proposals';
  import { session } from '../lib/stores/session.svelte';
  import { snapshot } from '../lib/stores/snapshot.svelte';

  let { path, newIn = undefined, from = undefined }: { path: string; newIn?: string | undefined; from?: string | undefined } = $props();
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

  $effect(() => {
    const key = `${newIn ?? ''}|${path}|${file?.sha ?? ''}|${from ?? ''}`;
    if (loadedFor === key) return;
    loadedFor = key;
    error = null;
    if (kind === 'principle' && file) {
      const fm = file.fm as PrincipleFm;
      title = fm.title; body = file.body; grounds = [...fm.grounds]; related = (fm.related ?? []).join(', '); tags = (fm.tags ?? []).join(', ');
    } else if (kind === 'principle') {
      title = prefill?.title ?? ''; body = prefill?.body ?? ''; grounds = prefill ? [...prefill.grounds] : []; related = ''; tags = '';
    } else if (kind === 'notes' && file) {
      body = file.body;
    } else if (kind === 'source' && file) {
      const fm = file.fm as SourceFm;
      title = fm.title; author = fm.author; work = fm.work ?? ''; year = fm.year === undefined ? '' : String(fm.year); locator = fm.locator ?? ''; origin = fm.origin ?? ''; tags = (fm.tags ?? []).join(', ');
    }
  });

  const drift = $derived(kind === 'principle' ? driftOf(targetPath, body, grounds) : { inBodyOnly: [], inGroundsOnly: [] });
  const drifted = $derived(drift.inBodyOnly.length > 0 || drift.inGroundsOnly.length > 0);
  const sources = $derived(s ? s.byType('source') : []);

  async function run(action: () => Promise<string | void>) {
    busy = true;
    error = null;
    try {
      const to = await action();
      location.hash = browseHref(typeof to === 'string' ? to : path);
    } catch (e) {
      error = describeError(e);
    } finally {
      busy = false;
    }
  }
  const fields = () => ({ title, body, grounds, related: parseList(related), tags: tagList(tags) });
  const save = () => run(() => (newIn ? createPrincipleIn(brain, newIn, fields()) : kind === 'principle' ? savePrinciple(brain, path, fields()) : kind === 'notes' ? saveNotes(brain, path, body) : saveSourceMeta(brain, path, { title, author, work, year, locator, origin, tags: tagList(tags) })));
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
  <p><a href={newIn ? '#/sets' : browseHref(path)}>← Back</a></p>
  {#if prefill}
    <div class="from" role="status" data-testid="from-proposal">
      <p><strong>From proposal <code>{prefill.id}</code></strong> ({prefill.kind}){#if prefill.kind !== 'principle'}: <em>{s.files.get(`maps/proposals/${prefill.id}.md`) && 'title' in s.files.get(`maps/proposals/${prefill.id}.md`)!.fm ? (s.files.get(`maps/proposals/${prefill.id}.md`)!.fm as { title: string }).title : ''}</em>{/if}</p>
      {#if prefill.rationale}<p class="rationale">{prefill.rationale}</p>{/if}
      <p class="hint">{prefill.kind === 'principle' ? 'The draft below is the proposal\'s wording. A principle is yours only once you have rewritten it in your own words.' : 'Apply what you agree with by hand; the proposal is only a suggestion.'}</p>
    </div>
  {/if}
  {#if kind === 'principle'}
    <h2>{newIn ? `New principle in ${setLabel(s.sets.find((x) => x.path === `principles/${newIn}/_set.md`)!.fm)}` : 'Edit principle'}</h2>
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
      <button type="submit" disabled={busy || !title.trim()} data-testid="edit-save">{newIn ? 'Add principle' : 'Save'}</button>
    </form>
  {:else if kind === 'notes'}
    <h2>Notes on {slugOfSource(path)}</h2>
    <p class="hint">Marginalia, corrections, and context. Saving makes this file yours ({(file!.fm as NotesFm).curated === 'human' ? 'it already is' : `it is ${(file!.fm as NotesFm).curated} now`}).</p>
    <form onsubmit={(e) => { e.preventDefault(); void save(); }}>
      <label>Notes <textarea bind:value={body} rows="12" data-testid="edit-body"></textarea></label>
      <button type="submit" disabled={busy} data-testid="edit-save">Save</button>
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
      <button type="submit" disabled={busy || !title.trim()} data-testid="edit-save">Save</button>
    </form>
    <h3>Passage (read-only)</h3>
    <pre class="passage" data-testid="passage-readonly">{(file as BrainFile<SourceFm>).body}</pre>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
{/if}

<style>
  form { display: grid; gap: 0.75rem; }
  label { display: grid; gap: 0.3rem; }
  input, textarea, select { font: inherit; padding: 0.4rem; width: 100%; box-sizing: border-box; }
  .row { display: flex; gap: 0.5rem; }
  .grounds { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; }
  .chip { background: rgba(127, 127, 127, 0.15); border-radius: 1rem; padding: 0.15rem 0.6rem; }
  .chip button { border: none; background: none; cursor: pointer; }
  .drift { border: 1px solid #b45309; border-radius: 0.5rem; padding: 0.5rem 0.75rem; }
  .passage { white-space: pre-wrap; background: rgba(127, 127, 127, 0.1); padding: 0.75rem; border-radius: 0.5rem; }
  .hint { opacity: 0.7; }
  .error { color: #b91c1c; }
  small { opacity: 0.7; font-weight: normal; }
  .from { border-left: 3px solid #b45309; padding: 0.25rem 0.75rem; margin-bottom: 1rem; }
  .from p { margin: 0.25rem 0; }
  .rationale { white-space: pre-wrap; }
</style>
