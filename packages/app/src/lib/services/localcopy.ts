// The copy of the brain on this device (spec §6.6, §10.3): the store under
// the caching driver. IndexedDB, in its own database so that dropping the
// copy never touches the settings or the keys. iOS has been seen to make
// IndexedDB throw, hang, or come back empty at launch (see persist.ts), so
// every call here is bounded and a failure reads as "not in the copy": the
// app then asks the repository, exactly as it did before there was a copy.

import { createStore, delMany, get, getMany, keys, setMany } from 'idb-keyval';
import type { CopyStore } from '@gnomon/storage';

const TIMEOUT_MS = 2500;

function bounded<T>(work: () => Promise<T>, fallback: T, note: (e: unknown) => void): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => {
      note(new Error(`the local copy did not answer within ${TIMEOUT_MS} ms`));
      resolve(fallback);
    }, TIMEOUT_MS);
    work().then(
      (v) => { clearTimeout(t); resolve(v); },
      (e: unknown) => { clearTimeout(t); note(e); resolve(fallback); },
    );
  });
}

export interface CopyDiagnostics { error: string | null }

/** Wrap a store so it never throws and never hangs; what went wrong last is kept for Settings → About. */
export function safeCopyStore(inner: CopyStore, diagnostics: CopyDiagnostics): CopyStore {
  const note = (e: unknown) => { diagnostics.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e); };
  return {
    get: (k) => bounded(() => inner.get(k), undefined, note),
    getMany: (ks) => bounded(() => inner.getMany(ks), ks.map(() => undefined), note),
    setMany: (es) => bounded(() => inner.setMany(es), undefined, note),
    delMany: (ks) => bounded(() => inner.delMany(ks), undefined, note),
    keys: () => bounded(() => inner.keys(), [], note),
  };
}

/** The IndexedDB store, or null where there is no IndexedDB (then nothing is kept and the app works as before). */
export async function idbCopyStore(): Promise<CopyStore | null> {
  if (typeof indexedDB === 'undefined') return null;
  const db = createStore('gnomon-copy', 'kv');
  return {
    get: (k) => get(k, db),
    getMany: (ks) => getMany(ks, db),
    setMany: (es) => setMany(es as Array<[IDBValidKey, unknown]>, db),
    delMany: (ks) => delMany(ks, db),
    keys: async () => (await keys(db)).filter((k): k is string => typeof k === 'string'),
  };
}
