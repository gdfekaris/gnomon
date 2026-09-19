<script lang="ts">
  // Enable encryption, or change the passphrase (spec §6.4): a passphrase
  // typed twice, the sentence that says there is no recovery typed back
  // (enable only), and "Remember on this device". One commit; the stack is
  // swapped underneath and the brain reloads through it. Used by Settings
  // and by onboarding's privacy step. `#/…?kdf=fast|interactive` picks the
  // Argon2id parameters for tests; a real brain gets the default preset.
  import { hold } from '../press';
  import { DISCLOSURE, LOST_SENTENCE, REMEMBER_LIMIT, kdfParamsFor, typedBack } from '../services/encryption';
  import { describeError, encryption } from '../services/index';
  import { route } from '../router.svelte';

  let { mode, ondone }: { mode: 'enable' | 'rekey'; ondone: (files: number) => void } = $props();
  let passphrase = $state('');
  let confirm = $state('');
  let sentence = $state('');
  let remember = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  const MIN = 8;
  const ready = $derived(passphrase.length >= MIN && confirm === passphrase && (mode === 'rekey' || typedBack(sentence)));

  async function go() {
    busy = true;
    error = null;
    try {
      const kdf = route.query.get('kdf');
      const files = mode === 'enable'
        ? await encryption.enable(passphrase, { remember, params: kdfParamsFor(kdf) })
        : await encryption.changePassphrase(passphrase, { remember, ...(kdf ? { params: kdfParamsFor(kdf) } : {}) });
      passphrase = '';
      confirm = '';
      sentence = '';
      ondone(files);
    } catch (e) {
      error = describeError(e);
    } finally {
      busy = false;
    }
  }
</script>

<form class="panel" data-testid="encrypt-form" onsubmit={(e) => { e.preventDefault(); if (ready) void go(); }}>
  {#if mode === 'enable'}
    <p class="hint">{DISCLOSURE}</p>
  {:else}
    <p class="hint">Every body is re-encrypted under the new passphrase in one commit. Other devices that remembered the old one will ask again.</p>
  {/if}
  <label>{mode === 'enable' ? 'Passphrase' : 'New passphrase'} <small>(at least {MIN} characters; longer is better)</small>
    <input type="password" bind:value={passphrase} autocomplete="new-password" data-testid="enc-passphrase" />
  </label>
  <label>Again
    <input type="password" bind:value={confirm} autocomplete="new-password" data-testid="enc-confirm" />
  </label>
  {#if confirm && confirm !== passphrase}<p class="hint" data-testid="enc-mismatch">The two do not match yet.</p>{/if}
  {#if mode === 'enable'}
    <label>Type this back: <em>{LOST_SENTENCE}</em>
      <input bind:value={sentence} autocomplete="off" autocapitalize="off" data-testid="enc-sentence" />
    </label>
  {/if}
  <label class="check"><input type="checkbox" bind:checked={remember} data-testid="enc-remember" /> Remember on this device</label>
  <p class="hint">{REMEMBER_LIMIT}</p>
  <div class="row">
    <button type="submit" class="primary" disabled={busy || !ready} use:hold={busy} data-testid="enc-go">
      {busy ? (mode === 'enable' ? 'Encrypting…' : 'Re-encrypting…') : mode === 'enable' ? 'Encrypt the brain' : 'Change the passphrase'}
    </button>
    {#if busy}<span role="status" class="hint">Deriving the key, then one commit that rewrites every body; a few seconds.</span>{/if}
  </div>
  {#if error}<p class="error" role="alert" data-testid="enc-error">{error}</p>{/if}
</form>

<style>
  form { display: grid; gap: 0.6rem; margin-top: 0.5rem; }
  label { display: grid; gap: 0.25rem; }
  label.check { display: flex; align-items: center; gap: 0.5rem; }
  label.check input { width: auto; }
  input { max-width: 24rem; }
  .row { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; }
  .hint, .error { margin: 0; }
</style>
