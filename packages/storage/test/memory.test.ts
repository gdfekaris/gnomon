import { describe, expect, it } from 'vitest';
import { MemoryDriver, gitBlobSha, linePatch } from '../src/index';
import { driverContract } from './contract';

driverContract('MemoryDriver', (seed) => MemoryDriver.create(seed));

describe('MemoryDriver specifics (spec §6.3)', () => {
  it('gitBlobSha matches git for the empty blob and a known string', async () => {
    expect(await gitBlobSha(new Uint8Array())).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    expect(await gitBlobSha(new TextEncoder().encode('hello'))).toBe('b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0');
  });
  it('uses the injected clock for commit dates and produces stable SHAs', async () => {
    const a = await MemoryDriver.create(new Map([['a.md', 'x']]), { now: () => '2026-09-06T12:00:00Z' });
    const b = await MemoryDriver.create(new Map([['a.md', 'x']]), { now: () => '2026-09-06T12:00:00Z' });
    expect(await a.head()).toBe(await b.head());
    expect((await a.history({ limit: 1 }))[0]!.date).toBe('2026-09-06T12:00:00Z');
  });
  it('createRepo resets to an auto_init-style initial commit', async () => {
    const d = await MemoryDriver.create(new Map([['a.md', 'x']]));
    const { fullName, head } = await d.createRepo({ name: 'brain', private: true });
    expect(fullName).toBe('memory/brain');
    expect(await d.head()).toBe(head);
    expect((await d.list()).map((e) => e.path)).toEqual(['README.md']);
  });
  it('linePatch marks added and removed lines', () => {
    expect(linePatch('a\nb\nc\n', 'a\nc\nd\n')).toBe('@@ -1,3 +1,3 @@\n a\n-b\n c\n+d\n');
    expect(linePatch('', 'x\n')).toBe('@@ -1,0 +1,1 @@\n+x\n');
    expect(linePatch('x\n', '')).toBe('@@ -1,1 +1,0 @@\n-x\n');
    expect(linePatch('', '')).toBe('@@ -1,0 +1,0 @@\n');
  });
});
