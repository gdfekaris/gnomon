<script lang="ts">
  import { onMount } from 'svelte';
  import { route } from './lib/router.svelte';
  import { loadSettings, settings } from './lib/stores/settings.svelte';
  import { session } from './lib/stores/session.svelte';
  import { connectDemo, connectGitHub } from './lib/services/index';
  import StaleBanner from './lib/components/StaleBanner.svelte';
  import UpdateToast from './lib/components/UpdateToast.svelte';
  import { startServiceWorker } from './lib/stores/pwa.svelte';
  import { watchNetwork } from './lib/stores/pending.svelte';
  import Browse from './routes/Browse.svelte';
  import FileView from './routes/FileView.svelte';
  import Capture from './routes/Capture.svelte';
  import Settings from './routes/Settings.svelte';
  import Sets from './routes/Sets.svelte';
  import Editor from './routes/Editor.svelte';
  import Reason from './routes/Reason.svelte';

  // Launch: rebuild the session from on-device settings (spec §10.2), off the
  // critical path so Capture renders first (spec §10.4).
  onMount(async () => {
    startServiceWorker();
    watchNetwork();
    await loadSettings();
    if (session.driver) return;
    try {
      if (settings.prefs.mode === 'github' && settings.git) await connectGitHub(settings.git);
      else if (settings.prefs.mode === 'demo') await connectDemo();
    } catch {
      // the screens show the error state; the user can reconnect in Settings
    }
  });
</script>

<StaleBanner />
<UpdateToast />
<main>
  <header>
    <h1>Gnomon</h1>
    <nav>
      <a href="#/capture" class:active={route.name === 'capture'}>Capture</a>
      <a href="#/browse" class:active={route.name === 'browse'}>Browse</a>
      <a href="#/sets" class:active={route.name === 'sets'}>Sets</a>
      <a href="#/reason" class:active={route.name === 'reason'}>Reason</a>
      <a href="#/settings" class:active={route.name === 'settings'}>Settings</a>
    </nav>
  </header>
  {#if route.name === 'browse' && route.path}
    <FileView path={route.path} anchor={route.anchor} />
  {:else if route.name === 'browse'}
    <Browse />
  {:else if route.name === 'sets' && route.rest.length === 2 && route.rest[1] === 'new-principle'}
    <Editor path="" newIn={route.rest[0]} />
  {:else if route.name === 'sets'}
    <Sets />
  {:else if route.name === 'edit'}
    <Editor path={route.path} />
  {:else if route.name === 'reason'}
    <Reason />
  {:else if route.name === 'settings'}
    <Settings />
  {:else if route.name === 'capture'}
    <Capture />
  {:else}
    <h2>{route.name}</h2>
    <p>This screen arrives in a later block.</p>
  {/if}
</main>

<style>
  header { display: flex; align-items: baseline; gap: 1.5rem; flex-wrap: wrap; }
  h1 { font-size: 1.25rem; margin: 0; }
  nav { display: flex; gap: 1rem; }
  nav a { text-decoration: none; }
  nav a.active { font-weight: 600; text-decoration: underline; }
</style>
