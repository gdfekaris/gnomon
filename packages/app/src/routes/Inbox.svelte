<script lang="ts">
  // Inbox — US-2, US-3; proposal §6, §9 decision 3. Unfiled captures,
  // "process inbox with AI", recent filings from history, the review view
  // from compare, ratify and reject.
  import { hold } from '../lib/press';
  import { type FilingReview } from '@gnomon/core';
  import type { ModelInfo } from '@gnomon/providers';
  import MarkdownView from '../lib/components/MarkdownView.svelte';
  import { browseHref, linkLabel } from '../lib/markdown';
  import ConnectionNotice from '../lib/components/ConnectionNotice.svelte';
  import { brain, describeError } from '../lib/services/index';
  import { type FilingEntry, loadFilings, processInbox, ratify, reject, reviewOf, unfiledCaptures } from '../lib/services/inbox';
  import { ReasoningService } from '../lib/services/reasoning';
  import { inbox } from '../lib/stores/inbox.svelte';
  import { configureReasoner, reasoner, reasoning } from '../lib/stores/reasoning.svelte';
  import { session } from '../lib/stores/session.svelte';
  import { settings } from '../lib/stores/settings.svelte';
  import { snapshot } from '../lib/stores/snapshot.svelte';

  // `filing`: a slug to show open on arrival (`#/inbox?filing=<slug>`), which is how the editor returns
  // to the filing whose row sent it; a filing that is no longer pending is collapsed otherwise.
  let { filing = undefined }: { filing?: string | undefined } = $props();
  const s = $derived(snapshot.current);
  const captures = $derived(s ? unfiledCaptures(s) : []);
  const PROVIDER_LABELS: Record<string, string> = { mock: 'Demo model (no key)', anthropic: 'Anthropic', openrouter: 'OpenRouter' };
  let models = $state<ModelInfo[]>([]);
  let model = $state<ModelInfo | null>(null);
  let modelsFor = $state<string | null>(null);
  // A filing changes exactly two fields on its capture (schema §7.6 step 6). When the added lines are those two,
  // the panel says so in the app's words; anything else shows as the raw lines, so an oddity is visible.
  const filedAs = (lines: string[]): string | null => {
    const m = lines.map((l) => /^(status|filed_as): (.+)$/.exec(l));
    return lines.length === 2 && m[0]?.[1] === 'status' && m[0][2] === 'filed' && m[1]?.[1] === 'filed_as' ? m[1][2]! : null;
  };
  // A filing awaiting review is shown open, Ratify and Reject in view: looking at it is why it is listed.
  // Decided ones are collapsed; "Show files" opens the same panel for the record.
  let open = $state<string | null>(null);
  let openedFor = $state<string | null>(null);
  $effect(() => {
    if (!filing || openedFor === filing) return;
    const f = inbox.filings.find((x) => x.slug === filing);
    if (!f) return;
    openedFor = filing;
    open = f.sha;
    requestAnimationFrame(() => document.querySelector(`[data-testid="filing-${filing}"]`)?.scrollIntoView({ block: 'start' }));
  });
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  let conflict = $state<{ sha: string; paths: string[] } | null>(null);
  let loadedHead = $state<string | null>(null);

  $effect(() => { configureReasoner(); void settings.anthropicKey; void settings.openrouterKey; });
  $effect(() => {
    const provider = reasoning.provider;
    if (modelsFor === provider) return;
    modelsFor = provider;
    models = [];
    model = null;
    reasoner.listModels(provider).then((m) => { if (modelsFor === provider) { models = m; model = m[0] ?? null; } }, (e: unknown) => (error = describeError(e)));
  });
  $effect(() => {
    const head = s?.head ?? null;
    if (!session.driver || !head || loadedHead === head) return;
    loadedHead = head;
    void loadFilings(inbox, brain, session.driver);
  });

  async function process() {
    if (!session.driver || !model) return;
    busy = 'process';
    error = null;
    try {
      await processInbox(inbox, brain, session.driver, reasoner.driver(reasoning.provider), model, ReasoningService.budget(model, settings.prefs.budgetPercent));
      await loadFilings(inbox, brain, session.driver);
    } catch (e) {
      error = describeError(e);
    } finally {
      busy = null;
    }
  }
  const isOpen = (f: FilingEntry) => f.state === 'pending' || open === f.sha;
  // The editor comes back to this filing, open, whether it is still awaiting review or is now yours.
  const editHref = (path: string, slug: string) => `#/edit/${path}?back=${encodeURIComponent(`#/inbox?filing=${slug}`)}`;
  const reviewFor = (f: FilingEntry): FilingReview | null => (isOpen(f) && s ? reviewOf(brain, f.changes) : null);
  // Which filing an error belongs to: the message is shown under that filing's buttons, where the tap was,
  // not at the foot of the page where a phone never sees it.
  let acting = $state<'ratify' | 'reject' | null>(null);
  let failedOn = $state<string | null>(null);
  async function doRatify(f: FilingEntry) {
    if (!session.driver) return;
    busy = f.sha;
    acting = 'ratify';
    error = null;
    failedOn = null;
    try { await ratify(inbox, brain, session.driver, f); open = null; } catch (e) { error = describeError(e); failedOn = f.sha; } finally { busy = null; acting = null; }
  }
  async function doReject(f: FilingEntry) {
    if (!session.driver) return;
    busy = f.sha;
    acting = 'reject';
    error = null;
    failedOn = null;
    conflict = null;
    try {
      const r = await reject(inbox, brain, session.driver, f);
      if (r.conflict) conflict = { sha: f.sha, paths: r.conflict };
      else open = null;
    } catch (e) { error = describeError(e); failedOn = f.sha; } finally { busy = null; acting = null; }
  }
  // The schema's ladder in four words: the model's, the model's as you approved it, yours, gone.
  const STATE_LABEL: Record<string, string> = { pending: 'awaiting review', ratified: 'ratified', rejected: 'rejected', yours: 'yours' };
  // A rejected filing is already gone from the brain (the revert removed its files and the capture is unfiled
  // again); only its commit remains in history. The list leaves those out unless asked.
  let showRejected = $state(false);
  const rejectedCount = $derived(inbox.filings.filter((f) => f.state === 'rejected').length);
  // Ratified filings are done; the newest few stay in view and the rest are a tap away. History is newest first.
  const RECENT_RATIFIED = 5;
  let allRatified = $state(false);
  const ratifiedCount = $derived(inbox.filings.filter((f) => f.state === 'ratified').length);
  const shown = $derived.by(() => {
    let ratifiedSeen = 0;
    return inbox.filings.filter((f) => {
      if (f.state === 'rejected') return showRejected;
      if (f.state === 'ratified') return allRatified || ratifiedSeen++ < RECENT_RATIFIED;
      return true;
    });
  });
</script>

<h2>Inbox</h2>
{#if !s}
  <ConnectionNotice />
{:else}
  <section>
    <h3>Unfiled captures</h3>
    <ul data-testid="unfiled">
      {#each captures as c (c.path)}
        <li><a href={browseHref(c.path)}><code>{c.path.slice('inbox/'.length, -3)}</code></a>{#if c.fm.attachment}{' · attachment'}{/if}{#if c.fm.note}{` — ${c.fm.note}`}{/if}</li>
      {:else}
        <li class="empty">Nothing waiting.</li>
      {/each}
    </ul>
    <div class="row">
      <label>Provider
        <select bind:value={reasoning.provider} data-testid="inbox-provider">
          {#each reasoning.providers as id (id)}<option value={id}>{PROVIDER_LABELS[id]}</option>{/each}
        </select>
      </label>
      <label>Model
        <select bind:value={model} disabled={!models.length} data-testid="inbox-model">
          {#each models as m (m.id)}<option value={m}>{m.label}</option>{/each}
        </select>
      </label>
      <button class="primary" onclick={process} disabled={busy !== null || !captures.length || !model} use:hold={busy === 'process'} data-testid="process">{busy === 'process' ? 'Processing…' : 'Process inbox with AI'}</button>
    </div>
    {#if inbox.processing}<p class="queued" role="status">Filing {inbox.processing.done + 1} of {inbox.processing.total}…</p>{/if}
    {#if inbox.results.length}
      <ul data-testid="process-results">
        {#each inbox.results as r (r.path)}
          <li>
            <code>{r.path.slice('inbox/'.length, -3)}</code>:
            {#if r.slug}filed as <a href={browseHref(`sources/${r.slug}/raw.md`)}>{r.slug}</a> with {r.proposals} proposal{r.proposals === 1 ? '' : 's'}; review it below.{:else}<span class="error">not filed — {r.error}</span>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section>
    <h3>Recent filings</h3>
    {#if inbox.loading && !inbox.filings.length}<p>Loading…</p>{/if}
    {#if rejectedCount || ratifiedCount > RECENT_RATIFIED}
      <p class="hint">
        {#if ratifiedCount > RECENT_RATIFIED}
          <button type="button" class="link" onclick={() => (allRatified = !allRatified)} data-testid="toggle-ratified">
            {allRatified ? `Show only the ${RECENT_RATIFIED} newest ratified` : `Show all ${ratifiedCount} ratified`}
          </button>
        {/if}
        {#if rejectedCount}
          <button type="button" class="link" onclick={() => (showRejected = !showRejected)} data-testid="toggle-rejected">
            {showRejected ? 'Hide' : 'Show'} {rejectedCount} rejected
          </button>
        {/if}
      </p>
    {/if}
    <ul class="filings" data-testid="filings">
      {#each shown as f (f.sha)}
        {@const review = reviewFor(f)}
        <li data-testid="filing-{f.slug}">
          <div class="head">
            <span><strong>{f.slug}</strong> <small>· {f.date.slice(0, 10)} · <span class="state {f.state}" data-testid="state">{STATE_LABEL[f.state]}</span></small></span>
            {#if f.state !== 'pending'}
              <button onclick={() => (open = open === f.sha ? null : f.sha)} data-testid="show-files">{open === f.sha ? 'Hide files' : 'Show files'}</button>
            {/if}
          </div>
          {#if review}
            <div class="review" data-testid="review-panel">
              {#each review.added as file (file.path)}
                <article class="added">
                  <h4><a href={browseHref(file.path)}>{linkLabel(file.path, s)}</a> <small><code>{file.path}</code> · new</small></h4>
                  {#if f.state === 'pending' && file.path.endsWith('/raw.md')}
                    <p class="edit"><a href={editHref(file.path, f.slug)} data-testid="edit-source">Edit metadata</a> <small>· the passage text is immutable; an edit makes this source yours</small></p>
                  {:else if f.state === 'pending' && file.path.endsWith('/notes.md')}
                    <p class="edit"><a href={editHref(file.path, f.slug)} data-testid="edit-notes">Edit</a> <small>· an edit makes the notes yours</small></p>
                  {/if}
                  {#if file.body}<MarkdownView body={file.body} path={file.path} />{:else}<p class="empty">(empty body)</p>{/if}
                </article>
              {/each}
              {#each review.attachments as a (a.path)}
                <p class="attachment"><a href={browseHref(a.path)}>{a.path.slice(a.path.lastIndexOf('/') + 1)}</a> <small>· attachment · {(a.size / 1024).toFixed(1)} KB · new</small></p>
              {/each}
              {#if review.capture}
                {@const slug = filedAs(review.capture.addedLines)}
                <article>
                  <h4>Capture <a href={browseHref(review.capture.path)}><code>{review.capture.path.slice('inbox/'.length, -3)}</code></a> <small>· modified</small></h4>
                  {#if slug}
                    <p data-testid="capture-filed">Now filed as <a href={browseHref(`sources/${slug}/raw.md`)}>{slug}</a>.</p>
                  {:else}
                    <pre class="plus" data-testid="capture-lines">{review.capture.addedLines.map((l) => `+ ${l}`).join('\n')}</pre>
                  {/if}
                </article>
              {/if}
              {#if f.state === 'pending'}
                <div class="row">
                  <button class="primary" onclick={() => doRatify(f)} disabled={busy !== null} use:hold={busy === f.sha && acting === 'ratify'} data-testid="ratify">Ratify</button>
                  <button onclick={() => doReject(f)} disabled={busy !== null} use:hold={busy === f.sha && acting === 'reject'} data-testid="reject">Reject</button>
                  {#if busy === f.sha}<span role="status" class="hint" data-testid="deciding">{acting === 'ratify' ? 'Ratifying…' : 'Rejecting…'} one commit, then the list reloads.</span>{/if}
                </div>
              {:else if f.state === 'ratified'}
                <p class="hint" data-testid="ratified-note">Ratified. Its source is part of the brain now; the notes and details can be edited from Browse.</p>
              {:else if f.state === 'yours'}
                <p class="hint" data-testid="yours-note">Yours. You modified it manually, which is a stronger approval than ratifying an agent's modifications.</p>
              {/if}
              {#if error && failedOn === f.sha}
                <p class="error" role="alert" data-testid="decide-error">{error}</p>
              {/if}
              {#if conflict?.sha === f.sha}
                <p class="error" role="alert" data-testid="conflict">
                  Later commits built on this filing, so it cannot be reverted. Handle these by hand (edit or delete, then re-file if needed):
                  {#each conflict.paths as p (p)}<code>{p}</code> {/each}
                </p>
              {/if}
            </div>
          {/if}
        </li>
      {:else}
        <li class="empty">{rejectedCount ? 'Nothing awaiting review.' : 'No filings yet. Filing a capture with AI makes the first one; it waits here for your review.'}</li>
      {/each}
    </ul>
  </section>
  {#if (error && !failedOn) || inbox.error}<p class="error" role="alert">{(failedOn ? null : error) ?? inbox.error}</p>{/if}
{/if}

<style>
  section { margin-bottom: 1.5rem; }
  .row { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: end; margin-top: 0.5rem; }
  .row label { display: grid; gap: 0.25rem; }
  .filings { list-style: none; padding: 0; }
  .filings > li { border: var(--bw) solid var(--edge); box-shadow: var(--raise); padding: 0.6rem 0.75rem; margin-bottom: 0.5rem; }
  .head { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
  .review { margin-top: 0.75rem; display: grid; gap: 0.75rem; border-top: var(--bw, 1px) solid var(--edge); padding-top: 0.75rem; }
  .added h4, article h4 { margin: 0 0 0.25rem; }
  .added .edit { margin: 0 0 0.5rem; }
  .attachment { margin: 0; }
  ul[data-testid='unfiled'] { padding-left: 0.25rem; list-style: none; }
</style>
