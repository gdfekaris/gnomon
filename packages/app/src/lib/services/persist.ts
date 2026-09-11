// On-device settings storage (spec §10.2, §10.3). IndexedDB through
// idb-keyval, under the spec's keys, is the store of record; a localStorage
// mirror is written first on every save and read whenever IndexedDB throws,
// hangs, or comes back empty. iOS home-screen web apps have been seen to do
// all three on launch, which showed as the app forgetting its connection.
// Framework-free so it runs under vitest; the Svelte store wraps it.

export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

export interface StorageDiagnostics {
  /** where the settings came from at launch */
  source: 'indexeddb' | 'mirror' | 'none';
  /** the last IndexedDB failure, in its own words, or null */
  error: string | null;
}

export const SETTINGS_KEYS = ['git.token', 'git.repo', 'provider.anthropic.key', 'provider.openrouter.key', 'prefs'] as const;
export type SettingsKey = (typeof SETTINGS_KEYS)[number];
export type SettingsRecord = Partial<Record<SettingsKey, unknown>>;

const MIRROR_PREFIX = 'gnomon.settings.';
const READ_TIMEOUT_MS = 4000;
const READ_ATTEMPTS = 3;

const describe = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`IndexedDB did not answer within ${ms} ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e: unknown) => { clearTimeout(t); reject(e); });
  });
}

export class SettingsPersistence {
  readonly diagnostics: StorageDiagnostics = { source: 'none', error: null };

  constructor(private readonly idb: KV | null, private readonly mirror: Storage | null) {}

  /** Everything saved, from IndexedDB when it answers with content, else from the mirror. */
  async readAll(): Promise<SettingsRecord> {
    let fromIdb: SettingsRecord | null = null;
    if (this.idb) {
      for (let attempt = 0; attempt < READ_ATTEMPTS && fromIdb === null; attempt++) {
        try {
          fromIdb = await withTimeout(this.readIdb(), READ_TIMEOUT_MS);
        } catch (e) {
          this.diagnostics.error = describe(e);
          if (attempt + 1 < READ_ATTEMPTS) await sleep(150 * (attempt + 1));
        }
      }
    }
    const mirrored = this.readMirror();
    if (fromIdb && Object.keys(fromIdb).length) {
      this.diagnostics.source = 'indexeddb';
      return fromIdb;
    }
    if (Object.keys(mirrored).length) {
      this.diagnostics.source = 'mirror';
      if (fromIdb) this.diagnostics.error ??= 'IndexedDB answered but held nothing; the mirror did';
      return mirrored;
    }
    this.diagnostics.source = fromIdb ? 'indexeddb' : 'none';
    return {};
  }

  /** Save one key (or delete it with `undefined`): the mirror first, then IndexedDB, whose failure is recorded, not thrown. */
  async write(key: SettingsKey, value: unknown): Promise<void> {
    if (this.mirror) {
      try {
        if (value === undefined) this.mirror.removeItem(MIRROR_PREFIX + key);
        else this.mirror.setItem(MIRROR_PREFIX + key, JSON.stringify(value));
      } catch {
        // a full or blocked localStorage: IndexedDB below is still tried
      }
    }
    if (!this.idb) return;
    try {
      if (value === undefined) await this.idb.del(key);
      else await this.idb.set(key, value);
    } catch (e) {
      this.diagnostics.error = describe(e);
    }
  }

  private async readIdb(): Promise<SettingsRecord> {
    const values = await Promise.all(SETTINGS_KEYS.map((k) => this.idb!.get<unknown>(k)));
    const out: SettingsRecord = {};
    SETTINGS_KEYS.forEach((k, i) => { if (values[i] !== undefined) out[k] = values[i]; });
    return out;
  }

  private readMirror(): SettingsRecord {
    const out: SettingsRecord = {};
    if (!this.mirror) return out;
    for (const k of SETTINGS_KEYS) {
      try {
        const raw = this.mirror.getItem(MIRROR_PREFIX + k);
        if (raw !== null) out[k] = JSON.parse(raw);
      } catch {
        // an unreadable entry is treated as absent
      }
    }
    return out;
  }
}
