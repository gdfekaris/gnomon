<script lang="ts">
  // Capture — spec §10.4, US-1, and the offline queue of spec §14. The
  // default screen: paste target, note, attach-a-file, save. One commit.
  import { AttachmentTooLargeError, ATTACHMENT_LIMIT_BYTES } from '@gnomon/storage';
  import { brain } from '../lib/services/index';
  import type { CaptureResult } from '../lib/services/capture';
  import { session } from '../lib/stores/session.svelte';
  import { network, offlineQueue, pending } from '../lib/stores/pending.svelte';

  let text = $state('');
  let note = $state('');
  let files = $state<FileList | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let saved = $state<CaptureResult | null>(null);
  let queued = $state(false);

  const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
  const file = $derived(files?.[0] ?? null);
  // A flush from the network watcher surfaces here.
  $effect(() => {
    if (pending.flushed) {
      saved = pending.flushed;
      queued = false;
      pending.flushed = null;
    }
    if (pending.flushError) {
      error = pending.flushError;
      queued = false;
      pending.flushError = null;
    }
  });

  async function save() {
    saving = true;
    error = null;
    saved = null;
    try {
      const attachment = file ? { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } : undefined;
      const result = await offlineQueue.capture(brain, { text, note, ...(attachment ? { attachment } : {}) });
      if ('saved' in result) saved = result.saved;
      else queued = true;
      text = '';
      note = '';
      files = null;
      if (fileInput) fileInput.value = '';
    } catch (e) {
      error = e instanceof AttachmentTooLargeError
        ? `That file is ${mb(e.size)} MB; the limit is ${mb(e.limit)} MB. The capture is kept below; remove or replace the file.`
        : (e as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<h2>Capture</h2>
{#if !session.driver}
  <p>No brain connected yet. <a href="#/onboarding">Set one up</a>, or <a href="#/settings">open Settings</a> to reconnect.</p>
{:else}
  {#if !network.online}
    <p class="offline" role="status" data-testid="offline">You are offline. A text capture will be kept here and saved when you are back online.</p>
  {/if}
  {#if queued || pending.pending}
    <p class="queued" role="status" data-testid="queued">One capture is waiting and will save when online.</p>
  {/if}
  {#if saved}
    <p class="ok" role="status" data-testid="saved">
      Saved as <code>{saved.stem}</code>{#if saved.attachment} with its attachment{/if}.
    </p>
  {/if}
  <form onsubmit={(e) => { e.preventDefault(); void save(); }}>
    <label>
      Passage
      <textarea bind:value={text} rows="8" placeholder="Paste the passage exactly as you found it." required data-testid="capture-text"></textarea>
    </label>
    <label>
      Note <small>(optional)</small>
      <input bind:value={note} placeholder="Where it came from, why it struck you" data-testid="capture-note" />
    </label>
    <label>
      Attach a file <small>(optional, up to {mb(ATTACHMENT_LIMIT_BYTES)} MB)</small>
      <input type="file" bind:files bind:this={fileInput} data-testid="capture-file" />
    </label>
    {#if file}<p class="hint">{file.name} · {mb(file.size)} MB</p>{/if}
    <button type="submit" disabled={saving || text.trim() === ''} data-testid="capture-save">{saving ? 'Saving…' : network.online ? 'Save to inbox' : 'Keep until online'}</button>
  </form>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
{/if}

<style>
  form { display: grid; gap: 1rem; }
  label { display: grid; gap: 0.35rem; }
  textarea, input:not([type='file']) { width: 100%; box-sizing: border-box; font: inherit; padding: 0.5rem; }
  textarea { min-height: 10rem; }
  button { padding: 0.75rem 1rem; font-size: 1rem; }
  .ok { background: #dcfce7; color: #14532d; padding: 0.75rem 1rem; border-radius: 0.5rem; }
  .queued, .offline { background: #fef3c7; color: #78350f; padding: 0.75rem 1rem; border-radius: 0.5rem; }
  .error { color: #b91c1c; }
  .hint { opacity: 0.7; font-size: 0.9rem; margin: 0; }
  small { opacity: 0.7; font-weight: normal; }
  @media (prefers-color-scheme: dark) { .ok { background: #14532d; color: #dcfce7; } .queued, .offline { background: #78350f; color: #fef3c7; } }
</style>
