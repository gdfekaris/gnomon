// The one pending offline capture (spec §14), in memory only.
import { brain } from '../services/index';
import { OfflineQueue, type PendingState } from '../services/offline';

export const pending = $state<PendingState>({ pending: null, flushed: null, flushError: null });
export const offlineQueue = new OfflineQueue(pending);
export const network = $state({ online: typeof navigator === 'undefined' ? true : navigator.onLine });

export function watchNetwork(): void {
  if (typeof window === 'undefined') return;
  const sync = () => {
    network.online = navigator.onLine;
    if (network.online) void offlineQueue.flush(brain).catch(() => undefined);
  };
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
}
