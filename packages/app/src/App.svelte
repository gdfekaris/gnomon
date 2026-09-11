<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { route } from './lib/router.svelte';
  import { loadSettings, savePrefs, settings } from './lib/stores/settings.svelte';
  import { configureReasoner, reasoning } from './lib/stores/reasoning.svelte';
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
  import Inbox from './routes/Inbox.svelte';
  import Proposals from './routes/Proposals.svelte';
  import Onboarding from './routes/Onboarding.svelte';
  import Icon from './lib/components/Icon.svelte';

  // Launch: rebuild the session from on-device settings (spec §10.2), off the
  // critical path so Capture renders first (spec §10.4).
  let booting = $state(true);
  onMount(async () => {
    startServiceWorker();
    watchNetwork();
    try {
      await loadSettings();
      configureReasoner();
      if (session.driver) return;
      if (settings.prefs.mode === 'github' && settings.git) await connectGitHub(settings.git);
      else if (settings.prefs.mode === 'demo') await connectDemo();
    } catch {
      // the screens show the error state; the user can reconnect in Settings
    } finally {
      booting = false;
    }
  });

  // Onboarding is the first screen when no brain is connected (Phase 3 block
  // 2): the default route redirects to it once launch has settled and there
  // is nothing to reconnect, so the flow owns its URL until it finishes on
  // Capture. A saved connection that fails to reconnect stays on Capture,
  // which says so.
  $effect(() => {
    if (route.name === 'capture' && !booting && !session.driver && !(settings.prefs.mode === 'github' && settings.git)) location.hash = '#/onboarding';
  });
  const onboarding = $derived(route.name === 'onboarding');
  // The provider picked on Reason or Inbox is remembered across launches.
  $effect(() => {
    const provider = reasoning.provider;
    untrack(() => {
      if (settings.loaded && settings.prefs.provider !== provider) void savePrefs({ provider });
    });
  });
</script>

<main class="window">
  <header class="titlebar">
    <span class="box"></span>
    <h1><span>Gnomon</span></h1>
    <span class="box"></span>
  </header>
  <StaleBanner />
  <UpdateToast />
  <div class="content">
    {#if onboarding}
      <Onboarding />
    {:else if route.name === 'browse' && route.path}
      <FileView path={route.path} anchor={route.anchor} />
    {:else if route.name === 'browse'}
      <Browse />
    {:else if route.name === 'sets' && route.rest.length === 2 && route.rest[1] === 'new-principle'}
      <Editor path="" newIn={route.rest[0]} from={route.query.get('from') ?? undefined} />
    {:else if route.name === 'sets'}
      <Sets />
    {:else if route.name === 'edit'}
      <Editor path={route.path} from={route.query.get('from') ?? undefined} />
    {:else if route.name === 'proposals'}
      <Proposals />
    {:else if route.name === 'reason'}
      <Reason />
    {:else if route.name === 'inbox'}
      <Inbox />
    {:else if route.name === 'settings'}
      <Settings />
    {:else}
      <Capture />
    {/if}
  </div>
  {#if !onboarding}
    <nav class="tabs">
      <a href="#/capture" class:active={route.name === 'capture'}><Icon name="capture" />Capture</a>
      <a href="#/browse" class:active={route.name === 'browse'}><Icon name="browse" />Browse</a>
      <a href="#/inbox" class:active={route.name === 'inbox'}><Icon name="inbox" />Inbox</a>
      <a href="#/proposals" class:active={route.name === 'proposals'}><Icon name="proposals" />Proposals</a>
      <a href="#/sets" class:active={route.name === 'sets' || route.name === 'edit'}><Icon name="sets" />Sets</a>
      <a href="#/reason" class:active={route.name === 'reason'}><Icon name="reason" />Reason</a>
      <a href="#/settings" class:active={route.name === 'settings'}><Icon name="settings" />Settings</a>
    </nav>
  {/if}
</main>
