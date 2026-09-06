import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type InboxFm, validateSnapshot } from '@gnomon/core';
import { ATTACHMENT_LIMIT_BYTES, AttachmentTooLargeError, MemoryDriver } from '@gnomon/storage';
import { BrainService, type SnapshotState } from '../src/lib/services/brain';
import { captureToInbox } from '../src/lib/services/capture';

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
const NOW = () => '2026-09-06T15:00:00Z';

async function connected() {
  const state = fresh();
  const brain = new BrainService(state);
  const driver = await MemoryDriver.create(seed());
  await brain.connect(driver);
  return { state, brain, driver };
}

describe('captureToInbox (spec §10.4)', () => {
  it('captures text with a note as one commit that validates', async () => {
    const { state, brain, driver } = await connected();
    const r = await captureToInbox(brain, { text: 'A passage.\n', note: 'train', now: NOW });
    expect(r.stem.startsWith('20260906-150000-')).toBe(true);
    expect(r.sha).toBe(await driver.head());
    expect(r.attachment).toBeUndefined();
    expect((await driver.history({ limit: 1 }))[0]!.message).toBe(`Capture: ${r.stem}`);
    const capture = state.current!.files.get(r.path)!;
    expect(capture.body).toBe('A passage.\n');
    expect((capture.fm as InboxFm).note).toBe('train');
    expect(validateSnapshot(state.current!)).toEqual([]);
  });

  it('carries an attachment across byte for byte', async () => {
    const { state, brain, driver } = await connected();
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]);
    const r = await captureToInbox(brain, { text: 'Scan.', attachment: { filename: 'Page.PDF', bytes }, now: NOW });
    expect(r.attachment).toBe(`inbox/${r.stem}.pdf`);
    expect((await driver.readBytes(r.attachment!)).bytes).toEqual(bytes);
    await new Promise((res) => setTimeout(res, 10));
    expect(validateSnapshot(state.current!)).toEqual([]);
  });

  it('refuses an oversized attachment before touching the driver', async () => {
    const { brain, driver } = await connected();
    const head = await driver.head();
    const big = new Uint8Array(ATTACHMENT_LIMIT_BYTES + 1);
    const err = await captureToInbox(brain, { text: 'x', attachment: { filename: 'big.bin', bytes: big } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AttachmentTooLargeError);
    expect((err as AttachmentTooLargeError).limit).toBe(ATTACHMENT_LIMIT_BYTES);
    expect(await driver.head()).toBe(head);
  });

  it('retries once on a moved head', async () => {
    const { state, brain, driver } = await connected();
    const elsewhere = await driver.commit({
      message: 'Capture: 20260906-145900-abc', expectedHead: state.current!.head,
      writes: [{ path: 'inbox/20260906-145900-abc.md', text: '---\ntype: inbox\nstatus: unfiled\ncurated: human\ncreated: 2026-09-06T14:59:00Z\nupdated: 2026-09-06T14:59:00Z\n---\nother device\n' }], deletes: [],
    });
    const r = await captureToInbox(brain, { text: 'mine', now: NOW });
    expect(r.sha).toBe(await driver.head());
    expect((await driver.history({ limit: 2 })).map((c) => c.sha)).toEqual([r.sha, elsewhere.sha]);
    expect(state.stale).toBe(false);
    expect(state.current!.byType('inbox').length).toBe(6);
  });

  it('refuses empty text and a missing brain', async () => {
    const { brain } = await connected();
    await expect(captureToInbox(brain, { text: '  \n' })).rejects.toThrow(/needs some text/);
    await expect(captureToInbox(new BrainService(fresh()), { text: 'x' })).rejects.toThrow(/no brain/);
  });
});
