// snapshot — spec §10.2: the parsed brain at a known head, plus `stale`
// when the remote head has moved under us.
import type { BrainSnapshot } from '@gnomon/core';

export const snapshot = $state({
  current: null as BrainSnapshot | null,
  stale: false,
  loading: false,
  error: null as string | null,
});
