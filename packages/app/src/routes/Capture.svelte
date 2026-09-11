<script lang="ts">
  // Capture — spec §10.4, US-1, and the offline queue of spec §14. The
  // default screen: paste target, note, attach-a-file, save. One commit.
  import { AttachmentTooLargeError, ATTACHMENT_LIMIT_BYTES } from '@gnomon/storage';
  import ConnectionNotice from '../lib/components/ConnectionNotice.svelte';
  import Nudge from '../lib/components/Nudge.svelte';
  import { brain, describeError } from '../lib/services/index';
  import { snapshot } from '../lib/stores/snapshot.svelte';
  import type { CaptureResult } from '../lib/services/capture';
  import { session } from '../lib/stores/session.svelte';
  import { network, offlineQueue, pending } from '../lib/stores/pending.svelte';
  import { ATTACHMENT_OFFLINE } from '../lib/services/offline';

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
      // Refuse an attachment while offline before touching the file: WebKit fails the read itself when offline.
      if (file && !network.online) throw new Error(ATTACHMENT_OFFLINE);
      const attachment = file ? { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } : undefined;
      const result = await offlineQueue.capture(brain, { text, note, ...(attachment ? { attachment } : {}) });
      if ('saved' in result) saved = result.saved;
      else queued = true;
      text = '';
      note = '';
      files = null;
      if (fileInput) fileInput.value = '';
    } catch (e) {
      error = e instanceof AttachmentTooLargeError ? `${describeError(e)} The capture is kept below.` : describeError(e);
    } finally {
      saving = false;
    }
  }
</script>

<h2>Capture</h2>
{#if !session.driver || (!snapshot.current && network.online)}
  <ConnectionNotice />
{:else}
  <Nudge />
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
      Source note <small>(optional)</small>
      <input bind:value={note} placeholder="Author, work, page, and why it struck you" data-testid="capture-note" />
    </label>
    <p class="hint">Filing takes the author and work from this note when it names them.</p>
    <label>
      Attach a file <small>(optional, up to {mb(ATTACHMENT_LIMIT_BYTES)} MB)</small>
      <input type="file" bind:files bind:this={fileInput} data-testid="capture-file" />
    </label>
    {#if file}<p class="hint">{file.name} · {mb(file.size)} MB</p>{/if}
    <button type="submit" class="primary" disabled={saving || text.trim() === ''} data-testid="capture-save">{saving ? 'Saving…' : network.online ? 'Save to inbox' : 'Keep until online'}</button>
  </form>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
{/if}

<style>
  form { display: grid; gap: 1rem; }
  label { display: grid; gap: 0.35rem; }
  textarea { min-height: 10rem; }
  form button.primary { justify-self: center; }
  .hint { margin: 0; }
</style>
