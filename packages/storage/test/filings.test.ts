import { describe, expect, it } from 'vitest';
import { type BrainFile, type InboxFm, buildFiling, buildRatify, filingState, validateSnapshot } from '@gnomon/core';
import { MemoryDriver, RevertConflictError, changesOf, listFilings, loadSnapshot, rejectFiling } from '../src/index';
import { readBrainBytes } from './fixture';

const NOW = '2026-09-07T12:00:00Z';

async function fileCapture(d: MemoryDriver, capturePath: string, title: string) {
  const s = await loadSnapshot(d);
  const batch = buildFiling(s, s.files.get(capturePath) as BrainFile<InboxFm>, { title, author: 'Someone' }, [{ kind: 'tag', title: 't', rationale: 'r\n' }], { now: NOW });
  return d.commit(batch);
}

describe('filings over a driver (spec §9)', () => {
  it('lists filing commits newest first with their slug and changes, ignoring other commits', async () => {
    const d = await MemoryDriver.create(readBrainBytes());
    const h = await d.head();
    await d.commit({ message: 'File: fake', expectedHead: h, writes: [{ path: 'README.md', text: 'not a filing\n' }], deletes: [] });
    const a = await fileCapture(d, 'inbox/20260906-070000-2bq.md', 'First');
    await d.commit({ message: 'Capture: 20260907-090000-q2w', expectedHead: a.sha, writes: [{ path: 'inbox/20260907-090000-q2w.md', text: '---\ntype: inbox\nstatus: unfiled\ncurated: human\ncreated: 2026-09-07T09:00:00Z\nupdated: 2026-09-07T09:00:00Z\n---\nSecond capture.\n' }], deletes: [] });
    const b = await fileCapture(d, 'inbox/20260907-090000-q2w.md', 'Second');

    const filings = await listFilings(d);
    expect(filings.map((f) => [f.sha, f.slug, f.message])).toEqual([[b.sha, 'someone-second', 'File: someone-second'], [a.sha, 'someone-first', 'File: someone-first']]);
    expect(filings[1]!.changes.map((c) => [c.path, c.status])).toEqual([
      ['inbox/20260906-070000-2bq.md', 'modified'],
      ['maps/proposals/P-20260907-001.md', 'added'],
      ['sources/someone-first/notes.md', 'added'],
      ['sources/someone-first/raw.md', 'added'],
    ]);
    expect(filings[1]!.date).toMatch(/^\d{4}-/);
    expect((await listFilings(d, 1)).length).toBe(1);
    const info = (await d.history({ limit: 10 })).find((c) => c.sha === a.sha)!;
    expect(await changesOf(d, info)).toEqual(filings[1]!.changes);
  });

  it('ratify then reject: the earlier filing is rejected after the later one, and a ratified one conflicts', async () => {
    const d = await MemoryDriver.create(readBrainBytes());
    const a = await fileCapture(d, 'inbox/20260906-070000-2bq.md', 'First');
    await d.commit({ message: 'Capture: 20260907-090000-q2w', expectedHead: a.sha, writes: [{ path: 'inbox/20260907-090000-q2w.md', text: '---\ntype: inbox\nstatus: unfiled\ncurated: human\ncreated: 2026-09-07T09:00:00Z\nupdated: 2026-09-07T09:00:00Z\n---\nSecond capture.\n' }], deletes: [] });
    const b = await fileCapture(d, 'inbox/20260907-090000-q2w.md', 'Second');
    const [second, first] = await listFilings(d);

    // ratify the second
    const s = await loadSnapshot(d);
    expect(filingState(s, second!.changes)).toBe('pending');
    await d.commit(buildRatify(s, second!.changes, '2026-09-07T13:00:00Z'));
    expect(filingState(await loadSnapshot(d), second!.changes)).toBe('ratified');
    expect((await d.history({ limit: 1 }))[0]!.message).toBe('File: someone-second'.replace('File', 'Ratify'));

    // reject the first, which landed before the second
    await rejectFiling(d, first!);
    const after = await loadSnapshot(d);
    expect(filingState(after, first!.changes)).toBe('rejected');
    expect((after.files.get('inbox/20260906-070000-2bq.md')!.fm as InboxFm).status).toBe('unfiled');
    expect(after.files.has('sources/someone-second/raw.md')).toBe(true);
    expect(validateSnapshot(after)).toEqual([]);
    expect((await d.history({ limit: 1 }))[0]!.message).toBe('Reject: someone-first');

    // the ratified second cannot be rejected: ratification touched its files
    await expect(rejectFiling(d, second!)).rejects.toBeInstanceOf(RevertConflictError);
    expect(b.sha).not.toBe(a.sha);
  });
});
