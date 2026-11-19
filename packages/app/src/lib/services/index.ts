// The app's single BrainService, bound to the snapshot store, plus the two
// ways to connect: the demo brain and a GitHub repository. Both compose the
// driver stack of spec §4: the encrypting wrapper over the plain driver when
// the brain carries `.gnomon/encryption.json`, the plain driver otherwise.
// The encryption flows below are the glue between the framework-free
// service and the session store; the stack itself lives here, since it holds
// class instances the stores would not make reactive anyway.
import { del, get, set } from 'idb-keyval';
import { CachingDriver, type CopyStore, GitHubDriver, type KeyStore, LockedError, type StorageDriver } from '@gnomon/storage';
import { makeRequest } from '@gnomon/core';
import { DEMO_YUBIKEY_PUB, demoDriver } from '../demo/fixture';
import { session } from '../stores/session.svelte';
import { snapshot } from '../stores/snapshot.svelte';
import { type GitSettings, savePrefs } from '../stores/settings.svelte';
import { BrainService } from './brain';
import * as enc from './encryption';
import * as seal from './sealing';
import { type CopyDiagnostics, idbCopyStore, safeCopyStore } from './localcopy';
import { describeError } from './errors';
export { describeError };

export const brain = new BrainService(snapshot);

// Spec §10.3: the device key is a non-extractable CryptoKey, which structured-clones into IndexedDB and
// nowhere else, so the remembered key never goes through the settings mirror in localStorage.
const keyStore: KeyStore | null = typeof indexedDB === 'undefined' ? null : { get, set, del };

// Spec §6.5, §10.3: this device's sealing key per brain, non-extractable, in IndexedDB; the demo brain's only in the tab.
const githubSealStore: seal.SealStore = typeof indexedDB === 'undefined' ? seal.memorySealStore() : seal.idbSealStore({ get, set, del });
let sealing: Omit<seal.SealingContext, 'plain' | 'driver' | 'state'> | null = null;
brain.captureSealer = seal.captureSealer(() => (sealing && stack ? sealingContext() : null));
brain.sealer = seal.commitSealer(() => (sealing && stack ? sealingContext() : null));
brain.onLoad(() => {
  // A brain just opened from the copy is verified from the copy too, so launch asks the repository nothing.
  if (sealing && stack) void seal.loadSealing(sealingContext(snapshot.fromCopy));
});

/** What went wrong last with the copy on this device, for Settings → About. */
export const copyDiagnostics: CopyDiagnostics = { error: null };
let copyStore: Promise<CopyStore | null> | null = null;
const openCopyStore = (): Promise<CopyStore | null> =>
  (copyStore ??= idbCopyStore().then((s) => (s ? safeCopyStore(s, copyDiagnostics) : null), () => null));
/** The caching driver of the session, when the brain keeps a copy on this device (spec §6.6). */
let copy: CachingDriver | null = null;
const DIGESTS = (id: string) => `${id}|digests`;

let stack: enc.Stack | null = null;
/** The composed drivers of the session, for the encryption flows and diagnostics. */
export const encryptionStack = (): enc.Stack | null => stack;

/**
 * Compose the stack over a plain driver, record the session, and load the
 * brain; a locked brain leaves the sheet to ask. When this device holds a
 * copy of the brain (spec §6.6) it opens from the copy first, with no
 * request, and the repository is checked afterwards, off the critical path.
 */
async function attach(plain: StorageDriver, mode: 'github' | 'demo', label: string): Promise<void> {
  const open = async (fromCopy: boolean): Promise<void> => {
    stack = await enc.composeStack(plain, keyStore, session.encryption, fromCopy);
    session.sealing = seal.emptySealing();
    sealing = { brain, cache: seal.newSealCache(), store: mode === 'demo' ? seal.memorySealStore() : githubSealStore, brainId: mode === 'demo' ? 'demo' : label };
    await keepDigests(sealing.cache, label);
    session.driver = stack.driver;
    session.mode = mode;
    session.label = label;
    session.connectError = null;
    try {
      await brain.connect(stack.driver, { local: stack.local, fromCopy });
    } catch (e) {
      if (!(e instanceof LockedError)) throw e;
      session.encryption.locked = true;
      await seal.loadSealing(sealingContext(fromCopy));
    }
  };
  let opened = false;
  if (copy && (await copy.hasCopy())) {
    try {
      await open(true);
      opened = true;
    } catch {
      // the copy could not answer everything (a file it never held); ask the repository
    }
  }
  if (!opened) await open(false);
  await savePrefs({ mode });
  if (opened) void checkRepository();
  if (copy) void copy.prune().catch(() => undefined);
}

/** Attachment digests are kept with the copy, by blob id, so verification on a later launch does not download each file again. */
async function keepDigests(cache: seal.SealCache, id: string): Promise<void> {
  const store = copy ? await openCopyStore() : null;
  if (!store) return;
  const held = ((await store.get(DIGESTS(id))) as Record<string, string> | undefined) ?? {};
  for (const [sha, d] of Object.entries(held)) cache.digests.set(sha, d);
  cache.onDigest = () => void store.setMany([[DIGESTS(id), Object.fromEntries(cache.digests)]]);
}

let lastCheck = 0;
/**
 * Ask the repository for anything newer than what is on screen (spec §6.6):
 * after opening from the copy, and whenever the app comes back to the
 * front. With the copy this is the head, the tree, and only the files that
 * changed. Quiet: an unreachable repository leaves the open brain as it is.
 */
export async function checkRepository(minGapMs = 0): Promise<void> {
  if (!stack || !brain.connected || session.encryption.locked || session.mode !== 'github') return;
  if (Date.now() - lastCheck < minGapMs) return;
  lastCheck = Date.now();
  try {
    await brain.refresh();
  } catch {
    // offline, or a failure the next action will name beside its own control
  }
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
  copy = null;
  await attach(await demoDriver(omit, fill, reserveFill, extra), 'demo', 'demo brain');
}

export async function connectGitHub(git: GitSettings): Promise<void> {
  const label = `${git.owner}/${git.name}`;
  const github = new GitHubDriver({ owner: git.owner, name: git.name, token: git.token });
  const store = await openCopyStore();
  copy = store ? new CachingDriver(github, store, label) : null;
  await attach(copy ?? github, 'github', label);
}

/**
 * Reopen the saved GitHub connection, at launch or from the notice a failed
 * launch leaves. A failure is kept as one sentence for the screens and for
 * Settings → About, so "not connected" always says why.
 */
export async function reconnect(git: GitSettings): Promise<void> {
  try {
    await connectGitHub(git);
    session.connectError = null;
  } catch (e) {
    session.connectError = describeError(e);
    throw e;
  }
}

/** Disconnecting drops the copy of the brain from this device, with the session. */
export function disconnect(): void {
  void copy?.forget().catch(() => undefined);
  copy = null;
  brain.disconnect();
  stack = null;
  session.driver = null;
  session.mode = null;
  session.label = '';
  session.connectError = null;
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
  async unlock(passphrase: string, remember = false): Promise<void> {
    await enc.unlockBrain(brain, current(), session.encryption, passphrase, remember);
    if (snapshot.fromCopy) void checkRepository();
  },
  lock: () => enc.lockBrain(brain, current(), session.encryption),
  forget: () => enc.forgetOnDevice(brain, current(), session.encryption),
};

function sealingContext(fromCopy = false): seal.SealingContext {
  if (!sealing || !stack) throw new Error('no brain is connected');
  // The drivers follow the stack (encryption on or off); the state object is the session's, re-read each time: Svelte's proxy is what the screens watch.
  // `fromCopy` reads the sealing files from the copy on this device alone, for a brain just opened from it.
  const view = fromCopy && stack.local ? { plain: (stack.plain as CachingDriver).copyOnly, driver: stack.local } : { plain: stack.plain, driver: stack.driver };
  return { ...sealing, ...view, state: session.sealing };
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
  sealAsMine: (stem: string) => seal.sealAsMine(sealingContext(), stem),
  sealExisting: () => seal.sealExisting(sealingContext()),
  acceptPrinciples: () => seal.acceptPrinciples(sealingContext()),
  sealSourceAsMine: (slug: string) => seal.sealSourceAsMine(sealingContext(), slug),
};
