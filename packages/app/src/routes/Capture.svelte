<script lang="ts">
  // Capture — spec §10.4, US-1, and the capture queue of spec §14. The
  // default screen: paste target, note, attach-a-file, save. One commit.
  // What is typed is kept on the device until it is saved, and a capture
  // that cannot be saved now waits on the device; neither is ever lost to a
  // closed app or a missing connection.
  import { hold } from '../lib/press';
  import { AttachmentTooLargeError, ATTACHMENT_LIMIT_BYTES } from '@gnomon/storage';
  import ConnectionNotice from '../lib/components/ConnectionNotice.svelte';
  import Nudge from '../lib/components/Nudge.svelte';
  import { brain, describeError } from '../lib/services/index';
  import { snapshot } from '../lib/stores/snapshot.svelte';
  import type { CaptureResult } from '../lib/services/capture';
  import { session } from '../lib/stores/session.svelte';
  import { settings } from '../lib/stores/settings.svelte';
  import { deviceStorage, flushPending, network, offlineQueue, pending } from '../lib/stores/pending.svelte';
  import { ATTACHMENT_OFFLINE, loadDraft, saveDraft } from '../lib/services/offline';

  const draft = loadDraft(deviceStorage());
  let text = $state(draft.text);
  let note = $state(draft.note);
  // The draft follows the form: written a moment after the last keystroke, and at once when the screen or the app is left.
  let draftTimer: ReturnType<typeof setTimeout> | undefined;
  const keepDraft = () => saveDraft(deviceStorage(), { text, note });
  $effect(() => {
    void text;
    void note;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(keepDraft, 400);
    return () => {
      clearTimeout(draftTimer);
      keepDraft();
    };
  });
  $effect(() => {
    const leave = () => { if (document.visibilityState === 'hidden') keepDraft(); };
    document.addEventListener('visibilitychange', leave);
    window.addEventListener('pagehide', keepDraft);
    return () => {
      document.removeEventListener('visibilitychange', leave);
      window.removeEventListener('pagehide', keepDraft);
    };
  });

  // A brain is set up on this device even when it is not connected yet (launching offline with no copy): captures then wait.
  const configured = $derived(session.driver !== null || (settings.prefs.mode === 'github' && settings.git !== null));

  // Paste: one tap fills the passage from the clipboard. iOS asks to allow it each time; a refusal says how to paste by hand.
  const canPaste = typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function';
  let pasteError = $state<string | null>(null);
  async function paste() {
    pasteError = null;
    try {
      const clip = await navigator.clipboard.readText();
      if (clip === '') pasteError = 'The clipboard holds no text.';
      else text = text.trim() === '' ? clip : `${text.replace(/\n*$/, '')}\n\n${clip}`;
    } catch {
      pasteError = 'The browser did not hand over the clipboard. Press and hold in the box and choose Paste.';
    }
  }

  // A waiting capture can be taken back into the form, to change it or to clear it; only into an empty form, so nothing is overwritten.
  let takeError = $state<string | null>(null);
  function takeBack(id: string) {
    takeError = null;
    if (text !== '' || note !== '') {
      takeError = 'Save or clear what is in the form first.';
      return;
    }
    const item = offlineQueue.remove(id);
    if (!item) return;
    text = item.text;
    note = item.note ?? '';
  }
  const when = (at: string) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const snippet = (t: string) => (t.length > 70 ? `${t.slice(0, 70).trimEnd()}…` : t);
  let files = $state<FileList | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let saved = $state<CaptureResult | null>(null);

  const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
  const file = $derived(files?.[0] ?? null);
  // Clear starts over: it empties the three fields and drops the error. It asks first, inline like the editor's
  // Back, because a thought typed on the phone is not on the clipboard the way a pasted passage is.
  const filled = $derived(text !== '' || note !== '' || file !== null);
  let clearing = $state(false);
  function clear() {
    text = '';
    note = '';
    files = null;
    if (fileInput) fileInput.value = '';
    error = null;
    clearing = false;
  }
  // A flush from the network watcher surfaces here.
  $effect(() => {
    if (pending.flushed) {
      saved = pending.flushed;
      pending.flushed = null;
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
{#if !configured}
  <ConnectionNotice />
{:else}
  {#if snapshot.current}<Nudge />{/if}
  {#if !network.online}
    <p class="offline" role="status" data-testid="offline">You are offline. A text capture is kept on this device and saved when you are back online.</p>
  {:else if !snapshot.current}
    <!-- Loading, locked, or failed to load: the notice says which; the form below still takes a capture. -->
    <ConnectionNotice />
    <p class="hint" data-testid="not-loaded">A text capture made now is kept on this device and saved once the brain is open.</p>
  {/if}
  {#if pending.queue.length}
    <div class="notice waiting" role="status" data-testid="queued">
      <p>{pending.queue.length === 1 ? 'One capture is waiting' : `${pending.queue.length} captures are waiting`} on this device and will save when the repository can be reached.</p>
      <ul>
        {#each pending.queue as item (item.id)}
          <li data-testid="queued-item">
            <span class="grow"><small>{when(item.at)}</small> {snippet(item.text)}</span>
            <button type="button" class="small" onclick={() => takeBack(item.id)} data-testid="queued-take">Take back</button>
            {#if item.error}
              <p class="error" role="alert" data-testid="queued-error">
                Not saved: {item.error}
                <button type="button" class="small" onclick={flushPending} data-testid="queued-retry">Try again</button>
              </p>
            {/if}
          </li>
        {/each}
      </ul>
      {#if takeError}<p class="error" role="alert">{takeError}</p>{/if}
    </div>
  {/if}
  {#if saved}
    <p class="ok" role="status" data-testid="saved">
      Saved as <code>{saved.stem}</code>{#if saved.attachment} with its attachment{/if}.
    </p>
  {/if}
  <form onsubmit={(e) => { e.preventDefault(); void save(); }}>
    <label>
      <span class="head">
        Passage
        {#if canPaste}<button type="button" class="small" onclick={paste} data-testid="capture-paste">Paste</button>{/if}
      </span>
      <textarea bind:value={text} rows="8" placeholder="Paste the passage exactly as you found it." required data-testid="capture-text"></textarea>
    </label>
    {#if pasteError}<p class="error" role="alert" data-testid="paste-error">{pasteError}</p>{/if}
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
    {#if clearing && filled}
      <div class="confirm" role="alertdialog" data-testid="clear-confirm">
        <p>Clear the capture? The passage, the note, and the attached file will be gone.</p>
        <div class="row">
          <button type="button" onclick={clear} data-testid="clear-yes">Clear</button>
          <button type="button" class="primary" onclick={() => (clearing = false)} data-testid="clear-no">Keep</button>
        </div>
      </div>
    {/if}
    <div class="row">
      <button type="submit" class="primary" disabled={saving || text.trim() === ''} use:hold={saving} data-testid="capture-save">{saving ? 'Saving…' : network.online && session.driver ? 'Save to inbox' : 'Keep until online'}</button>
      {#if filled}
        <button type="button" onclick={() => (clearing = true)} disabled={saving || clearing} data-testid="capture-clear">Clear</button>
      {/if}
    </div>
  </form>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
{/if}

<style>
  form { display: grid; gap: 1rem; }
  label { display: grid; gap: 0.35rem; }
  textarea { min-height: 10rem; }
  .row { display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap; }
  .confirm .row { justify-content: start; margin-top: 0.5rem; }
  .hint { margin: 0; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; }
  .waiting { display: block; }
  .waiting p { margin: 0; }
  .waiting ul { list-style: none; margin: 0.5rem 0 0; padding: 0; display: grid; gap: 0.5rem; }
  .waiting li { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
  .waiting li .error { flex-basis: 100%; margin: 0; }
  .grow { flex: 1; min-width: 0; overflow-wrap: anywhere; }
</style>
