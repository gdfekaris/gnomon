// The captures waiting to be saved (spec §14), kept on the device, and the
// moments the app tries again: the connection returning, the app coming
// back to the front, a brain connecting.
import { brain, checkRepository } from '../services/index';
import { OfflineQueue, type PendingState, localQueueStore } from '../services/offline';

export const deviceStorage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export const pending = $state<PendingState>({ queue: [], flushed: null });
export const offlineQueue = new OfflineQueue(pending, undefined, localQueueStore(deviceStorage()));
export const network = $state({ online: typeof navigator === 'undefined' ? true : navigator.onLine });

/** Save whatever is waiting, quietly; a capture that fails keeps its reason on itself. */
export function flushPending(): void {
  if (offlineQueue.hasPending) void offlineQueue.flush(brain).catch(() => undefined);
}

/** Coming back to the front is checked at most this often. */
const RETURN_GAP_MS = 15_000;

export function watchNetwork(): void {
  if (typeof window === 'undefined') return;
  const sync = () => {
    network.online = navigator.onLine;
    if (network.online) flushPending();
  };
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  // Returning to the app: another device or a desktop session may have committed since (spec §6.6).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    network.online = navigator.onLine;
    if (network.online) void checkRepository(RETURN_GAP_MS).then(flushPending);
  });
}
