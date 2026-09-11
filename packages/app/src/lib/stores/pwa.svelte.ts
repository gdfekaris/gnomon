// Service worker registration (spec §11): registerType 'prompt', so a new
// version shows a toast and never reloads mid-edit. Vite's PWA plugin only
// registers a worker in production builds; in dev these stay inert.
//
// An installed iPhone app is launched, not navigated, so the browser's own
// update check can go unnoticed for a long time; the app therefore asks
// for one whenever it comes to the foreground, on a timer, and on demand
// from Settings, and says when nothing newer exists.
import { registerSW } from 'virtual:pwa-register';

export const pwa = $state({ needRefresh: false, offlineReady: false, checking: false, lastCheck: null as 'current' | 'update' | 'failed' | null });

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

/** Ask the browser to fetch the worker script now; a newer one arrives as onNeedRefresh. */
export async function checkForUpdate(): Promise<void> {
  if (!registration || pwa.checking) return;
  pwa.checking = true;
  try {
    await registration.update();
    if (!registration.installing && !registration.waiting) pwa.lastCheck = pwa.needRefresh ? 'update' : 'current';
  } catch {
    pwa.lastCheck = 'failed';
  } finally {
    pwa.checking = false;
  }
}

/** Activate the waiting worker and reload. */
export async function applyUpdate(): Promise<void> {
  pwa.needRefresh = false;
  await update?.(true);
}
