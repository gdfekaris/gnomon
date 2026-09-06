<script lang="ts">
  // Settings — proposal §6. Block 14: connect the demo brain or a GitHub
  // repository. Block 17 adds validation results, connect-existing scaffold
  // offers, provider keys, budget, privacy, and theme.
  import { connectDemo, connectGitHub, disconnect } from '../lib/services/index';
  import { session } from '../lib/stores/session.svelte';
  import { settings, saveGit } from '../lib/stores/settings.svelte';

  let owner = $state(settings.git?.owner ?? '');
  let name = $state(settings.git?.name ?? '');
  let token = $state(settings.git?.token ?? '');
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function run(action: () => Promise<void>) {
    busy = true;
    error = null;
    try {
      await action();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  const useDemo = () => run(connectDemo);
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
</script>

<h2>Settings</h2>

<section>
  <h3>Brain</h3>
  {#if session.driver}
    <p>Connected: <strong>{session.label}</strong> ({session.mode}).</p>
    <button onclick={signOut} disabled={busy}>Disconnect</button>
  {:else}
    <p>Not connected.</p>
  {/if}
</section>

<section>
  <h3>Demo brain</h3>
  <p>A small brain that lives only in this tab. Nothing you do to it is saved.</p>
  <button onclick={useDemo} disabled={busy} data-testid="use-demo">Use the demo brain</button>
</section>

<section>
  <h3>GitHub repository</h3>
  <label>Owner <input bind:value={owner} autocapitalize="off" autocomplete="off" /></label>
  <label>Repository <input bind:value={name} autocapitalize="off" autocomplete="off" /></label>
  <label>Fine-grained token <input bind:value={token} type="password" autocomplete="off" /></label>
  <button onclick={useGitHub} disabled={busy || !owner || !name || !token}>Connect</button>
  <p class="hint">The token is stored only on this device (spec §10.3).</p>
</section>

{#if error}<p class="error" role="alert">{error}</p>{/if}

<style>
  section { margin-bottom: 1.5rem; }
  label { display: block; margin: 0.5rem 0; }
  input { width: 100%; max-width: 24rem; padding: 0.4rem; font-size: 1rem; }
  .hint { opacity: 0.7; font-size: 0.9rem; }
  .error { color: #b91c1c; }
</style>
