// session — spec §10.2: the composed driver stack and whether the brain is unlocked.
import type { StorageDriver } from '@gnomon/storage';

export const session = $state({
  driver: null as StorageDriver | null,
  mode: null as 'github' | 'demo' | null,
  /** a label for the connected brain: "owner/name" or "demo brain" */
  label: '',
  unlocked: true,
});
