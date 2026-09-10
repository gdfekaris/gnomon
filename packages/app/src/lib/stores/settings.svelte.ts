// settings — spec §10.2, §10.3. Persisted through idb-keyval under the
// spec's keys. No brain content ever lands here.

import { get, set, del } from 'idb-keyval';

export interface GitSettings { token: string; owner: string; name: string; }
export interface Prefs {
  theme: 'system' | 'light' | 'dark';
  /** the visual skin (block 4): three late-1980s GUIs, Monochrome by default */
  skin: 'mono' | 'bevel' | 'workbench';
  budgetPercent: number;
  setDescriptionPlacement: 'context' | 'system';
  lastSelectedSets: string[];
  /** the last driver mode; 'demo' reconnects the demo brain at launch */
  mode: 'github' | 'demo' | null;
}

const DEFAULT_PREFS: Prefs = { theme: 'system', skin: 'mono', budgetPercent: 60, setDescriptionPlacement: 'context', lastSelectedSets: [], mode: null };

export const settings = $state({
  loaded: false,
  git: null as GitSettings | null,
  anthropicKey: '',
  openrouterKey: '',
  prefs: { ...DEFAULT_PREFS } as Prefs,
});

const hasIdb = () => typeof indexedDB !== 'undefined';

export async function loadSettings(): Promise<void> {
  if (hasIdb()) {
    try {
      const [token, repo, anthropic, openrouter, prefs] = await Promise.all([
        get<string>('git.token'), get<{ owner: string; name: string }>('git.repo'),
        get<string>('provider.anthropic.key'), get<string>('provider.openrouter.key'), get<Partial<Prefs>>('prefs'),
      ]);
      settings.git = token && repo ? { token, owner: repo.owner, name: repo.name } : null;
      settings.anthropicKey = anthropic ?? '';
      settings.openrouterKey = openrouter ?? '';
      settings.prefs = { ...DEFAULT_PREFS, ...(prefs ?? {}) };
      applyTheme(settings.prefs.theme, settings.prefs.skin);
    } catch {
      // a blocked or evicted store means "signed out" (spec §10.3)
    }
  }
  settings.loaded = true;
}

export async function saveGit(git: GitSettings | null): Promise<void> {
  settings.git = git;
  if (!hasIdb()) return;
  if (git) {
    await set('git.token', git.token);
    await set('git.repo', { owner: git.owner, name: git.name });
  } else {
    await del('git.token');
    await del('git.repo');
  }
}

export async function saveProviderKeys(keys: { anthropic?: string; openrouter?: string }): Promise<void> {
  if (keys.anthropic !== undefined) settings.anthropicKey = keys.anthropic;
  if (keys.openrouter !== undefined) settings.openrouterKey = keys.openrouter;
  if (!hasIdb()) return;
  if (keys.anthropic !== undefined) await (keys.anthropic ? set('provider.anthropic.key', keys.anthropic) : del('provider.anthropic.key'));
  if (keys.openrouter !== undefined) await (keys.openrouter ? set('provider.openrouter.key', keys.openrouter) : del('provider.openrouter.key'));
}

export async function savePrefs(patch: Partial<Prefs>): Promise<void> {
  settings.prefs = { ...settings.prefs, ...patch };
  applyTheme(settings.prefs.theme, settings.prefs.skin);
  // $state proxies cannot be structured-cloned into IndexedDB; store a plain copy.
  if (hasIdb()) await set('prefs', $state.snapshot(settings.prefs));
}

/** Theme: `system` follows the OS; light and dark are forced through `data-theme` and `color-scheme`. The skin rides on `data-skin`. */
export function applyTheme(theme: Prefs['theme'], skin: Prefs['skin'] = 'mono'): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset['theme'];
  else root.dataset['theme'] = theme;
  root.style.colorScheme = theme === 'system' ? 'light dark' : theme;
  root.dataset['skin'] = skin;
}
