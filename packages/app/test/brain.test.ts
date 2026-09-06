import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type InboxFm, ValidationError, buildFiling } from '@gnomon/core';
import { HeadMovedError, MemoryDriver } from '@gnomon/storage';
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
    expect(s.files.size).toBe(24);
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
