// settings — spec §10.2, §10.3. Persisted on the device through
// `services/persist.ts` (IndexedDB under the spec's keys, with a
// localStorage mirror for launches where IndexedDB fails). No brain
// content ever lands here.

import { get, set, del } from 'idb-keyval';
import { SettingsPersistence, type StorageDiagnostics } from '../services/persist';

export interface GitSettings { token: string; owner: string; name: string; }
export interface Prefs {
  /** the theme of the skin; chosen with it in one picker, never taken from the OS (2026-09-12) */
  theme: 'light' | 'dark';
  /** the visual skin (block 4): four late-1980s GUIs, Monochrome dark by default */
  skin: 'mono' | 'bevel' | 'workbench' | 'synthwave';
  budgetPercent: number;
  setDescriptionPlacement: 'context' | 'system';
  lastSelectedSets: string[];
  /** the last driver mode; 'demo' reconnects the demo brain at launch */
  mode: 'github' | 'demo' | null;
  /** the AI provider picked last, restored at launch while its key is saved */
  provider: 'mock' | 'anthropic' | 'openrouter';
  /** how Browse orders the sources: by filing date, newest first by default, or grouped by author */
  browseSort: 'newest' | 'oldest' | 'author';
}

const DEFAULT_PREFS: Prefs = { theme: 'dark', skin: 'mono', budgetPercent: 60, setDescriptionPlacement: 'context', lastSelectedSets: [], mode: null, provider: 'mock', browseSort: 'newest' };

export const settings = $state({
  loaded: false,
  git: null as GitSettings | null,
  anthropicKey: '',
  openrouterKey: '',
  prefs: { ...DEFAULT_PREFS } as Prefs,
  /** where settings came from at launch and the last storage failure (shown in Settings → About) */
  storage: { source: 'none', error: null, persistent: null as boolean | null } as StorageDiagnostics & { persistent: boolean | null },
});

const hasIdb = () => typeof indexedDB !== 'undefined';
const mirror = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};
const store = new SettingsPersistence(hasIdb() ? { get, set, del } : null, mirror());

export async function loadSettings(): Promise<void> {
  const saved = await store.readAll();
  const token = saved['git.token'] as string | undefined;
  const repo = saved['git.repo'] as { owner: string; name: string } | undefined;
  settings.git = token && repo ? { token, owner: repo.owner, name: repo.name } : null;
  settings.anthropicKey = (saved['provider.anthropic.key'] as string | undefined) ?? '';
  settings.openrouterKey = (saved['provider.openrouter.key'] as string | undefined) ?? '';
  settings.prefs = { ...DEFAULT_PREFS, ...((saved['prefs'] as Partial<Prefs> | undefined) ?? {}) };
  // A device that saved "follow the system" before the picker changed lands on the default theme.
  if (settings.prefs.theme !== 'light' && settings.prefs.theme !== 'dark') settings.prefs.theme = DEFAULT_PREFS.theme;
  applyTheme(settings.prefs.theme, settings.prefs.skin);
  settings.storage = { ...store.diagnostics, persistent: null };
  settings.loaded = true;
  // Ask the browser not to evict this origin's storage under pressure (best effort; iOS decides for itself).
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) settings.storage.persistent = await navigator.storage.persist();
  } catch {
    // unsupported: stays null
  }
}

async function write(key: Parameters<SettingsPersistence['write']>[0], value: unknown): Promise<void> {
  await store.write(key, value);
  settings.storage.error = store.diagnostics.error;
}

export async function saveGit(git: GitSettings | null): Promise<void> {
  settings.git = git;
  await write('git.token', git?.token);
  await write('git.repo', git ? { owner: git.owner, name: git.name } : undefined);
}

export async function saveProviderKeys(keys: { anthropic?: string; openrouter?: string }): Promise<void> {
  if (keys.anthropic !== undefined) {
    settings.anthropicKey = keys.anthropic;
    await write('provider.anthropic.key', keys.anthropic || undefined);
  }
  if (keys.openrouter !== undefined) {
    settings.openrouterKey = keys.openrouter;
    await write('provider.openrouter.key', keys.openrouter || undefined);
  }
}

export async function savePrefs(patch: Partial<Prefs>): Promise<void> {
  settings.prefs = { ...settings.prefs, ...patch };
  applyTheme(settings.prefs.theme, settings.prefs.skin);
  // $state proxies cannot be structured-cloned into IndexedDB; store a plain copy.
  await write('prefs', $state.snapshot(settings.prefs));
}

/** The look: the skin rides on `data-skin`, its theme on `data-theme` and `color-scheme`. The OS is never consulted. */
export function applyTheme(theme: Prefs['theme'], skin: Prefs['skin'] = 'mono'): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset['theme'] = theme;
  root.style.colorScheme = theme;
  root.dataset['skin'] = skin;
}
