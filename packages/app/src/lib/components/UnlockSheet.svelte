<script lang="ts">
  // The unlock sheet (spec §6.4, §14): up whenever the connected brain is
  // encrypted and this process holds no key. Once per session; "Remember on
  // this device" wraps the key under a device key in IndexedDB, with its
  // limit stated. A wrong passphrase is refused here, beside the field.
  import { hold } from '../press';
  import { REMEMBER_LIMIT } from '../services/encryption';
  import { describeError, encryption } from '../services/index';
  import { session } from '../stores/session.svelte';

  let passphrase = $state('');
  let remember = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function unlock() {
    busy = true;
    error = null;
    try {
      await encryption.unlock(passphrase, remember);
      passphrase = '';
    } catch (e) {
      error = describeError(e);
    } finally {
      busy = false;
    }
  }
</script>

{#if session.encryption.enabled && session.encryption.locked}
  <div class="sheet panel" role="dialog" aria-labelledby="unlock-title" data-testid="unlock-sheet">
    <h3 id="unlock-title">Unlock {session.label}</h3>
    <form onsubmit={(e) => { e.preventDefault(); void unlock(); }}>
    <p>This brain is encrypted. Its passphrase decrypts it on this device; nothing is sent anywhere.</p>
    <label>Passphrase <input type="password" bind:value={passphrase} autocomplete="current-password" data-testid="unlock-passphrase" /></label>
    <label class="check"><input type="checkbox" bind:checked={remember} data-testid="unlock-remember" /> Remember on this device</label>
    <p class="hint">{REMEMBER_LIMIT}</p>
    <div class="row">
      <button type="submit" class="primary" disabled={busy || !passphrase} use:hold={busy} data-testid="unlock-go">{busy ? 'Unlocking…' : 'Unlock'}</button>
    </div>
    {#if error}<p class="error" role="alert" data-testid="unlock-error">{error}</p>{/if}
    </form>
  </div>
{/if}

<style>
  .sheet { margin: 8px 8px 0; display: grid; gap: 0.5rem; }
  form { display: grid; gap: 0.5rem; }
  .sheet h3, .sheet p { margin: 0; }
  label { display: grid; gap: 0.25rem; }
  label.check { display: flex; align-items: center; gap: 0.5rem; }
  label.check input { width: auto; }
  .row { display: flex; gap: 0.5rem; }
  .error { margin: 0; }
</style>
