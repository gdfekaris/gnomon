// Service worker registration (spec §11): registerType 'prompt', so a new
// version shows a toast and never reloads mid-edit. Vite's PWA plugin only
// registers a worker in production builds; in dev these stay inert.
//
// An installed iPhone app is launched, not navigated, so the browser's own
// update check can go unnoticed for a long time; the app therefore asks
// for one whenever it comes to the foreground, on a timer, and on demand
// from Settings, and says when nothing newer exists.
import { registerSW } from 'virtual:pwa-register';

/** What the last update check found; every check ends in one of these so the Settings button always answers. */
export type UpdateCheck = 'current' | 'installing' | 'update' | 'failed' | 'unavailable';

export const pwa = $state({ needRefresh: false, offlineReady: false, checking: false, applying: false, lastCheck: null as UpdateCheck | null });

export const UPDATE_CHECK_TEXT: Record<UpdateCheck, string> = {
  current: 'No update: this is the latest build.',
  installing: 'A newer build is downloading; it will offer itself in a moment.',
  update: 'A newer build is ready.',
  failed: 'Could not check; you may be offline.',
  unavailable: 'This browser is not running Gnomon through its service worker, so it picks up new builds on reload.',
};

let update: ((reload?: boolean) => Promise<void>) | undefined;
let registration: ServiceWorkerRegistration | undefined;
const CHECK_EVERY_MS = 15 * 60 * 1000;

export function startServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  update = registerSW({
    onNeedRefresh: () => { pwa.needRefresh = true; pwa.lastCheck = 'update'; },
    onOfflineReady: () => { pwa.offlineReady = true; },
    onRegisteredSW: (_url, r) => {
      registration = r;
      setInterval(() => void checkForUpdate(), CHECK_EVERY_MS);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void checkForUpdate(); });
    },
  });
}

/**
 * Ask the browser to fetch the worker script now; a newer one arrives as
 * onNeedRefresh. The result is always recorded: the maintainer pressed the
 * button on a current build and nothing said so, because the outcome was
 * only written when the registration had been caught at startup and no
 * worker was mid-install.
 */
export async function checkForUpdate(): Promise<void> {
  if (pwa.checking) return;
  pwa.checking = true;
  try {
    if (!registration && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      registration = (await navigator.serviceWorker.getRegistration()) ?? undefined;
    }
    if (!registration) {
      pwa.lastCheck = 'unavailable';
      return;
    }
    await registration.update();
    pwa.lastCheck = pwa.needRefresh || registration.waiting ? 'update' : registration.installing ? 'installing' : 'current';
  } catch {
    pwa.lastCheck = 'failed';
  } finally {
    pwa.checking = false;
  }
}

/** Activate the waiting worker and reload. */
export async function applyUpdate(): Promise<void> {
  pwa.needRefresh = false;
  pwa.applying = true;
  try {
    await update?.(true);
  } finally {
    pwa.applying = false;
  }
}
