// The app's single BrainService, bound to the snapshot store, plus the two
// ways to connect: the demo brain and a GitHub repository. Both compose the
// driver stack of spec §4: the encrypting wrapper over the plain driver when
// the brain carries `.gnomon/encryption.json`, the plain driver otherwise.
// The encryption flows below are the glue between the framework-free
// service and the session store; the stack itself lives here, since it holds
// class instances the stores would not make reactive anyway.
import { del, get, set } from 'idb-keyval';
import { GitHubDriver, type KeyStore, LockedError, type StorageDriver } from '@gnomon/storage';
import { makeRequest } from '@gnomon/core';
import { DEMO_YUBIKEY_PUB, demoDriver } from '../demo/fixture';
import { session } from '../stores/session.svelte';
import { snapshot } from '../stores/snapshot.svelte';
import { type GitSettings, savePrefs } from '../stores/settings.svelte';
import { BrainService } from './brain';
import * as enc from './encryption';
import * as seal from './sealing';
export { describeError } from './errors';

export const brain = new BrainService(snapshot);

// Spec §10.3: the device key is a non-extractable CryptoKey, which structured-clones into IndexedDB and
// nowhere else, so the remembered key never goes through the settings mirror in localStorage.
const keyStore: KeyStore | null = typeof indexedDB === 'undefined' ? null : { get, set, del };

// Spec §6.5, §10.3: this device's sealing key per brain, non-extractable, in IndexedDB; the demo brain's only in the tab.
const githubSealStore: seal.SealStore = typeof indexedDB === 'undefined' ? seal.memorySealStore() : seal.idbSealStore({ get, set, del });
let sealing: seal.SealingContext | null = null;

let stack: enc.Stack | null = null;
/** The composed drivers of the session, for the encryption flows and diagnostics. */
export const encryptionStack = (): enc.Stack | null => stack;

/** Compose the stack over a plain driver, record the session, and load the brain; a locked brain leaves the sheet to ask. */
async function attach(plain: StorageDriver, mode: 'github' | 'demo', label: string): Promise<void> {
  stack = await enc.composeStack(plain, keyStore, session.encryption);
  session.sealing = seal.emptySealing();
  sealing = { brain, plain, store: mode === 'demo' ? seal.memorySealStore() : githubSealStore, brainId: mode === 'demo' ? 'demo' : label, state: session.sealing };
  session.driver = stack.driver;
  session.mode = mode;
  session.label = label;
  await savePrefs({ mode });
  try {
    await brain.connect(stack.driver);
  } catch (e) {
    if (!(e instanceof LockedError)) throw e;
    session.encryption.locked = true;
  }
  await seal.loadSealing(sealing);
}

/**
 * `omit` drops paths from the demo brain, `fill` adds generated sources, `reserveFill` generated reserve principles,
 * `sealRequest` a pending desktop-key request; test affordances (`#/settings?demo-omit=a,b`, `?demo-fill=n`, `?reserve-fill=n`, `?seal-request=1`).
 */
export async function connectDemo(omit: string[] = [], fill = 0, reserveFill = 0, sealRequest = false): Promise<void> {
  const extra = new Map<string, string>();
  if (sealRequest) {
    const r = await makeRequest({ pub: DEMO_YUBIKEY_PUB, label: 'YubiKey', at: '2026-10-05T12:00:00Z' });
    extra.set(r.path, r.text);
  }
  await attach(await demoDriver(omit, fill, reserveFill, extra), 'demo', 'demo brain');
}

export async function connectGitHub(git: GitSettings): Promise<void> {
  await attach(new GitHubDriver({ owner: git.owner, name: git.name, token: git.token }), 'github', `${git.owner}/${git.name}`);
}

export function disconnect(): void {
  brain.disconnect();
  stack = null;
  session.driver = null;
  session.mode = null;
  session.label = '';
  session.encryption = { enabled: false, locked: false, storeError: null };
  session.sealing = seal.emptySealing();
  sealing = null;
  void savePrefs({ mode: null });
}

function current(): enc.Stack {
  if (!stack) throw new Error('no brain is connected');
  return stack;
}

/** The encryption flows of spec §6.4 on the connected brain; each swaps the session's driver when the stack changes. */
export const encryption = {
  async enable(passphrase: string, opts: enc.KeyOptions = {}): Promise<number> {
    const r = await enc.enableEncryption(brain, current(), session.encryption, passphrase, opts);
    stack = r.stack;
    session.driver = r.stack.driver;
    return r.files;
  },
  async disable(): Promise<number> {
    const r = await enc.disableEncryption(brain, current(), session.encryption);
    stack = r.stack;
    session.driver = r.stack.driver;
    return r.files;
  },
  async changePassphrase(passphrase: string, opts: enc.KeyOptions = {}): Promise<number> {
    const r = await enc.changePassphrase(brain, current(), session.encryption, passphrase, opts);
    stack = r.stack;
    return r.files;
  },
  unlock: (passphrase: string, remember = false) => enc.unlockBrain(brain, current(), session.encryption, passphrase, remember),
  lock: () => enc.lockBrain(brain, current(), session.encryption),
  forget: () => enc.forgetOnDevice(brain, current(), session.encryption),
};

function sealingContext(): seal.SealingContext {
  if (!sealing) throw new Error('no brain is connected');
  // The state object is the session's, re-read each time: Svelte's proxy is what the screens watch.
  return { ...sealing, state: session.sealing };
}

/** The sealing flows of spec §6.5 on the connected brain (block S3: keys; seals come in S4). */
export const sealingFlows = {
  begin: seal.beginSetup,
  finishSetup: (entropy: Uint8Array, label: string) => seal.finishSetup(sealingContext(), entropy, label),
  recover: (phrase: string, label: string) => seal.recoverDevice(sealingContext(), phrase, label),
  enroll: (key: string, phrase: string) => seal.enrollRequest(sealingContext(), key, phrase),
  revocationPoint: (key: string) => seal.revocationPoint(sealingContext(), key),
  revoke: (key: string, phrase: string) => seal.revokeKey(sealingContext(), key, phrase),
  forget: () => seal.forgetDeviceKey(sealingContext()),
  reload: () => seal.loadSealing(sealingContext()),
};
