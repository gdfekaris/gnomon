<script lang="ts">
  // Onboarding — spec §12 steps 1, 5, 6 and §11's iOS steps; US-14, US-15,
  // US-16. The first screen when no brain is connected. A short flow:
  // welcome → token walkthrough (classic and fine-grained differ) with the
  // create-from-template or connect-existing action → the check results →
  // who can see what → the optional swap to a single-repository token
  // (create path only) → Add to Home Screen → Capture. Block 1's service
  // does the work; this screen only asks and explains.
  import { hold } from '../lib/press';
  import { GitHubDriver } from '@gnomon/storage';
  import ValidationPanel from '../lib/components/ValidationPanel.svelte';
  import { SCAFFOLD } from '../lib/scaffold';
  import pkg from '../../package.json';
  import { connectDemo, connectGitHub, describeError } from '../lib/services/index';
  import { type TokenKind, createFromTemplate, validateToken } from '../lib/services/onboarding';
  import { session } from '../lib/stores/session.svelte';
  import { saveGit, settings } from '../lib/stores/settings.svelte';

  type Intent = 'create' | 'connect';
  type Step = 'welcome' | 'token' | 'check' | 'privacy' | 'swap' | 'install';

  let intent = $state<Intent>('create');
  let step = $state<Step>('welcome');
  let kind = $state<TokenKind>('fine-grained');
  let token = $state('');
  let owner = $state('');
  let name = $state('brain');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let warning = $state<string | null>(null);
  let created = $state<string | null>(null);
  let swapToken = $state('');
  let swapped = $state(false);

  const flow = $derived<Step[]>(intent === 'create' ? ['token', 'check', 'privacy', 'swap', 'install'] : ['token', 'check', 'privacy', 'install']);
  const position = $derived(flow.indexOf(step));

  // Spec §10.3: a device that lost its token (iOS evicts the store after a
  // week unused) re-onboards to the token step only.
  const evicted = $derived(settings.loaded && settings.prefs.mode === 'github' && !settings.git && !session.driver);
  $effect(() => {
    if (evicted && step === 'welcome') {
      intent = 'connect';
      step = 'token';
    }
  });

  const standalone = typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);
  const isIOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);

  const walkthrough = $derived.by((): string[] => {
    const go = 'On github.com, open your profile picture (top right), then Settings, then Developer settings (at the bottom of the left column), then Personal access tokens';
    if (kind === 'classic') {
      return [
        `${go}, then Tokens (classic).`,
        'Tap "Generate new token", then "Generate new token (classic)". Give it a note such as "Gnomon phone" and an expiry.',
        'Tick the box named "repo" (the whole group). Nothing else.',
        'Tap "Generate token", copy it, and paste it below. GitHub shows it only once.',
        ...(intent === 'create' ? ['A classic token reaches every repository in your account. You can swap it for a single-repository token at the end of setup.'] : []),
      ];
    }
    return [
      `${go}, then Fine-grained tokens.`,
      'Tap "Generate new token". Name it "Gnomon phone" and set an expiry; a year is fine.',
      intent === 'create'
        ? 'Under "Repository access" choose "All repositories": the brain does not exist yet, so the token cannot be limited to it. You can swap to a single-repository token at the end of setup.'
        : 'Under "Repository access" choose "Only select repositories" and pick your brain repository.',
      intent === 'create'
        ? 'Under "Permissions", then "Repository permissions", set "Administration" to "Read and write" (this lets the token create the repository) and "Contents" to "Read and write".'
        : 'Under "Permissions", then "Repository permissions", set "Contents" to "Read and write". Leave the rest; "Metadata" is added for you.',
      'Tap "Generate token", copy it, and paste it below. GitHub shows it only once.',
    ];
  });

  function start(i: Intent) {
    intent = i;
    kind = 'fine-grained';
    error = null;
    warning = null;
    step = 'token';
  }
  function next() {
    error = null;
    step = flow[position + 1] ?? 'install';
  }
  function finish() {
    location.hash = '#/capture';
  }

  async function run(action: () => Promise<void>) {
    busy = true;
    error = null;
    try {
      await action();
    } catch (e) {
      error = describeError(e);
    } finally {
      busy = false;
    }
  }

  const demo = () => run(async () => {
    await connectDemo();
    finish();
  });

  // Validate, then create or connect. The token stays in the field on every
  // failure so a second attempt is one tap away.
  const go = () => run(async () => {
    warning = null;
    const t = token.trim();
    const repoName = name.trim();
    const check = await validateToken(intent === 'connect' ? { token: t, owner: owner.trim(), name: repoName } : { token: t });
    if (!check.ok) {
      error = check.reason;
      return;
    }
    kind = check.kind;
    if (check.warning) warning = check.warning;
    if (intent === 'create') {
      const driver = new GitHubDriver({ owner: check.login, name: repoName, token: t });
      const r = await createFromTemplate(driver, repoName, SCAFFOLD);
      if (!r.ok) {
        error = r.reason;
        return;
      }
      const [o, n] = r.fullName.split('/') as [string, string];
      created = r.fullName;
      const git = { owner: o, name: n, token: t };
      await saveGit(git);
      await connectGitHub(git);
    } else {
      const git = { owner: owner.trim(), name: repoName, token: t };
      await saveGit(git);
      await connectGitHub(git);
    }
    warning = null;
    step = 'check';
  });

  // Spec §12 step 6: replace the broad token with a single-repository one.
  const swap = () => run(async () => {
    const git = settings.git;
    if (!git) return;
    const t = swapToken.trim();
    const check = await validateToken({ token: t, owner: git.owner, name: git.name });
    if (!check.ok) {
      error = check.reason;
      return;
    }
    const next = { ...git, token: t };
    await saveGit(next);
    await connectGitHub(next);
    swapped = true;
    swapToken = '';
  });
</script>

{#if step !== 'welcome'}
  <p class="progress" data-testid="onboard-step">Step {position + 1} of {flow.length}</p>
{/if}

{#if step === 'welcome'}
  <h2>Welcome to Gnomon</h2>
  <p>
    A second brain that lives in a private GitHub repository you own: plain files you can read anywhere, and that
    whichever AI you choose can reason from. This app captures into it from your phone.
  </p>
  {#if settings.storage.error && !session.driver}
    <p class="error" role="alert" data-testid="storage-error">
      This device could not read what was saved earlier ({settings.storage.error}). Settings → About shows more.
    </p>
  {/if}
  {#if session.driver}
    <p class="hint" data-testid="already-connected">
      You are connected to <strong>{session.label}</strong>. Starting over here replaces that connection on this device; the brain itself is untouched.
    </p>
  {/if}
  <p>You need a free GitHub account. If you do not have one yet, create it at github.com first, then come back.</p>
  <div class="actions">
    <button class="primary" onclick={() => start('create')} data-testid="onboard-create">Create a new brain</button>
    <button onclick={() => start('connect')} data-testid="onboard-connect">Connect an existing brain</button>
  </div>
  <p class="hint">
    Just looking? <button class="link" onclick={demo} disabled={busy} data-testid="onboard-demo">Try the demo brain</button>: a small brain that lives only in this tab.
  </p>
  <p class="hint">Gnomon {pkg.version}, build <span data-testid="build">{__GNOMON_BUILD__}</span>.
  </p>
{:else if step === 'token'}
  <h2>{intent === 'create' ? 'Create a new brain' : 'Connect your brain'}</h2>
  {#if evicted}
    <p role="status" data-testid="evicted">
      This device no longer holds your token (an iPhone clears it after a week unused). Paste a new one; your brain itself is untouched.
    </p>
  {/if}
  <p>
    Gnomon needs a <strong>personal access token</strong>: a password that only works for GitHub's API, which you can revoke
    any time. GitHub offers two kinds. Pick one and follow its steps; both work.
  </p>
  <div role="tablist" class="tabs">
    <button role="tab" aria-selected={kind === 'fine-grained'} onclick={() => (kind = 'fine-grained')}>Fine-grained token{intent === 'connect' ? ' (recommended)' : ''}</button>
    <button role="tab" aria-selected={kind === 'classic'} onclick={() => (kind = 'classic')}>Classic token{intent === 'create' ? ' (simplest)' : ''}</button>
  </div>
  <ol class="steps" data-testid="token-steps">
    {#each walkthrough as line, i (i)}
      <li>{line}</li>
    {/each}
  </ol>
  <form onsubmit={(e) => { e.preventDefault(); void go(); }}>
    {#if intent === 'create'}
      <label>
        Name for the new repository
        <input bind:value={name} autocapitalize="off" autocomplete="off" required data-testid="onboard-name" />
      </label>
      <p class="hint">Private, under your own account. Letters, digits, and hyphens.</p>
    {:else}
      <label>
        Owner <small>(your GitHub username, or the organisation)</small>
        <input bind:value={owner} autocapitalize="off" autocomplete="off" required data-testid="onboard-owner" />
      </label>
      <label>
        Repository
        <input bind:value={name} autocapitalize="off" autocomplete="off" required data-testid="onboard-name" />
      </label>
    {/if}
    <label>
      Token
      <input bind:value={token} type="password" autocomplete="off" required data-testid="onboard-token" />
    </label>
    <p class="hint">Stored only in this browser on this device. It is sent to GitHub and nowhere else.</p>
    <div class="actions">
      <button type="submit" class="primary" disabled={busy || !token.trim() || !name.trim() || (intent === 'connect' && !owner.trim())} use:hold={busy} data-testid="onboard-go">
        {busy ? 'Working…' : intent === 'create' ? 'Create my brain' : 'Connect'}
      </button>
      <button type="button" class="link" onclick={() => (step = 'welcome')} disabled={busy}>Back</button>
    </div>
  </form>
  {#if warning}<p class="warning" role="status" data-testid="onboard-warning">{warning}</p>{/if}
{:else if step === 'check'}
  {#if intent === 'create'}
    <h2>Your brain is ready</h2>
    <p data-testid="created">
      Created <strong>{created}</strong>: a private repository holding the Gnomon template. An empty inbox, Set 1 for your
      first principles, and the instructions an AI assistant follows when it works in it.
    </p>
  {:else}
    <h2>Connected</h2>
    <p>
      Connected to <strong>{session.label}</strong>. Here is what the check found. Anything missing from the scaffold can be
      added with one tap, each as its own commit; the app never rewrites your files.
    </p>
  {/if}
  <ValidationPanel />
  <div class="actions"><button onclick={next} data-testid="onboard-next">Continue</button></div>
{:else if step === 'privacy'}
  <h2>Who can see what</h2>
  <ul class="privacy">
    <li><strong>You.</strong> The brain is a private repository under your GitHub account. You can read it there, copy it, or take it elsewhere at any time.</li>
    <li>
      <strong>GitHub</strong> holds the files and can technically read them. Its current policy keeps private repositories
      out of model training, but that is a promise, not a lock. Attached files stay in the repository's history for good.
    </li>
    <li>
      <strong>The AI provider you choose</strong> sees only what a reasoning task sends it: the principle sets you select
      and as many of their grounding passages as fit the budget. Never attachments, never the whole brain. Nothing is sent
      until you add a provider key in Settings and ask.
    </li>
    <li><strong>Nobody else.</strong> Gnomon has no server. Your token and keys stay in this browser on this device.</li>
  </ul>
  <p class="hint">A later release adds client-side encryption of passage text, so that GitHub holds only ciphertext.</p>
  <div class="actions"><button onclick={next} data-testid="onboard-next">Continue</button></div>
{:else if step === 'swap'}
  <h2>Narrow the token <small>(optional)</small></h2>
  <p>
    The token you used can reach every repository in your account and create new ones. Now that <strong>{created}</strong>
    exists, you can replace it with one that reaches only this repository and can only read and write its contents.
  </p>
  <ol class="steps">
    <li>Back on github.com: Settings, Developer settings, Personal access tokens, Fine-grained tokens, "Generate new token".</li>
    <li>Under "Repository access" choose "Only select repositories" and pick <strong>{created}</strong>.</li>
    <li>Under "Repository permissions" set "Contents" to "Read and write".</li>
    <li>Generate it, copy it, paste it below. Then delete the broad token from the same page.</li>
  </ol>
  {#if swapped}
    <p class="ok" role="status" data-testid="swapped">Swapped. This device now uses the narrower token; the broad one can be deleted on GitHub.</p>
  {:else}
    <label>
      New token
      <input bind:value={swapToken} type="password" autocomplete="off" data-testid="swap-token" />
    </label>
  {/if}
  <div class="actions">
    {#if !swapped}<button onclick={swap} disabled={busy || !swapToken.trim()} use:hold={busy} data-testid="swap-go">Use this token instead</button>{/if}
    <button class={swapped ? '' : 'link'} onclick={next} disabled={busy} data-testid="onboard-next">{swapped ? 'Continue' : 'Skip for now'}</button>
  </div>
{:else if step === 'install'}
  <h2>Put it on your Home Screen</h2>
  {#if standalone}
    <p>You are already running Gnomon from the Home Screen.</p>
  {:else}
    <p>Installed, Gnomon opens straight to Capture, full screen, like any app.</p>
    <ul class="install">
      <li class:primary={isIOS}>
        <strong>iPhone or iPad</strong>, in Safari: tap the Share button (the square with an arrow pointing up), scroll down, tap
        <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
      </li>
      <li><strong>Android</strong>, in Chrome: open the menu (three dots) and tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
      <li><strong>Desktop</strong>, in Chrome or Edge: click the install icon at the right end of the address bar.</li>
    </ul>
  {/if}
  <div class="actions"><button class="primary" onclick={finish} data-testid="onboard-finish">Start capturing</button></div>
{/if}

{#if error}<p class="error" role="alert">{error}</p>{/if}

<style>
  .progress { margin: 0 0 0.5rem; }
  .tabs { display: flex; gap: 0.5rem; margin: 1rem 0 0.5rem; }
  .steps li, .privacy li, .install li { margin: 0.5rem 0; }
  .install .primary { font-weight: 600; }
  label { margin: 0.75rem 0; }
  input { max-width: 24rem; margin-top: 0.25rem; }
  .actions { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; margin: 1rem 0; }
  .actions .primary { width: 100%; }
  @media (min-width: 30rem) { .actions .primary { width: auto; } }
</style>
