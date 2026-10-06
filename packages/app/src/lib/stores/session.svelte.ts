// session — spec §10.2: the composed driver stack and whether the brain is unlocked.
import type { StorageDriver } from '@gnomon/storage';
import type { EncryptionState } from '../services/encryption';
import { type SealingState, emptySealing } from '../services/sealing';

export const session = $state({
  driver: null as StorageDriver | null,
  mode: null as 'github' | 'demo' | null,
  /** a label for the connected brain: "owner/name" or "demo brain" */
  label: '',
  /** spec §6.4: whether `.gnomon/encryption.json` exists, whether this process holds the key, and the last key-store failure */
  encryption: { enabled: false, locked: false, storeError: null } as EncryptionState,
  /** spec §6.5: whether sealing is set up, this device's key, the enrolled keys, pending desktop requests */
  sealing: emptySealing() as SealingState,
});
