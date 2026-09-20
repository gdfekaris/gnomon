<script lang="ts">
  // Settings — proposal §6: git connection, AI providers, context budget,
  // privacy disclosure, theme; connect-existing validation (US-15); the
  // encryption flows of spec §6.4 (Phase 4 block 3). The token walkthrough is onboarding.
  import { hold } from '../lib/press';
  import pkg from '../../package.json';
  import { connectDemo, connectGitHub, describeError, disconnect, encryption } from '../lib/services/index';
  import ValidationPanel from '../lib/components/ValidationPanel.svelte';
  import EncryptForm from '../lib/components/EncryptForm.svelte';
  import { DISCLOSURE, NO_WASM, wasmAvailable } from '../lib/services/encryption';
  import { route } from '../lib/router.svelte';
  import { session } from '../lib/stores/session.svelte';
  import { type Prefs, settings, saveGit, savePrefs, saveProviderKeys } from '../lib/stores/settings.svelte';
  import { snapshot } from '../lib/stores/snapshot.svelte';
  import { UPDATE_CHECK_TEXT, applyUpdate, checkForUpdate, pwa } from '../lib/stores/pwa.svelte';
  import { KDF_PRESETS, timeDerivation } from '@gnomon/core';

  // Spec §20.3: how long Argon2id takes on this device, so the default parameters can be chosen from a phone's number.
  // No WebAssembly (iOS Lockdown Mode) means no Argon2id: the line says so instead of a failed tap.
  const wasm = wasmAvailable();
  let kdf = $state<{ busy: boolean; text: string | null }>({ busy: false, text: wasm ? null : NO_WASM });
  async function measureKdf() {
    kdf = { busy: true, text: null };
    try {
      const interactive = await timeDerivation(KDF_PRESETS.interactive);
      const moderate = await timeDerivation(KDF_PRESETS.moderate);
      kdf = { busy: false, text: `interactive ${(interactive / 1000).toFixed(2)} s, moderate ${(moderate / 1000).toFixed(2)} s` };
    } catch (e) {
      kdf = { busy: false, text: `failed: ${describeError(e)}` };
    }
  }

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
  /** which control is doing the work, so it alone stays pressed */
  let pressed = $state<string | null>(null);
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

  async function run(key: string, action: () => Promise<void>) {
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
  const useDemo = () => run('demo', () => connectDemo((route.query.get('demo-omit') ?? '').split(',').filter(Boolean), Number(route.query.get('demo-fill') ?? 0) || 0, Number(route.query.get('reserve-fill') ?? 0) || 0));
  const useGitHub = () => run('connect', async () => {
    const git = { owner: owner.trim(), name: name.trim(), token: token.trim() };
    await saveGit(git);
    await connectGitHub(git);
  });
  const signOut = () => run('disconnect', async () => {
    disconnect();
    await saveGit(null);
    token = '';
  });
  const saveKeys = () => run('keys', async () => {
    await saveProviderKeys({ anthropic: anthropic.trim(), openrouter: openrouter.trim() });
    savedKeys = true;
  });

  // Encryption (spec §6.4): enable, change the passphrase, lock, forget, disable. The forms are the shared component;
  // the two one-tap flows and the confirmed disable run here.
  let enabling = $state(false);
  let rekeying = $state(false);
  let disabling = $state(false);
  let encDone = $state<string | null>(null);
  const files = (n: number) => `${n} file${n === 1 ? '' : 's'}`;
  const lockNow = () => run('enc-lock', async () => { encryption.lock(); encDone = null; });
  const forget = () => run('enc-forget', async () => { await encryption.forget(); encDone = null; });
  const doDisable = () => run('enc-disable', async () => {
    const n = await encryption.disable();
    disabling = false;
    encDone = `Encryption is off: ${files(n)} rewritten as plaintext, and the passphrase forgotten on this device.`;
  });
</script>

<h2>Settings</h2>

<section>
  <h3>Brain</h3>
  {#if session.driver}
    <p>Connected: <strong>{session.label}</strong> ({session.mode}).</p>
    <ValidationPanel />
    <button onclick={signOut} disabled={busy} use:hold={pressed === 'disconnect'}>Disconnect</button>
  {:else}
    <p>Not connected. <a href="#/onboarding">Set up or connect a brain</a>.</p>
  {/if}
</section>

<section>
  <h3>Demo brain</h3>
  <p>A small brain that lives only in this tab. Nothing you do to it is saved.</p>
  <button onclick={useDemo} disabled={busy} use:hold={pressed === 'demo'} data-testid="use-demo">Use the demo brain</button>
</section>

<section>
  <h3>GitHub repository</h3>
  <label>Owner <input bind:value={owner} autocapitalize="off" autocomplete="off" data-testid="git-owner" /></label>
  <label>Repository <input bind:value={name} autocapitalize="off" autocomplete="off" data-testid="git-name" /></label>
  <label>Fine-grained token <input bind:value={token} type="password" autocomplete="off" data-testid="git-token" /></label>
  <button class="primary" onclick={useGitHub} disabled={busy || !owner || !name || !token} use:hold={pressed === 'connect'}>{pressed === 'connect' ? 'Connecting…' : 'Connect'}</button>
  <p class="hint">A fine-grained token with Contents read and write on the one repository. Stored only on this device.</p>
</section>

<section>
  <h3>AI providers</h3>
  <label>Anthropic API key <input bind:value={anthropic} type="password" autocomplete="off" data-testid="key-anthropic" /></label>
  <label>OpenRouter API key <input bind:value={openrouter} type="password" autocomplete="off" data-testid="key-openrouter" /></label>
  <button onclick={saveKeys} disabled={busy} use:hold={pressed === 'keys'} data-testid="save-keys">Save keys</button>
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
    Look
    <select value={`${settings.prefs.skin}:${settings.prefs.theme}`} onchange={(e) => { const [skin, theme] = (e.currentTarget as HTMLSelectElement).value.split(':') as [Prefs['skin'], Prefs['theme']]; void savePrefs({ skin, theme }); }} data-testid="look">
      <option value="mono:dark">Monochrome, dark (default)</option>
      <option value="mono:light">Monochrome, light</option>
      <option value="bevel:dark">Gray bevel, dark</option>
      <option value="bevel:light">Gray bevel, light</option>
      <option value="workbench:dark">Four-color workbench, dark</option>
      <option value="workbench:light">Four-color workbench, light</option>
      <option value="synthwave:dark">Synthwave, night</option>
      <option value="synthwave:light">Synthwave, daybreak</option>
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

<section data-testid="encryption">
  <h3>Encryption</h3>
  {#if !session.driver}
    <p class="hint">Connect a brain first.</p>
  {:else if session.encryption.locked}
    <p data-testid="enc-locked">This brain is encrypted and locked on this device. Unlock it above to read it or to change its encryption.</p>
  {:else if session.encryption.enabled}
    <p data-testid="enc-on">Encryption is on. Passage, notes, principle, proposal, and capture text is encrypted on this device before upload; GitHub stores ciphertext.</p>
    <p class="hint">{DISCLOSURE}</p>
    <div class="row">
      <button onclick={lockNow} disabled={busy} use:hold={pressed === 'enc-lock'} data-testid="enc-lock">Lock now</button>
      <button onclick={forget} disabled={busy} use:hold={pressed === 'enc-forget'} data-testid="enc-forget">Forget on this device</button>
      <button onclick={() => { rekeying = !rekeying; disabling = false; }} disabled={busy} data-testid="enc-rekey">Change passphrase</button>
      <button onclick={() => { disabling = !disabling; rekeying = false; }} disabled={busy} data-testid="enc-disable">Turn encryption off</button>
    </div>
    {#if rekeying}
      <EncryptForm mode="rekey" ondone={(n) => { rekeying = false; encDone = `Passphrase changed: ${files(n)} re-encrypted.`; }} />
    {/if}
    {#if disabling}
      <div class="confirm" role="alertdialog" data-testid="enc-disable-confirm">
        <p>Turn encryption off? Every body is rewritten as plaintext in one commit, GitHub can read it again, and the passphrase is forgotten on this device.</p>
        <div class="row">
          <button onclick={doDisable} disabled={busy} use:hold={pressed === 'enc-disable'} data-testid="enc-disable-yes">{pressed === 'enc-disable' ? 'Decrypting…' : 'Decrypt the brain'}</button>
          <button class="primary" onclick={() => (disabling = false)} disabled={busy}>Keep it encrypted</button>
        </div>
      </div>
    {/if}
  {:else}
    <p>Encryption is off. Turning it on encrypts the text of passages, notes, principles, proposals, and captures on this device before upload, so GitHub stores only ciphertext. Desktop tools need the passphrase, or <code>gnomon decrypt</code>, to read it.</p>
    <button onclick={() => (enabling = !enabling)} disabled={busy} data-testid="enc-enable">{enabling ? 'Not now' : 'Encrypt this brain'}</button>
    {#if enabling}
      <EncryptForm mode="enable" ondone={(n) => { enabling = false; encDone = `Encryption is on: ${files(n)} encrypted.`; }} />
    {/if}
  {/if}
  {#if encDone}<p class="ok" role="status" data-testid="enc-done">{encDone}</p>{/if}
</section>

<section>
  <h3>Who can see what</h3>
  <p>
    Your brain is a private repository on GitHub; GitHub holds the files and can technically read them, unless
    encryption is on, in which case it holds ciphertext for every passage, note, principle, proposal, and capture and
    cleartext for titles, tags, authors, structure, and attached files.
    When you reason, the AI provider you picked receives the principle sets you selected and as many of their
    grounding passages as fit the budget, never attachments and never the whole brain. Nobody else sees anything:
    this app has no server.
  </p>
</section>

<section class="about">
  <p class="hint">
    Gnomon {pkg.version}, build <span data-testid="build">{__GNOMON_BUILD__}</span>.
    {#if pwa.needRefresh}
      A newer build is ready: <button type="button" class="small primary" onclick={applyUpdate} disabled={pwa.applying} use:hold={pwa.applying} data-testid="update-now">Update now</button>
    {:else}
      <button type="button" class="small" onclick={checkForUpdate} disabled={pwa.checking} use:hold={pwa.checking} data-testid="check-update">{pwa.checking ? 'Checking…' : 'Check for updates'}</button>
      {#if pwa.lastCheck}<span role="status" data-testid="update-status">{UPDATE_CHECK_TEXT[pwa.lastCheck]}</span>{/if}
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
    <li data-testid="enc-diag">
      Encryption {session.encryption.enabled ? (session.encryption.locked ? 'on, locked' : 'on, unlocked') : 'off'}{#if session.encryption.storeError}; last key store failure: {session.encryption.storeError}{/if}.
    </li>
    <li>
      Key derivation on this device: <button type="button" class="small" onclick={measureKdf} disabled={kdf.busy || !wasm} use:hold={kdf.busy} data-testid="kdf-measure">{kdf.busy ? 'Measuring…' : 'Measure'}</button>
      {#if kdf.text}<span role="status" data-testid="kdf-timing">{kdf.text}</span>{/if}
    </li>
  </ul>
</section>

{#if error}<p class="error" role="alert">{error}</p>{/if}

<style>
  section { margin-bottom: 1.75rem; }
  .row { display: flex; gap: 0.5rem; flex-wrap: wrap; margin: 0.5rem 0; }
  .confirm { flex-direction: column; align-items: stretch; }
  .confirm p { margin: 0 0 6px; }
  label { margin: 0.5rem 0; }
  input:not([type='range']), select { max-width: 24rem; margin-top: 0.25rem; }
  input[type='range'] { max-width: 24rem; display: block; }
  .about { border-top: var(--bw, 1px) solid var(--edge); padding-top: 0.75rem; }
  .diagnostics { padding-left: 1.1rem; margin: 0.5rem 0 0; }
  .diagnostics li { margin: 0.2rem 0; overflow-wrap: anywhere; }
</style>
