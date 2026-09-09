<script lang="ts">
  // Spec §15: images inline from a blob: URL; PDFs opened in a new tab from a
  // blob: URL; HTML shown as source, never rendered; the rest as a download.
  import { type LoadedAttachment, loadAttachment } from '../attachments';
  import { describeError } from '../services/index';
  import { session } from '../stores/session.svelte';
  import { snapshot } from '../stores/snapshot.svelte';

  let { path }: { path: string } = $props();
  let loaded = $state<LoadedAttachment | null>(null);
  let error = $state<string | null>(null);
  const mb = (n: number) => (n / (1024 * 1024)).toFixed(2);
  const entry = $derived(snapshot.current?.attachments.get(path));

  $effect(() => {
    loaded = null;
    error = null;
    const driver = session.driver;
    if (!driver) return;
    loadAttachment(driver, path, entry?.sha || undefined).then((a) => (loaded = a), (e: unknown) => (error = describeError(e)));
  });
  const openPdf = () => { if (loaded) window.open(loaded.url, '_blank', 'noopener'); };
  const asText = () => (loaded ? new TextDecoder().decode(loaded.bytes) : '');
</script>

<p class="meta"><code>{path}</code>{#if entry}{` · ${mb(entry.size)} MB`}{/if}</p>
{#if error}
  <p class="error" role="alert">{error}</p>
{:else if !loaded}
  <p>Loading…</p>
{:else if loaded.kind === 'image'}
  <img src={loaded.url} alt={path} data-testid="attachment-image" />
{:else if loaded.kind === 'pdf'}
  <button onclick={openPdf} data-testid="attachment-open">Open PDF in a new tab</button>
{:else if loaded.kind === 'html' || loaded.kind === 'text'}
  <p class="hint">{loaded.kind === 'html' ? 'HTML attachments are shown as source and never rendered.' : 'Shown as text.'}</p>
  <pre data-testid="attachment-source">{asText()}</pre>
{:else}
  <a href={loaded.url} download={path.slice(path.lastIndexOf('/') + 1)} data-testid="attachment-download">Download {path.slice(path.lastIndexOf('/') + 1)}</a>
{/if}

<style>
  img { max-width: 100%; height: auto; }
  pre { white-space: pre-wrap; word-break: break-word; background: rgba(127, 127, 127, 0.1); padding: 0.75rem; border-radius: 0.5rem; }
  .meta, .hint { opacity: 0.7; }
  .error { color: #b91c1c; }
  button { padding: 0.6rem 1rem; font-size: 1rem; }
</style>
