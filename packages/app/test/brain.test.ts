import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { type InboxFm, ValidationError, buildFiling } from '@gnomon/core';
import { CachingDriver, HeadMovedError, MemoryDriver, NetworkError, memoryCopyStore } from '@gnomon/storage';
import { BrainService, type SnapshotState } from '../src/lib/services/brain';

const here = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE = join(here, '..', '..', 'core', 'fixtures', 'brain');
function seed(): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(relative(FIXTURE, full).split('\\').join('/'), new Uint8Array(readFileSync(full)));
    }
  };
  walk(FIXTURE);
  return out;
}
const fresh = (): SnapshotState => ({ current: null, stale: false, loading: false, error: null });
const capture = (stem: string) => `---\ntype: inbox\nstatus: unfiled\ncurated: human\ncreated: 2026-09-06T09:00:00Z\nupdated: 2026-09-06T09:00:00Z\n---\n${stem}\n`;

describe('BrainService (spec §4, §10.2)', () => {
  it('connect loads the snapshot and refresh clears stale', async () => {
    const state = fresh();
    const service = new BrainService(state);
    expect(service.connected).toBe(false);
    const driver = await MemoryDriver.create(seed());
    const s = await service.connect(driver);
    expect(service.connected).toBe(true);
    expect(state.current).toBe(s);
    expect(s.files.size).toBe(25);
    expect(state.loading).toBe(false);
    state.stale = true;
    await service.refresh();
    expect(state.stale).toBe(false);
  });

  it('commit applies the batch locally at the new head, then refreshes', async () => {
    const state = fresh();
    const service = new BrainService(state);
    const driver = await MemoryDriver.create(seed());
    const before = await service.connect(driver);
    const { sha } = await service.commit({ message: 'Capture: x', expectedHead: before.head, writes: [{ path: 'inbox/20260906-090000-q2w.md', text: capture('one') }], deletes: [] });
    expect(state.current!.head).toBe(sha);
    expect(state.current!.byType('inbox').length).toBe(5);
    await new Promise((r) => setTimeout(r, 10));
    expect(state.current!.head).toBe(await driver.head());
    expect(state.current!.files.get('inbox/20260906-090000-q2w.md')!.sha).not.toBe('');
  });

  it('refuses a batch that breaks the write rules before touching the driver', async () => {
    const state = fresh();
    const service = new BrainService(state);
    const driver = await MemoryDriver.create(seed());
    const s = await service.connect(driver);
    const head = await driver.head();
    await expect(service.commit({ message: 'x', expectedHead: s.head, writes: [{ path: 'sources/didion-why-i-write/original.pdf', bytes: new Uint8Array([1]) }], deletes: [] })).rejects.toBeInstanceOf(ValidationError);
    expect(await driver.head()).toBe(head);
  });

  it('marks the snapshot stale on HeadMovedError and recovers on refresh', async () => {
    const state = fresh();
    const service = new BrainService(state);
    const driver = await MemoryDriver.create(seed());
    const s = await service.connect(driver);
    await driver.commit({ message: 'elsewhere', expectedHead: s.head, writes: [{ path: 'inbox/20260906-090000-q2w.md', text: capture('other device') }], deletes: [] });
    await expect(service.commit({ message: 'x', expectedHead: s.head, writes: [{ path: 'inbox/20260906-090100-q2w.md', text: capture('mine') }], deletes: [] })).rejects.toBeInstanceOf(HeadMovedError);
    expect(state.stale).toBe(true);
    const again = await service.refresh();
    expect(state.stale).toBe(false);
    expect(again.byType('inbox').length).toBe(5);
    const capturePath = 'inbox/20260906-090100-q2w.md';
    const filing = buildFiling(again, again.files.get('inbox/20260906-090000-q2w.md') as never, { title: 'T', author: 'A' }, [], { now: '2026-09-06T12:00:00Z' });
    void capturePath;
    await service.commit(filing);
    expect((state.current!.files.get('inbox/20260906-090000-q2w.md')!.fm as InboxFm).status).toBe('filed');
  });
});

describe('BrainService with a copy on the device (spec §6.6)', () => {
  /** A host that counts file reads, can be cut off, and can hold a listing back until released. */
  async function world() {
    const memory = await MemoryDriver.create(seed());
    const net = { down: false, reads: 0, hold: null as Promise<void> | null };
    const host = new Proxy(memory, {
      get(target, prop, receiver) {
        const real = Reflect.get(target, prop, receiver) as unknown;
        if (typeof real !== 'function') return real;
        return async (...args: unknown[]) => {
          if (net.down) throw new NetworkError('offline');
          if (prop === 'readMany') net.reads += (args[0] as string[]).length;
          if (prop === 'list' && net.hold) await net.hold;
          return (real as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    const store = memoryCopyStore();
    let t = 0;
    const open = () => new CachingDriver(host, store, 'me/brain', () => (t += 60_000));
    return { memory, net, open };
  }
  const connect = async (copy: CachingDriver, fromCopy: boolean) => {
    const state = fresh();
    const service = new BrainService(state);
    const s = await service.connect(copy, { local: copy.copyOnly, fromCopy });
    return { state, service, s };
  };

  it('opens from the copy with the repository unreachable, and a failed check is not an error on screen', async () => {
    const { net, open } = await world();
    const first = await connect(open(), false);
    expect(first.state.fromCopy).toBe(false);

    net.down = true;
    const { state, service, s } = await connect(open(), true);
    expect(s.head).toBe(first.s.head);
    expect(state.fromCopy).toBe(true);
    expect(state.timings?.open?.from).toBe('copy');
    await expect(service.refresh()).rejects.toBeInstanceOf(NetworkError);
    expect(state.current).toBe(s);
    expect(state.error).toBeNull();
    expect(state.loading).toBe(false);

    net.down = false;
    await service.refresh();
    expect(state.fromCopy).toBe(false);
  });

  it('after its own commit it reloads from the copy and asks the repository for no file', async () => {
    const { memory, net, open } = await world();
    const { state, service } = await connect(open(), false);
    const reads = net.reads;
    const { sha } = await service.commit({ message: 'Capture: a', expectedHead: service.head!, writes: [{ path: 'inbox/20260906-090000-a2a.md', text: capture('a') }], deletes: [] });
    await vi.waitFor(() => expect(state.current!.files.get('inbox/20260906-090000-a2a.md')!.sha).not.toBe(''));
    expect(state.current!.head).toBe(sha);
    expect(net.reads).toBe(reads);
    expect(state.current!.files.get('inbox/20260906-090000-a2a.md')!.sha).toBe((await memory.list()).find((e) => e.path === 'inbox/20260906-090000-a2a.md')!.sha);
    expect(state.timings?.commitMs).not.toBeNull();
  });

  it('a slow check that a commit overtook does not put the older brain back', async () => {
    const { net, open } = await world();
    const { state, service } = await connect(open(), false);
    let release!: () => void;
    net.hold = new Promise<void>((r) => (release = r));
    const slow = service.refresh();
    net.hold = null;
    // The held listing was asked for at the old head; the commit lands while it waits.
    const held = state.current!.head;
    const { sha } = await service.commit({ message: 'Capture: b', expectedHead: held, writes: [{ path: 'inbox/20260906-090000-b2b.md', text: capture('b') }], deletes: [] });
    release();
    await slow;
    expect(state.current!.head).toBe(sha);
    expect(state.current!.files.has('inbox/20260906-090000-b2b.md')).toBe(true);
    expect(state.loading).toBe(false);
  });

  it('reopen loads from the copy when the repository cannot be reached', async () => {
    const { net, open } = await world();
    const { state, service, s } = await connect(open(), false);
    service.clearSnapshot('locked');
    net.down = true;
    const again = await service.reopen();
    expect(again.head).toBe(s.head);
    expect(state.fromCopy).toBe(true);
    expect(state.error).toBeNull();
  });
});
