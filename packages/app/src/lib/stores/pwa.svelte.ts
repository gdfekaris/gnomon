// Service worker registration (spec §11): registerType 'prompt', so a new
// version shows a toast and never reloads mid-edit. Vite's PWA plugin only
// registers a worker in production builds; in dev these stay inert.
import { registerSW } from 'virtual:pwa-register';

export const pwa = $state({ needRefresh: false, offlineReady: false });

let update: ((reload?: boolean) => Promise<void>) | undefined;

export function startServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  update = registerSW({
    onNeedRefresh: () => { pwa.needRefresh = true; },
    onOfflineReady: () => { pwa.offlineReady = true; },
  });
}

/** Activate the waiting worker and reload. */
export async function applyUpdate(): Promise<void> {
  pwa.needRefresh = false;
  await update?.(true);
}
