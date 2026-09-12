<script lang="ts">
  // Reason — US-8, US-9, US-10, US-19; proposal §6. Set picker chips, task
  // presets, provider and model picker, the budget bar from assemble
  // before sending, a streaming transcript, and citations as links.
  import { hold } from '../lib/press';
  import { type Task, setLabel } from '@gnomon/core';
  import { renderAnswer } from '../lib/markdown';
  import { brain } from '../lib/services/index';
  import { taskLabel, describeAssemblyError } from '../lib/services/reasoning';
  import { extractProposal } from '../lib/services/proposals';
  import ProposalForm from '../lib/components/ProposalForm.svelte';
  import { configureReasoner, reasoner, reasoning } from '../lib/stores/reasoning.svelte';
  import { savePrefs, settings } from '../lib/stores/settings.svelte';
  import ConnectionNotice from '../lib/components/ConnectionNotice.svelte';
  import { describeError } from '../lib/services/index';
  import { snapshot } from '../lib/stores/snapshot.svelte';

  const s = $derived(snapshot.current);
  const TASKS: Task[] = ['reason', 'relate', 'compare', 'free'];
  const PROVIDER_LABELS: Record<string, string> = { mock: 'Demo model (no key)', anthropic: 'Anthropic', openrouter: 'OpenRouter' };
  let selected = $state<string[]>([]);
  let modelsFor = $state<string | null>(null);
  let modelError = $state<string | null>(null);
  let seeded = $state(false);
  // Save as proposal (block 5): which answer's form is open, and what each saved as.
  let proposalOpen = $state<number | null>(null);
  let savedProposals = $state<Record<number, string>>({});

  // Last selection remembered per device (US-8); default to every set on first use.
  $effect(() => {
    if (!s || seeded) return;
    const slugs = s.sets.map((f) => f.path.split('/')[1]!);
    const remembered = settings.prefs.lastSelectedSets.filter((x) => slugs.includes(x));
    selected = remembered.length ? remembered : slugs;
    seeded = true;
  });
  $effect(() => {
    configureReasoner();
    void settings.anthropicKey;
    void settings.openrouterKey;
  });
  // Models for the chosen provider.
  $effect(() => {
    const provider = reasoning.provider;
    if (modelsFor === provider) return;
    modelsFor = provider;
    modelError = null;
    reasoning.models = [];
    reasoning.model = null;
    reasoner.listModels(provider).then(
      (models) => { if (modelsFor === provider) { reasoning.models = models; reasoning.model = models[0] ?? null; } },
      (e: unknown) => { if (modelsFor === provider) modelError = describeError(e); },
    );
  });
  // The budget bar: preview on every change of inputs, before anything is sent.
  $effect(() => {
    if (!s || !reasoning.model) { reasoning.preview = null; return; }
    reasoner.preview(s, reasoning.task, selected, reasoning.input, reasoning.model, settings.prefs.budgetPercent, settings.prefs.setDescriptionPlacement);
  });

  const preview = $derived(reasoning.preview);
  const budget = $derived(reasoning.model ? Math.floor((reasoning.model.contextWindow * settings.prefs.budgetPercent) / 100) : 0);
  const used = $derived(preview?.ok ? preview.tokensUsed : preview ? (preview.error === 'SETS_EXCEED_BUDGET' ? preview.neededTokens : budget) : 0);
  const fill = $derived(budget ? Math.min(100, Math.round((used / budget) * 100)) : 0);
  const canSend = $derived(!!s && !!reasoning.model && !reasoning.streaming && selected.length > 0 && !!preview?.ok && (reasoning.task === 'compare' || reasoning.input.trim() !== ''));

  function toggle(slug: string) {
    selected = selected.includes(slug) ? selected.filter((x) => x !== slug) : [...selected, slug];
    void savePrefs({ lastSelectedSets: selected });
  }
  async function send() {
    if (!s || !reasoning.model) return;
    const input = reasoning.input;
    reasoning.input = '';
    await reasoner.run(s, reasoning.provider, reasoning.model, reasoning.task, selected, input, settings.prefs.budgetPercent, settings.prefs.setDescriptionPlacement);
    void brain;
  }
</script>

<h2>Reason</h2>
{#if !s}
  <ConnectionNotice />
{:else if !s.byType('principle').length}
  <p class="empty" data-testid="empty-reason">
    Nothing to reason from yet: your sets have no principles, and reasoning without premises would make the answer the
    model's, not yours. <a href="#/capture">Capture</a> a passage, file it from the Inbox, ratify the filing, then accept
    a proposal or <a href="#/sets">write a principle</a> yourself.
  </p>
{:else}
  <section class="picker">
    <div class="chips" data-testid="set-picker">
      {#each s.sets as set (set.path)}
        {@const slug = set.path.split('/')[1]!}
        <button type="button" class="chip" class:on={selected.includes(slug)} aria-pressed={selected.includes(slug)} onclick={() => toggle(slug)} data-testid="chip-{slug}">{setLabel(set.fm)}</button>
      {/each}
    </div>
    <div class="row">
      <label>Task
        <select bind:value={reasoning.task} data-testid="task">
          {#each TASKS as t (t)}<option value={t}>{taskLabel(t)}</option>{/each}
        </select>
      </label>
      <label>Provider
        <select bind:value={reasoning.provider} data-testid="provider">
          {#each reasoning.providers as id (id)}<option value={id}>{PROVIDER_LABELS[id]}</option>{/each}
        </select>
      </label>
      <label>Model
        <select bind:value={reasoning.model} data-testid="model" disabled={!reasoning.models.length}>
          {#each reasoning.models as m (m.id)}<option value={m}>{m.label}</option>{/each}
        </select>
      </label>
    </div>
    {#if modelError}<p class="error" role="alert">Could not list models: {modelError}</p>{/if}
    {#if reasoning.task !== 'compare'}
      <label>{reasoning.task === 'relate' ? 'New text' : reasoning.task === 'free' ? 'Message' : 'Question'}
        <textarea bind:value={reasoning.input} rows={reasoning.task === 'relate' ? 6 : 3} data-testid="input" placeholder={reasoning.task === 'relate' ? 'Paste the text to relate to the selected sets.' : 'What should the principles be applied to?'}></textarea>
      </label>
    {/if}
    <div class="budget" data-testid="budget">
      <div class="bar"><div class="fill" class:over={!!preview && !preview.ok} style="width: {fill}%"></div></div>
      {#if !selected.length}
        <p class="hint">Select at least one set.</p>
      {:else if preview?.ok}
        <p class="hint" data-testid="budget-note">{preview.included.filter((r) => r.startsWith('principles/')).length} principles and {preview.included.filter((r) => r.startsWith('sources/')).length} of {preview.included.filter((r) => r.startsWith('sources/')).length + preview.excluded.length} grounding passages fit the budget{preview.excluded.length ? `; ${preview.excluded.length} named but not sent` : ''}.</p>
      {:else if preview}
        <p class="error" data-testid="budget-note">{describeAssemblyError(preview)}</p>
      {/if}
    </div>
    <div class="row">
      <button class="primary" onclick={send} disabled={!canSend} use:hold={reasoning.streaming} data-testid="send">{reasoning.streaming ? 'Sending…' : 'Send'}</button>
      {#if reasoning.streaming}<button onclick={() => reasoner.stop()} data-testid="stop">Stop</button>{/if}
      {#if reasoning.transcript.length}<button class="quiet" onclick={() => reasoner.clear()} disabled={reasoning.streaming}>Clear</button>{/if}
    </div>
    {#if reasoning.error}<p class="error" role="alert">{reasoning.error}</p>{/if}
  </section>

  <section class="transcript" data-testid="transcript">
    {#each reasoning.transcript as turn, i (i)}
      <article class={turn.role} data-testid="turn-{turn.role}">
        {#if turn.role === 'user'}
          <p class="meta">{taskLabel(turn.task)} · {turn.sets.map((slug) => setLabel(s.sets.find((f) => f.path === `principles/${slug}/_set.md`)?.fm ?? { type: 'principle-set', order: 0, curated: 'human', created: '', updated: '' })).join(', ')}</p>
          <p class="text">{turn.text}</p>
        {:else}
          <div class="markdown answer">{@html renderAnswer(turn.text, s)}</div>
          {#if !reasoning.streaming || i < reasoning.transcript.length - 1}
            {#if turn.citations.length}
              <p class="meta">{turn.citations.filter((c) => c.resolved).length} citation{turn.citations.filter((c) => c.resolved).length === 1 ? '' : 's'}{turn.citations.some((c) => !c.resolved) ? `, ${turn.citations.filter((c) => !c.resolved).length} not in this brain` : ''}</p>
            {/if}
            {#if turn.task === 'relate'}
              {@const draft = extractProposal(turn.text, turn.sets, turn.citations)}
              {#if savedProposals[i]}
                <p class="ok" role="status" data-testid="proposal-saved">Saved as <code>{savedProposals[i]}</code>, open and yours. <a href="#/proposals">Open Proposals</a></p>
              {:else if draft && proposalOpen === i}
                <ProposalForm {draft} onsaved={(id) => { savedProposals = { ...savedProposals, [i]: id }; proposalOpen = null; }} oncancel={() => (proposalOpen = null)} />
              {:else if draft}
                <p class="row"><button onclick={() => (proposalOpen = i)} data-testid="save-proposal">Save as proposal</button> <span class="hint">{draft.kind} for {draft.target_set}: “{draft.title}”</span></p>
              {/if}
            {/if}
          {/if}
        {/if}
      </article>
    {/each}
  </section>
{/if}

<style>
  .empty { font-size: var(--fs); }
  .picker { display: grid; gap: 0.75rem; margin-bottom: 1rem; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .row { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: end; }
  .row label { display: grid; gap: 0.25rem; flex: 1 1 8rem; }
  .transcript article { padding: 0.5rem 0.75rem; margin-bottom: 0.75rem; }
  .transcript .user { background: var(--pattern); padding: 2px; }
  .transcript .user > * { background: var(--paper); padding: 6px 10px; }
  .transcript .assistant { border: var(--bw) solid var(--edge); box-shadow: var(--raise); }
  .meta { margin: 0 0 0.25rem; }
  .text { white-space: pre-wrap; margin: 0; }
  .hint { margin: 0.25rem 0 0; }
  .error { margin: 0.25rem 0 0; }
  .answer :global(code) { padding: 0 0.15rem; }
</style>
