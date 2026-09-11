import { describe, expect, it } from 'vitest';
import { type KV, SettingsPersistence } from '../src/lib/services/persist';

function memoryKv(initial: Record<string, unknown> = {}): KV & { data: Map<string, unknown> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: async <T>(k: string) => data.get(k) as T | undefined,
    set: async (k, v) => { data.set(k, v); },
    del: async (k) => { data.delete(k); },
  };
}

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, String(v)); },
  };
}

const throwing: KV = {
  get: async () => { throw new DOMException('Connection to Indexed Database server lost', 'UnknownError'); },
  set: async () => { throw new DOMException('Connection to Indexed Database server lost', 'UnknownError'); },
  del: async () => { throw new DOMException('Connection to Indexed Database server lost', 'UnknownError'); },
};

describe('settings persistence (spec §10.2, §10.3): IndexedDB with a localStorage mirror', () => {
  it('writes land in both stores and read back from IndexedDB', async () => {
    const idb = memoryKv();
    const local = memoryStorage();
    const p = new SettingsPersistence(idb, local);
    await p.write('git.token', 't');
    await p.write('git.repo', { owner: 'o', name: 'n' });
    await p.write('prefs', { mode: 'github' });
    expect(idb.data.get('git.repo')).toEqual({ owner: 'o', name: 'n' });
    expect(local.getItem('gnomon.settings.git.token')).toBe('"t"');
    const again = new SettingsPersistence(memoryKv(Object.fromEntries(idb.data)), local);
    expect(await again.readAll()).toEqual({ 'git.token': 't', 'git.repo': { owner: 'o', name: 'n' }, prefs: { mode: 'github' } });
    expect(again.diagnostics).toEqual({ source: 'indexeddb', error: null });
  });

  it('a failing IndexedDB neither loses a save nor the launch: the mirror answers and the failure is recorded', async () => {
    const local = memoryStorage();
    const p = new SettingsPersistence(throwing, local);
    await p.write('git.token', 't');
    await p.write('git.repo', { owner: 'o', name: 'n' });
    expect(p.diagnostics.error).toContain('Connection to Indexed Database server lost');
    const launch = new SettingsPersistence(throwing, local);
    expect(await launch.readAll()).toEqual({ 'git.token': 't', 'git.repo': { owner: 'o', name: 'n' } });
    expect(launch.diagnostics.source).toBe('mirror');
    expect(launch.diagnostics.error).toContain('UnknownError');
  });

  it('an IndexedDB that answers empty while the mirror has settings yields the mirror and says so', async () => {
    const local = memoryStorage();
    await new SettingsPersistence(memoryKv(), local).write('prefs', { mode: 'demo' });
    const launch = new SettingsPersistence(memoryKv(), local);
    expect(await launch.readAll()).toEqual({ prefs: { mode: 'demo' } });
    expect(launch.diagnostics).toEqual({ source: 'mirror', error: 'IndexedDB answered but held nothing; the mirror did' });
  });

  it('deleting a key clears both stores; nothing saved anywhere is "none"', async () => {
    const idb = memoryKv();
    const local = memoryStorage();
    const p = new SettingsPersistence(idb, local);
    await p.write('provider.anthropic.key', 'k');
    await p.write('provider.anthropic.key', undefined);
    expect(idb.data.has('provider.anthropic.key')).toBe(false);
    expect(local.getItem('gnomon.settings.provider.anthropic.key')).toBeNull();
    const launch = new SettingsPersistence(idb, local);
    expect(await launch.readAll()).toEqual({});
    expect(launch.diagnostics.source).toBe('indexeddb');
    expect((await new SettingsPersistence(null, null).readAll())).toEqual({});
  });

  it('an IndexedDB that never answers is given four seconds, then the mirror is used', async () => {
    const hanging: KV = { get: () => new Promise(() => undefined), set: async () => undefined, del: async () => undefined };
    const local = memoryStorage();
    local.setItem('gnomon.settings.git.token', '"t"');
    const p = new SettingsPersistence(hanging, local);
    const t0 = Date.now();
    const read = await p.readAll();
    expect(read).toEqual({ 'git.token': 't' });
    expect(p.diagnostics.source).toBe('mirror');
    expect(p.diagnostics.error).toContain('did not answer');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(4000 * 3 - 100);
  }, 20_000);
});
