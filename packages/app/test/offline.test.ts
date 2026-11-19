import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type InboxFm, validateSnapshot } from '@gnomon/core';
import { MemoryDriver, NetworkError, type StorageDriver } from '@gnomon/storage';
import { BrainService, type SnapshotState } from '../src/lib/services/brain';
import { DRAFT_KEY, OfflineQueue, type PendingState, QUEUE_KEY, loadDraft, localQueueStore, saveDraft } from '../src/lib/services/offline';

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
function flaky(inner: StorageDriver, flag: { down: boolean; fail?: string }): StorageDriver {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'commit') return (batch: Parameters<StorageDriver['commit']>[0]) => (flag.fail ? Promise.reject(new Error(flag.fail)) : flag.down ? Promise.reject(new NetworkError('offline')) : target.commit(batch));
      return Reflect.get(target, prop, receiver) as unknown;
    },
  });
}

/** localStorage as a Map, so a second queue can be opened over what the first left: the app closed and opened again. */
function fakeStorage() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

async function setup() {
  const state: SnapshotState = { current: null, stale: false, loading: false, error: null };
  const brain = new BrainService(state);
  const inner = await MemoryDriver.create(seed());
  const flag: { down: boolean; fail?: string } = { down: false };
  const driver = flaky(inner, flag);
  await brain.connect(driver);
  const storage = fakeStorage();
  const online = { value: true };
  let tick = 0;
  const clock = () => `2026-09-07T10:00:0${tick++}Z`;
  const open = () => {
    const pending: PendingState = { queue: [], flushed: null };
    return { pending, queue: new OfflineQueue(pending, () => online.value, localQueueStore(storage), clock) };
  };
  return { brain, inner, driver, flag, online, storage, open, ...open() };
}

describe('the capture queue (spec §14)', () => {
  it('saves straight through when online', async () => {
    const { brain, queue, pending, storage } = await setup();
    const r = await queue.capture(brain, { text: 'now', now: () => '2026-09-07T10:00:00Z' });
    expect('saved' in r && r.saved.stem.startsWith('20260907-100000-')).toBe(true);
    expect(pending.queue).toEqual([]);
    expect(storage.m.has(QUEUE_KEY)).toBe(false);
  });

  it('queues every text capture made offline and saves them in order, each at the time it was made', async () => {
    const { brain, inner, queue, pending, online } = await setup();
    online.value = false;
    expect(await queue.capture(brain, { text: 'first', note: 'n' })).toEqual({ queued: true });
    expect(await queue.capture(brain, { text: 'second' })).toEqual({ queued: true });
    expect(pending.queue.map((c) => [c.text, c.note, c.at])).toEqual([['first', 'n', '2026-09-07T10:00:00Z'], ['second', undefined, '2026-09-07T10:00:01Z']]);
    expect(queue.hasPending).toBe(true);
    await expect(queue.capture(brain, { text: 'with file', attachment: { filename: 'a.png', bytes: new Uint8Array([1]) } })).rejects.toThrow(/not queued/);
    expect(await queue.flush(brain)).toEqual([]); // still offline
    const head = await inner.head();

    online.value = true;
    const saved = await queue.flush(brain);
    expect(saved.map((r) => r.stem.slice(0, 15))).toEqual(['20260907-100000', '20260907-100001']);
    expect(pending.queue).toEqual([]);
    expect(pending.flushed).toBe(saved[1]);
    expect(await inner.head()).not.toBe(head);
    expect(brain.snapshot!.files.get(saved[0]!.path)!.body).toBe('first\n');
    expect((brain.snapshot!.files.get(saved[0]!.path)!.fm as InboxFm).created).toBe('2026-09-07T10:00:00Z');
    expect(validateSnapshot(brain.snapshot!)).toEqual([]);
  });

  it('survives the app being closed: a new queue over the same storage holds and saves what the last one left', async () => {
    const { brain, queue, online, storage, open } = await setup();
    online.value = false;
    await queue.capture(brain, { text: 'written on the train' });
    expect(JSON.parse(storage.m.get(QUEUE_KEY)!)).toHaveLength(1);

    const reopened = open();
    expect(reopened.pending.queue.map((c) => c.text)).toEqual(['written on the train']);
    online.value = true;
    const saved = await reopened.queue.flush(brain);
    expect(brain.snapshot!.files.get(saved[0]!.path)!.body).toBe('written on the train\n');
    expect(storage.m.has(QUEUE_KEY)).toBe(false);
  });

  it('a network failure while nominally online also queues, and a later failure keeps waiting', async () => {
    const { brain, queue, pending, flag } = await setup();
    flag.down = true;
    expect(await queue.capture(brain, { text: 'flaky' })).toEqual({ queued: true });
    expect(await queue.flush(brain)).toEqual([]);
    expect(pending.queue).toHaveLength(1);
    flag.down = false;
    expect((await queue.flush(brain))[0]!.stem).toBeTruthy();
    expect(pending.queue).toEqual([]);
  });

  it('queues while no brain is connected, and waits for one', async () => {
    const { brain, driver, queue, pending } = await setup();
    brain.disconnect();
    expect(await queue.capture(brain, { text: 'before the brain loaded' })).toEqual({ queued: true });
    expect(await queue.flush(brain)).toEqual([]);
    expect(pending.queue).toHaveLength(1);
    await brain.connect(driver);
    expect(await queue.flush(brain)).toHaveLength(1);
  });

  it('never drops a capture: a failure that is not the network stays in the queue with its reason, and later ones still save', async () => {
    const { brain, queue, pending, online, flag, storage } = await setup();
    online.value = false;
    await queue.capture(brain, { text: 'kept' });
    online.value = true;
    flag.fail = 'the repository refused it';
    expect(await queue.flush(brain)).toEqual([]);
    expect(pending.queue).toHaveLength(1);
    expect(pending.queue[0]!.error).toContain('the repository refused it');
    expect(JSON.parse(storage.m.get(QUEUE_KEY)!)[0].text).toBe('kept');

    delete flag.fail;
    expect(await queue.flush(brain)).toHaveLength(1);
    expect(pending.queue).toEqual([]);
  });

  it('a waiting capture can be taken back out', async () => {
    const { brain, queue, pending, online, storage } = await setup();
    online.value = false;
    await queue.capture(brain, { text: 'changed my mind', note: 'n' });
    const item = queue.remove(pending.queue[0]!.id);
    expect(item).toMatchObject({ text: 'changed my mind', note: 'n' });
    expect(pending.queue).toEqual([]);
    expect(storage.m.has(QUEUE_KEY)).toBe(false);
    expect(queue.remove('nope')).toBeNull();
  });

  it('when the device cannot store the capture, the save fails and the form keeps the text', async () => {
    const { brain, online } = await setup();
    const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => undefined };
    const pending: PendingState = { queue: [], flushed: null };
    const queue = new OfflineQueue(pending, () => online.value, localQueueStore(full));
    online.value = false;
    await expect(queue.capture(brain, { text: 'x' })).rejects.toThrow(/Quota/);
    expect(pending.queue).toEqual([]);
  });
});

describe('the capture draft', () => {
  it('round-trips, clears when empty, and reads damage as empty', () => {
    const storage = fakeStorage();
    expect(loadDraft(storage)).toEqual({ text: '', note: '' });
    saveDraft(storage, { text: 'half a thought', note: 'p. 12' });
    expect(loadDraft(storage)).toEqual({ text: 'half a thought', note: 'p. 12' });
    saveDraft(storage, { text: '', note: '' });
    expect(storage.m.has(DRAFT_KEY)).toBe(false);
    storage.m.set(DRAFT_KEY, '{broken');
    expect(loadDraft(storage)).toEqual({ text: '', note: '' });
  });
});
