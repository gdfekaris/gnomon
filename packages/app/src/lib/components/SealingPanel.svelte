<script lang="ts">
  // Settings → Sealing (spec §6.5; Phase 5 block S3): set up sealing with the
  // recovery phrase, add this device from the phrase, enroll a desktop key
  // from its request, revoke a key, forget this device's key. The phrase is
  // shown once at setup and typed only into the fields here; nothing keeps it.
  // Each error sits beside the control that failed.
  import { hold } from '../press';
  import { describeError, sealingFlows } from '../services/index';
  import { confirmPositions, defaultLabel, wordsMatch } from '../services/sealing';
  import { session } from '../stores/session.svelte';

  const s = $derived(session.sealing);
  let busy = $state<string | null>(null);
  let error = $state<{ at: string; text: string } | null>(null);
  let done = $state<string | null>(null);

  // Setup: the words, then three of them back.
  let setup = $state<{ entropy: Uint8Array; words: string[]; fingerprint: string } | null>(null);
  let step = $state<'words' | 'confirm'>('words');
  let positions = $state<number[]>([]);
  let answers = $state(['', '', '']);
  let label = $state(defaultLabel());
  let phrase = $state('');
  /** the key whose enroll or revoke form is open, and the revocation point it would name */
  let open = $state<{ kind: 'enroll' | 'revoke'; key: string; point?: string } | null>(null);
  let forgetting = $state(false);

  async function act(at: string, f: () => Promise<void>, ok?: string) {
    busy = at;
    error = null;
    done = null;
    try {
      await f();
      if (ok) done = ok;
    } catch (e) {
      error = { at, text: describeError(e) };
    } finally {
      busy = null;
    }
  }
  const begin = () => act('begin', async () => {
    setup = await sealingFlows.begin();
    step = 'words';
    answers = ['', '', ''];
    positions = confirmPositions();
  });
  const cancel = () => {
    setup?.entropy.fill(0);
    setup = null;
  };
  const finish = () => act('finish', async () => {
    if (!setup) return;
    await sealingFlows.finishSetup(setup.entropy, label);
    setup = null;
  }, 'Sealing is on. This device holds its key; keep the paper card somewhere safe.');
  const recover = () => act('recover', async () => {
    await sealingFlows.recover(phrase, label);
    phrase = '';
  }, 'This device is enrolled and can seal captures.');
  const openForm = (kind: 'enroll' | 'revoke', key: string) => act(`${kind}-open`, async () => {
    phrase = '';
    if (kind === 'revoke') {
      const p = await sealingFlows.revocationPoint(key);
      open = { kind, key, point: p.last_seq === 0 ? 'It has made no seals; every seal by it will be refused.' : `Seals it made up to number ${p.last_seq} stay valid; any later one is refused.` };
    } else open = { kind, key };
  });
  const confirmForm = () => act('form', async () => {
    if (!open) return;
    const { kind, key } = open;
    if (kind === 'enroll') await sealingFlows.enroll(key, phrase);
    else await sealingFlows.revoke(key, phrase);
    phrase = '';
    open = null;
  }, open?.kind === 'enroll' ? 'The desktop key is enrolled.' : 'The key is revoked.');
  const forget = () => act('forget', async () => {
    await sealingFlows.forget();
    forgetting = false;
  }, 'This device’s key is forgotten. The phrase adds the device back.');
  const err = (at: string) => (error?.at === at ? error.text : null);
</script>

<section data-testid="sealing">
  <h3>Sealing</h3>
  {#if !session.driver}
    <p class="hint">Connect a brain first.</p>
  {:else if s.status === 'off'}
    {#if !setup}
      <p>
        Sealing makes tampering with what you capture visible. Each capture is signed by a key that lives only on this
        device (and on your YubiKey, if you add it), so an agent working on the brain cannot change a passage, a note, or an
        attached file without Gnomon showing it. Titles, tags, and other details are not covered.
      </p>
      <button onclick={begin} disabled={busy !== null} use:hold={busy === 'begin'} data-testid="seal-begin">Set up sealing</button>
      {#if err('begin')}<p class="error" role="alert">{err('begin')}</p>{/if}
    {:else if step === 'words'}
      <div class="panel" data-testid="seal-words-panel">
        <p><strong>Your recovery phrase.</strong> Write these 24 words on paper, in order, with the fingerprint below.</p>
        <ol class="words" data-testid="seal-words">
          {#each setup.words as w, i (i)}<li><span class="n">{i + 1}</span> <span data-testid="seal-word">{w}</span></li>{/each}
        </ol>
        <p>Root fingerprint: <code data-testid="seal-root-fp">{setup.fingerprint}</code></p>
        <p class="hint">
          The phrase adds a new phone, enrolls your YubiKey, and revokes a lost device. Gnomon does not keep it and cannot
          show it again. Type it only on a phone, never on a computer where agents run.
        </p>
        <div class="row">
          <button class="primary" onclick={() => (step = 'confirm')} data-testid="seal-written">I have written them down</button>
          <button onclick={cancel} data-testid="seal-cancel">Not now</button>
        </div>
      </div>
    {:else}
      <form class="panel" data-testid="seal-confirm" onsubmit={(e) => { e.preventDefault(); if (setup && wordsMatch(setup.words, positions, answers)) void finish(); }}>
        <p>Type three of the words back, from the paper.</p>
        {#each positions as p, i (p)}
          <label>Word {p + 1} <input bind:value={answers[i]} autocomplete="off" autocapitalize="none" spellcheck="false" data-testid="seal-answer" /></label>
        {/each}
        <label>Name this device <input bind:value={label} autocomplete="off" data-testid="seal-label" /></label>
        <div class="row">
          <button class="primary" type="submit" disabled={busy !== null || !wordsMatch(setup.words, positions, answers)} use:hold={busy === 'finish'} data-testid="seal-finish">{busy === 'finish' ? 'Sealing…' : 'Turn sealing on'}</button>
          <button type="button" onclick={() => (step = 'words')} disabled={busy !== null}>Show the words again</button>
          <button type="button" onclick={cancel} disabled={busy !== null}>Not now</button>
        </div>
        {#if err('finish')}<p class="error" role="alert" data-testid="seal-error">{err('finish')}</p>{/if}
      </form>
    {/if}
  {:else if s.status === 'recover'}
    <p data-testid="seal-recover-state">This brain is sealed{#if s.root} (root fingerprint <code>{s.root}</code>){/if}, and this device has no key for it. Type the recovery phrase to add this device.</p>
    <form class="panel" onsubmit={(e) => { e.preventDefault(); void recover(); }}>
      <label>Recovery phrase <textarea bind:value={phrase} rows="3" autocomplete="off" autocapitalize="none" spellcheck="false" data-testid="seal-phrase"></textarea></label>
      <label>Name this device <input bind:value={label} autocomplete="off" data-testid="seal-label" /></label>
      <button class="primary" type="submit" disabled={busy !== null || !phrase.trim()} use:hold={busy === 'recover'} data-testid="seal-recover">{busy === 'recover' ? 'Adding…' : 'Add this device'}</button>
      {#if err('recover')}<p class="error" role="alert" data-testid="seal-error">{err('recover')}</p>{/if}
    </form>
  {:else if s.status === 'mismatch'}
    <p class="error" role="alert" data-testid="seal-mismatch">
      The brain’s root record does not match the root this device trusts ({s.root}). Something changed
      <code>.gnomon/root.json</code>, or this device was set up for another brain of the same name. Do not rely on seals
      until that is explained.
    </p>
  {:else if s.status === 'unenrolled'}
    <p class="error" role="alert" data-testid="seal-unenrolled">This device’s key ({s.device?.fingerprint}) is no longer enrolled in this brain: it was revoked or removed. Forget it here, then add the device again with the phrase.</p>
  {:else}
    <p data-testid="seal-on">Sealing is on. Root fingerprint <code data-testid="seal-root">{s.root}</code>; compare it with your paper card.</p>
    <ul class="keys" data-testid="seal-keys">
      {#each s.keys as k (k.key)}
        <li data-testid="seal-key">
          <span><strong>{k.label}</strong> · {k.device === 'fido' ? 'security key' : k.alg === 'p256' ? 'device key, P-256' : 'device key, Ed25519'} · <code>{k.fingerprint}</code>
            {#if k.thisDevice}<em>(this device)</em>{/if}{#if k.revoked}<em data-testid="seal-revoked">(revoked)</em>{/if}</span>
          {#if !k.thisDevice && !k.revoked}
            <button class="small" onclick={() => openForm('revoke', k.key)} disabled={busy !== null} data-testid="seal-revoke-open">Revoke</button>
          {/if}
          {#if open?.key === k.key && open.kind === 'revoke'}{@render phraseForm('Revoke', open.point)}{/if}
        </li>
      {/each}
    </ul>
    {#if err('revoke-open')}<p class="error" role="alert">{err('revoke-open')}</p>{/if}
    {#each s.requests as r (r.key)}
      <div class="panel" data-testid="seal-request">
        <p>A desktop key asks to be enrolled: <strong>{r.label}</strong>, fingerprint <code data-testid="seal-request-fp">{r.fingerprint}</code>.</p>
        <p class="hint">Enroll it only if this fingerprint matches the one <code>gnomon keys request</code> printed on your computer. An agent can write a request; it cannot make the fingerprints match.</p>
        {#if open?.key === r.key && open.kind === 'enroll'}{@render phraseForm('Enroll')}{:else}
          <button onclick={() => openForm('enroll', r.key)} disabled={busy !== null} data-testid="seal-enroll-open">The fingerprints match</button>
          {#if err('enroll-open')}<p class="error" role="alert">{err('enroll-open')}</p>{/if}
        {/if}
      </div>
    {/each}
    {#if forgetting}
      <div class="confirm" role="alertdialog">
        <p>Forget this device’s key? Its seals stay valid; this device stops sealing until the phrase adds it again.</p>
        <div class="row">
          <button onclick={forget} disabled={busy !== null} use:hold={busy === 'forget'} data-testid="seal-forget-yes">Forget it</button>
          <button class="primary" onclick={() => (forgetting = false)}>Keep it</button>
        </div>
        {#if err('forget')}<p class="error" role="alert">{err('forget')}</p>{/if}
      </div>
    {:else}
      <button onclick={() => (forgetting = true)} disabled={busy !== null} data-testid="seal-forget">Forget this device’s key</button>
    {/if}
  {/if}
  {#if (s.status === 'mismatch' || s.status === 'unenrolled') && session.driver}
    <button onclick={forget} disabled={busy !== null} use:hold={busy === 'forget'} data-testid="seal-forget-yes">Forget this device’s key</button>
    {#if err('forget')}<p class="error" role="alert">{err('forget')}</p>{/if}
  {/if}
  {#if s.error}<p class="hint" data-testid="seal-file-error">Sealing files that did not read: {s.error}</p>{/if}
  {#if done}<p class="ok" role="status" data-testid="seal-done">{done}</p>{/if}
</section>

{#snippet phraseForm(verb: string, note?: string)}
  <form class="panel" data-testid="seal-phrase-form" onsubmit={(e) => { e.preventDefault(); void confirmForm(); }}>
    {#if note}<p class="hint" data-testid="seal-revoke-point">{note}</p>{/if}
    <label>Recovery phrase <textarea bind:value={phrase} rows="3" autocomplete="off" autocapitalize="none" spellcheck="false" data-testid="seal-phrase"></textarea></label>
    <div class="row">
      <button class="primary" type="submit" disabled={busy !== null || !phrase.trim()} use:hold={busy === 'form'} data-testid="seal-phrase-go">{verb}</button>
      <button type="button" onclick={() => { open = null; phrase = ''; }} disabled={busy !== null}>Cancel</button>
    </div>
    {#if err('form')}<p class="error" role="alert" data-testid="seal-error">{err('form')}</p>{/if}
  </form>
{/snippet}

<style>
  section { margin-bottom: 1.75rem; }
  .row { display: flex; gap: 0.5rem; flex-wrap: wrap; margin: 0.5rem 0; }
  .words { columns: 2; column-gap: 1.5rem; padding-left: 0; list-style: none; margin: 0.5rem 0; }
  .words li { break-inside: avoid; padding: 0.1rem 0; font-family: var(--mono, monospace); }
  .words .n { display: inline-block; min-width: 1.6rem; text-align: right; color: var(--muted, inherit); }
  .keys { list-style: none; padding-left: 0; }
  .keys li { margin: 0.4rem 0; display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; overflow-wrap: anywhere; }
  .confirm { flex-direction: column; align-items: stretch; }
  textarea { width: 100%; max-width: 24rem; display: block; margin-top: 0.25rem; }
  label { margin: 0.5rem 0; display: block; }
</style>
