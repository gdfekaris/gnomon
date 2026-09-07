import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateSnapshot } from '@gnomon/core';
import { MemoryDriver, NetworkError, type StorageDriver } from '@gnomon/storage';
import { BrainService, type SnapshotState } from '../src/lib/services/brain';
import { OfflineQueue, type PendingState } from '../src/lib/services/offline';

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

/** A driver whose commit fails with NetworkError while `down` is true. */
function flaky(inner: StorageDriver, flag: { down: boolean }): StorageDriver {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'commit') return (batch: Parameters<StorageDriver['commit']>[0]) => (flag.down ? Promise.reject(new NetworkError('offline')) : target.commit(batch));
      return Reflect.get(target, prop, receiver) as unknown;
    },
  });
}

async function setup() {
  const state: SnapshotState = { current: null, stale: false, loading: false, error: null };
  const brain = new BrainService(state);
  const inner = await MemoryDriver.create(seed());
  const flag = { down: false };
  await brain.connect(flaky(inner, flag));
  const pending: PendingState = { pending: null, flushed: null, flushError: null };
  const online = { value: true };
  const queue = new OfflineQueue(pending, () => online.value);
  return { brain, inner, flag, pending, online, queue };
}

describe('OfflineQueue (spec §14)', () => {
  it('saves straight through when online', async () => {
    const { brain, queue, pending } = await setup();
    const r = await queue.capture(brain, { text: 'now', now: () => '2026-09-07T10:00:00Z' });
    expect('saved' in r && r.saved.stem.startsWith('20260907-100000-')).toBe(true);
    expect(pending.pending).toBeNull();
  });

  it('queues one text-only capture while offline and saves it on flush', async () => {
    const { brain, inner, queue, pending, online } = await setup();
    online.value = false;
    expect(await queue.capture(brain, { text: 'later', note: 'n' })).toEqual({ queued: true });
    expect(pending.pending).toEqual({ text: 'later', note: 'n' });
    expect(queue.hasPending).toBe(true);
    await expect(queue.capture(brain, { text: 'another' })).rejects.toThrow(/already waiting/);
    await expect(queue.capture(brain, { text: 'with file', attachment: { filename: 'a.png', bytes: new Uint8Array([1]) } })).rejects.toThrow(/not queued/);
    expect(await queue.flush(brain)).toBeNull(); // still offline
    const head = await inner.head();

    online.value = true;
    const saved = await queue.flush(brain);
    expect(saved!.path).toMatch(/^inbox\//);
    expect(pending.pending).toBeNull();
    expect(pending.flushed).toBe(saved);
    expect(await inner.head()).not.toBe(head);
    expect(brain.snapshot!.files.get(saved!.path)!.body).toBe('later\n');
    expect(validateSnapshot(brain.snapshot!)).toEqual([]);
  });

  it('a network failure while nominally online also queues, and a later failure keeps waiting', async () => {
    const { brain, queue, pending, flag } = await setup();
    flag.down = true;
    expect(await queue.capture(brain, { text: 'flaky' })).toEqual({ queued: true });
    expect(await queue.flush(brain)).toBeNull();
    expect(pending.pending).not.toBeNull();
    flag.down = false;
    expect((await queue.flush(brain))!.stem).toMatch(/^\d{8}-/);
    expect(pending.pending).toBeNull();
  });

  it('a non-network failure on flush drops the capture and reports it', async () => {
    const { brain, queue, pending, online } = await setup();
    online.value = false;
    await queue.capture(brain, { text: 'x' });
    online.value = true;
    brain.disconnect();
    expect(await queue.flush(brain)).toBeNull(); // not connected: keep waiting, no error
    expect(pending.pending).not.toBeNull();
  });
});
