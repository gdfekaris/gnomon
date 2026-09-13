import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type InboxFm, type SourceFm, buildCapture, validateSnapshot } from '@gnomon/core';
import { MOCK_MODEL, MockProvider } from '@gnomon/providers';
import { MemoryDriver } from '@gnomon/storage';
import { BrainService, type SnapshotState } from '../src/lib/services/brain';
import { type InboxState, loadFilings, processInbox, ratify, reject, reviewOf, unfiledCaptures } from '../src/lib/services/inbox';

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
const fresh = (): InboxState => ({ filings: [], loading: false, processing: null, results: [], error: null });
async function connected() {
  const state: SnapshotState = { current: null, stale: false, loading: false, error: null };
  const brain = new BrainService(state);
  const driver = await MemoryDriver.create(seed());
  await brain.connect(driver);
  return { brain, driver, inbox: fresh() };
}

describe('inbox service (US-2, US-3)', () => {
  it('files every unfiled capture through the demo model, one commit each, copying the attachment', async () => {
    const { brain, driver, inbox } = await connected();
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const cap = buildCapture({ body: 'A photographed page.\n', attachment: { filename: 'page.png', bytes: png }, now: '2026-09-07T10:00:00Z', expectedHead: brain.head! });
    await brain.commit(cap.batch);
    expect(unfiledCaptures(brain.snapshot!).length).toBe(2);

    const results = await processInbox(inbox, brain, driver, new MockProvider(), MOCK_MODEL, 19_200);
    expect(results.map((r) => [r.path, r.slug, r.proposals, r.error])).toEqual([
      ['inbox/20260906-070000-2bq.md', 'unknown-the-only-way-to', 3, undefined],
      [cap.path, 'unknown-a-photographed-page', 3, undefined],
    ]);
    expect(unfiledCaptures(brain.snapshot!).length).toBe(0);
    expect(validateSnapshot(brain.snapshot!)).toEqual([]);
    expect((await driver.readBytes('sources/unknown-a-photographed-page/original.png')).bytes).toEqual(png);
    expect((brain.snapshot!.files.get('sources/unknown-a-photographed-page/raw.md')!.fm as SourceFm).attachment).toBe('original.png');
    expect((await driver.history({ limit: 2 })).map((c) => c.message)).toEqual(['File: unknown-a-photographed-page', 'File: unknown-the-only-way-to']);
    expect(inbox.processing).toBeNull();

    await loadFilings(inbox, brain, driver);
    expect(inbox.filings.map((f) => [f.slug, f.state])).toEqual([['unknown-a-photographed-page', 'pending'], ['unknown-the-only-way-to', 'pending']]);
    const review = reviewOf(brain, inbox.filings[0]!.changes);
    // proposal ids carry today's UTC date (the service uses the real clock); the fixture already holds 001 and 002 for the 5th only
    expect(review.added.map((f) => f.path.replace(/P-\d{8}-/, 'P-<today>-'))).toEqual(['maps/proposals/P-<today>-004.md', 'maps/proposals/P-<today>-005.md', 'maps/proposals/P-<today>-006.md', 'sources/unknown-a-photographed-page/notes.md', 'sources/unknown-a-photographed-page/raw.md']);
    expect(review.attachments).toEqual([{ path: 'sources/unknown-a-photographed-page/original.png', size: 7 }]);
    expect(review.capture!.addedLines).toEqual(['status: filed', 'filed_as: unknown-a-photographed-page']);
  });

  it('a bad reply stops that capture only, with no commit', async () => {
    const { brain, driver, inbox } = await connected();
    const head = await driver.head();
    const results = await processInbox(inbox, brain, driver, new MockProvider({ script: () => 'I would rather not.' }), MOCK_MODEL, 19_200);
    expect(results).toEqual([{ path: 'inbox/20260906-070000-2bq.md', error: "The model's reply could not be used: reply contains no JSON object. Try again, or pick another model." }]);
    expect(await driver.head()).toBe(head);
    const hallucinated = new MockProvider({ script: () => JSON.stringify({ meta: { title: 'T', author: 'A' }, proposals: [{ kind: 'link', title: 't', target_set: 'ps-g8xw', target: 'ps-g8xw/invented', rationale: 'r' }] }) });
    expect((await processInbox(inbox, brain, driver, hallucinated, MOCK_MODEL, 19_200))[0]!.error).toContain('not a principle in this brain');
    expect(await driver.head()).toBe(head);
  });

  it('ratify then reject: states follow, rejecting a ratified filing reports the conflict', async () => {
    const { brain, driver, inbox } = await connected();
    await processInbox(inbox, brain, driver, new MockProvider(), MOCK_MODEL, 19_200);
    await loadFilings(inbox, brain, driver);
    const first = inbox.filings[0]!;
    await ratify(inbox, brain, driver, first);
    expect(inbox.filings[0]!.state).toBe('ratified');
    expect((brain.snapshot!.files.get(`sources/${first.slug}/raw.md`)!.fm as SourceFm).curated).toBe('ratified');
    const r = await reject(inbox, brain, driver, inbox.filings[0]!);
    expect(r.conflict).toEqual([`sources/${first.slug}/notes.md`, `sources/${first.slug}/raw.md`]);

    // a fresh filing can be rejected: the capture returns to unfiled
    const cap = buildCapture({ body: 'Second.\n', now: '2026-09-07T11:00:00Z', expectedHead: brain.head! });
    await brain.commit(cap.batch);
    await processInbox(inbox, brain, driver, new MockProvider(), MOCK_MODEL, 19_200);
    await loadFilings(inbox, brain, driver);
    const second = inbox.filings.find((f) => f.slug === 'unknown-second')!;
    expect(second.state).toBe('pending');
    expect(await reject(inbox, brain, driver, second)).toEqual({});
    expect(inbox.filings.find((f) => f.slug === 'unknown-second')!.state).toBe('rejected');
    expect((brain.snapshot!.files.get(cap.path)!.fm as InboxFm).status).toBe('unfiled');
    expect(brain.snapshot!.files.has('sources/unknown-second/raw.md')).toBe(false);
    expect(validateSnapshot(brain.snapshot!)).toEqual([]);
  });
});
