<script lang="ts">
  // Settings — proposal §6: git connection, AI providers, context budget,
  // privacy disclosure, theme; connect-existing validation (US-15). The
  // encryption toggle is Phase 4 and the token walkthrough is Phase 3.
  import pkg from '../../package.json';
  import { connectDemo, connectGitHub, describeError, disconnect } from '../lib/services/index';
  import ValidationPanel from '../lib/components/ValidationPanel.svelte';
  import { route } from '../lib/router.svelte';
  import { session } from '../lib/stores/session.svelte';
  import { settings, saveGit, savePrefs, saveProviderKeys } from '../lib/stores/settings.svelte';
  import { snapshot } from '../lib/stores/snapshot.svelte';
  import { applyUpdate, checkForUpdate, pwa } from '../lib/stores/pwa.svelte';

  // Diagnostics for the live human test: what the device kept and how the app is running.
  const standalone = typeof matchMedia !== 'undefined' && (matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);
  let swState = $state('unsupported');
  $effect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    swState = navigator.serviceWorker.controller ? 'active' : 'not controlling this page';
  });

  let owner = $state(settings.git?.owner ?? '');
  let name = $state(settings.git?.name ?? '');
  let token = $state(settings.git?.token ?? '');
  let anthropic = $state(settings.anthropicKey);
  let openrouter = $state(settings.openrouterKey);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let savedKeys = $state(false);
  // On-device settings load after launch; pick them up once they arrive.
  $effect(() => {
    if (!settings.loaded) return;
    owner = settings.git?.owner ?? '';
    name = settings.git?.name ?? '';
    token = settings.git?.token ?? '';
    anthropic = settings.anthropicKey;
    openrouter = settings.openrouterKey;
  });

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
  const useDemo = () => run(() => connectDemo((route.query.get('demo-omit') ?? '').split(',').filter(Boolean)));
  const useGitHub = () => run(async () => {
    const git = { owner: owner.trim(), name: name.trim(), token: token.trim() };
    await saveGit(git);
    await connectGitHub(git);
  });
  const signOut = () => run(async () => {
    disconnect();
    await saveGit(null);
    token = '';
  });
  const saveKeys = () => run(async () => {
    await saveProviderKeys({ anthropic: anthropic.trim(), openrouter: openrouter.trim() });
    savedKeys = true;
  });
</script>

<h2>Settings</h2>

<section>
  <h3>Brain</h3>
  {#if session.driver}
    <p>Connected: <strong>{session.label}</strong> ({session.mode}).</p>
    <ValidationPanel />
    <button onclick={signOut} disabled={busy}>Disconnect</button>
  {:else}
    <p>Not connected. <a href="#/onboarding">Set up or connect a brain</a>.</p>
  {/if}
</section>

<section>
  <h3>Demo brain</h3>
  <p>A small brain that lives only in this tab. Nothing you do to it is saved.</p>
  <button onclick={useDemo} disabled={busy} data-testid="use-demo">Use the demo brain</button>
</section>

<section>
  <h3>GitHub repository</h3>
  <label>Owner <input bind:value={owner} autocapitalize="off" autocomplete="off" data-testid="git-owner" /></label>
  <label>Repository <input bind:value={name} autocapitalize="off" autocomplete="off" data-testid="git-name" /></label>
  <label>Fine-grained token <input bind:value={token} type="password" autocomplete="off" data-testid="git-token" /></label>
  <button class="primary" onclick={useGitHub} disabled={busy || !owner || !name || !token}>Connect</button>
  <p class="hint">A fine-grained token with Contents read and write on the one repository. Stored only on this device.</p>
</section>

<section>
  <h3>AI providers</h3>
  <label>Anthropic API key <input bind:value={anthropic} type="password" autocomplete="off" data-testid="key-anthropic" /></label>
  <label>OpenRouter API key <input bind:value={openrouter} type="password" autocomplete="off" data-testid="key-openrouter" /></label>
  <button onclick={saveKeys} disabled={busy} data-testid="save-keys">Save keys</button>
  {#if savedKeys}<span class="hint">Saved on this device.</span>{/if}
  <p class="hint">Used by the Reason screen (Phase 2). Keys never leave this device except to the provider you chose.</p>
</section>

<section>
  <h3>Reasoning</h3>
  <label>
    Context budget: {settings.prefs.budgetPercent}% of the model's window
    <input type="range" min="10" max="90" step="5" value={settings.prefs.budgetPercent} oninput={(e) => savePrefs({ budgetPercent: Number((e.currentTarget as HTMLInputElement).value) })} data-testid="budget" />
  </label>
  <label>
    Set description goes in
    <select value={settings.prefs.setDescriptionPlacement} onchange={(e) => savePrefs({ setDescriptionPlacement: (e.currentTarget as HTMLSelectElement).value as 'context' | 'system' })} data-testid="placement">
      <option value="context">the conversation, as context</option>
      <option value="system">the system prompt, as instruction</option>
    </select>
  </label>
</section>

<section>
  <h3>Appearance</h3>
  <label>
    Skin
    <select value={settings.prefs.skin} onchange={(e) => savePrefs({ skin: (e.currentTarget as HTMLSelectElement).value as 'mono' | 'bevel' | 'workbench' })} data-testid="skin">
      <option value="mono">Monochrome (default)</option>
      <option value="bevel">Gray bevel</option>
      <option value="workbench">Four-color workbench</option>
    </select>
  </label>
  <label>
    Theme
    <select value={settings.prefs.theme} onchange={(e) => savePrefs({ theme: (e.currentTarget as HTMLSelectElement).value as 'system' | 'light' | 'dark' })} data-testid="theme">
      <option value="system">Follow the system</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </label>
</section>

<section>
  <h3>Install</h3>
  <p class="hint">
    On iPhone, open this page in Safari, tap Share, then <strong>Add to Home Screen</strong>. On Android and desktop
    Chrome, use the browser's Install option. Installed, Gnomon opens straight to Capture.
  </p>
</section>

<section>
  <h3>Who can see what</h3>
  <p>
    Your brain is a private repository on GitHub; GitHub holds the files and can technically read them.
    When you reason, the AI provider you picked receives the principle sets you selected and as many of their
    grounding passages as fit the budget, never attachments and never the whole brain. Nobody else sees anything:
    this app has no server. Client-side encryption of passage text arrives in a later release.
  </p>
</section>

<section class="about">
  <p class="hint">
    Gnomon {pkg.version}, build <span data-testid="build">{__GNOMON_BUILD__}</span>.
    {#if pwa.needRefresh}
      A newer build is ready: <button type="button" class="small primary" onclick={applyUpdate} data-testid="update-now">Update now</button>
    {:else}
      <button type="button" class="small" onclick={checkForUpdate} disabled={pwa.checking} data-testid="check-update">{pwa.checking ? 'Checking…' : 'Check for updates'}</button>
      {#if pwa.lastCheck === 'current'}This is the latest.{:else if pwa.lastCheck === 'failed'}Could not check; you may be offline.{/if}
    {/if}
  </p>
  <ul class="hint diagnostics" data-testid="diagnostics">
    <li>Running {standalone ? 'installed, from the Home Screen' : 'in the browser'}.</li>
    <li>
      Settings at launch came from {settings.storage.source === 'indexeddb' ? 'IndexedDB' : settings.storage.source === 'mirror' ? 'the localStorage mirror' : 'nowhere (nothing was saved)'};
      storage {settings.storage.persistent === null ? 'persistence unknown' : settings.storage.persistent ? 'marked persistent' : 'not marked persistent'}.
      {#if settings.storage.error}Last storage failure: {settings.storage.error}{/if}
    </li>
    <li>
      Brain: {#if session.driver}{session.label}, {snapshot.current ? `at ${snapshot.current.head.slice(0, 7)}` : 'no snapshot'}{#if snapshot.error}, last load failed: {snapshot.error}{/if}{:else}none connected{/if}.
    </li>
    <li>Service worker {swState}.</li>
  </ul>
</section>

{#if error}<p class="error" role="alert">{error}</p>{/if}

<style>
  section { margin-bottom: 1.75rem; }
  label { margin: 0.5rem 0; }
  input:not([type='range']), select { max-width: 24rem; margin-top: 0.25rem; }
  input[type='range'] { max-width: 24rem; display: block; }
  .about { border-top: var(--bw, 1px) solid var(--edge); padding-top: 0.75rem; }
  .diagnostics { padding-left: 1.1rem; margin: 0.5rem 0 0; }
  .diagnostics li { margin: 0.2rem 0; overflow-wrap: anywhere; }
</style>
