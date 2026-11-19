// snapshot — spec §10.2: the parsed brain at a known head, plus `stale`
// when the remote head has moved under us.
import type { BrainSnapshot } from '@gnomon/core';

export const snapshot = $state({
  current: null as BrainSnapshot | null,
  stale: false,
  loading: false,
  error: null as string | null,
  /** opened from the copy on this device, not yet checked against the repository */
  fromCopy: false,
  /** how long the last open, check, and save took (Settings → About) */
  timings: { open: null, refreshMs: null, commitMs: null } as import('../services/brain').Timings,
});
