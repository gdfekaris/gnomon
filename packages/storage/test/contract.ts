// The driver contract (spec §17): one suite run against every StorageDriver.
// MemoryDriver runs it on every push; GitHubDriver runs it nightly against a
// scratch repository; EncryptingDriver runs it wrapped around MemoryDriver.

import { describe, expect, it } from 'vitest';
import type { BrainFile, InboxFm } from '@gnomon/core';
import { buildFiling, decideProposal, isFrontmatterPath, updatePrinciple, validateSnapshot } from '@gnomon/core';
import { HeadMovedError, NotFoundError, RevertConflictError, type StorageDriver, loadSnapshot } from '../src/index';
import { readBrainBytes } from './fixture';

export type DriverFactory = (seed: Map<string, Uint8Array>) => Promise<StorageDriver>;

const enc = new TextEncoder();
const NOW = '2026-09-06T12:00:00Z';
const SHA40 = /^[0-9a-f]{40}$/;

export function driverContract(name: string, factory: DriverFactory): void {
  describe(`${name} (driver contract, spec §6.1)`, () => {
    const seed = readBrainBytes();
    const fresh = () => factory(new Map(seed));

    it('head, list, readMany, readBytes over the seeded brain', async () => {
      const d = await fresh();
      expect(await d.head()).toMatch(SHA40);
      const tree = await d.list();
      expect(tree.map((e) => e.path)).toEqual([...seed.keys()].sort());
      for (const e of tree) {
        expect(e.sha).toMatch(SHA40);
        expect(e.size).toBe(seed.get(e.path)!.length);
      }
      const md = tree.map((e) => e.path).filter(isFrontmatterPath);
      const texts = await d.readMany([...md, 'sources/nope/raw.md']);
      expect([...texts.keys()].sort()).toEqual([...md].sort());
      for (const p of md) {
        expect(texts.get(p)!.text).toBe(new TextDecoder().decode(seed.get(p)!));
        expect(texts.get(p)!.sha).toBe(tree.find((e) => e.path === p)!.sha);
      }
      const pdf = await d.readBytes('sources/didion-why-i-write/original.pdf');
      expect(pdf.bytes).toEqual(seed.get('sources/didion-why-i-write/original.pdf'));
      expect(pdf.sha).toBe(tree.find((e) => e.path === 'sources/didion-why-i-write/original.pdf')!.sha);
      await expect(d.readBytes('sources/nope/original.pdf')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('blob SHAs are git blob ids', async () => {
      const d = await fresh();
      const head = await d.head();
      await d.commit({ message: 'x', expectedHead: head, writes: [{ path: 'hello.txt', text: 'hello' }], deletes: [] });
      const entry = (await d.list()).find((e) => e.path === 'hello.txt')!;
      expect(entry.sha).toBe('b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0');
    });

    it('loadSnapshot builds a clean snapshot at head', async () => {
      const d = await fresh();
      const s = await loadSnapshot(d);
      expect(s.head).toBe(await d.head());
      expect(s.files.size).toBe(24);
      expect(s.attachments.size).toBe(2);
      expect(validateSnapshot(s)).toEqual([]);
    });

    it('commit is atomic, multi-file, and carries a binary write; deletes apply', async () => {
      const d = await fresh();
      const head = await d.head();
      const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255]);
      const { sha } = await d.commit({
        message: 'Capture: 20260906-090000-q2w',
        expectedHead: head,
        writes: [
          { path: 'inbox/20260906-090000-q2w.md', text: '---\ntype: inbox\nattachment: 20260906-090000-q2w.png\nstatus: unfiled\ncurated: human\ncreated: 2026-09-06T09:00:00Z\nupdated: 2026-09-06T09:00:00Z\n---\nNew.\n' },
          { path: 'inbox/20260906-090000-q2w.png', bytes },
        ],
        deletes: ['inbox/20260906-070000-2bq.md'],
      });
      expect(sha).toMatch(SHA40);
      expect(await d.head()).toBe(sha);
      expect(sha).not.toBe(head);
      const paths = (await d.list()).map((e) => e.path);
      expect(paths).toContain('inbox/20260906-090000-q2w.md');
      expect(paths).toContain('inbox/20260906-090000-q2w.png');
      expect(paths).not.toContain('inbox/20260906-070000-2bq.md');
      expect((await d.readBytes('inbox/20260906-090000-q2w.png')).bytes).toEqual(bytes);
      expect((await d.readMany(['inbox/20260906-090000-q2w.md'])).get('inbox/20260906-090000-q2w.md')!.text).toContain('New.');
      expect(validateSnapshot(await loadSnapshot(d))).toEqual([]);
    });

    it('a failing commit leaves nothing behind', async () => {
      const d = await fresh();
      const head = await d.head();
      await expect(d.commit({ message: 'x', expectedHead: head, writes: [{ path: 'new.md', text: 'x' }], deletes: ['does/not/exist.md'] })).rejects.toThrow();
      expect(await d.head()).toBe(head);
      expect((await d.list()).some((e) => e.path === 'new.md')).toBe(false);
    });

    it('expectedHead: a stale head is rejected with HeadMovedError and nothing changes', async () => {
      const d = await fresh();
      const head = await d.head();
      const first = await d.commit({ message: 'a', expectedHead: head, writes: [{ path: 'a.md', text: 'a' }], deletes: [] });
      const err = await d.commit({ message: 'b', expectedHead: head, writes: [{ path: 'b.md', text: 'b' }], deletes: [] }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HeadMovedError);
      expect((err as HeadMovedError).expected).toBe(head);
      expect((err as HeadMovedError).actual).toBe(first.sha);
      expect(await d.head()).toBe(first.sha);
      expect((await d.list()).some((e) => e.path === 'b.md')).toBe(false);
    });

    it('readMany batches over more than 100 paths', async () => {
      const d = await fresh();
      const head = await d.head();
      const writes = Array.from({ length: 150 }, (_, i) => ({ path: `inbox/20260906-${String(100000 + i).slice(-6)}-abc.md`, text: `---\ntype: inbox\nstatus: unfiled\ncurated: human\ncreated: 2026-09-06\nupdated: 2026-09-06\n---\nn${i}\n` }));
      await d.commit({ message: 'many', expectedHead: head, writes, deletes: [] });
      const got = await d.readMany(writes.map((w) => w.path));
      expect(got.size).toBe(150);
      expect(got.get(writes[149]!.path)!.text).toContain('n149');
      const s = await loadSnapshot(d);
      expect(s.byType('inbox').length).toBe(154);
    });

    it('history is newest first, honours limit, and filters by path', async () => {
      const d = await fresh();
      const h0 = await d.head();
      const c1 = await d.commit({ message: 'one', expectedHead: h0, writes: [{ path: 'a.md', text: '1' }], deletes: [] });
      const c2 = await d.commit({ message: 'two', expectedHead: c1.sha, writes: [{ path: 'b.md', text: '2' }], deletes: [] });
      const c3 = await d.commit({ message: 'three', expectedHead: c2.sha, writes: [{ path: 'a.md', text: '3' }], deletes: [] });
      const all = await d.history({ limit: 10 });
      expect(all.map((c) => c.message)).toEqual(['three', 'two', 'one', all[3]!.message]);
      expect(all[0]).toMatchObject({ sha: c3.sha, parents: [c2.sha] });
      expect(all[0]!.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect((await d.history({ limit: 2 })).map((c) => c.sha)).toEqual([c3.sha, c2.sha]);
      expect((await d.history({ limit: 10, path: 'a.md' })).map((c) => c.sha)).toEqual([c3.sha, c1.sha]);
    });

    it('compare reports added, modified, and removed files with patches for text', async () => {
      const d = await fresh();
      const h0 = await d.head();
      const notes = 'sources/weil-attention/notes.md';
      const before = (await d.readMany([notes])).get(notes)!.text;
      const c1 = await d.commit({
        message: 'x', expectedHead: h0,
        writes: [{ path: 'new.md', text: 'fresh\n' }, { path: notes, text: before + 'Added line.\n' }, { path: 'bin.dat', bytes: new Uint8Array([0, 1, 2]) }],
        deletes: ['inbox/.gitkeep'],
      });
      const changes = await d.compare(h0, c1.sha);
      expect(changes.map((c) => [c.path, c.status])).toEqual([['bin.dat', 'added'], ['inbox/.gitkeep', 'removed'], ['new.md', 'added'], [notes, 'modified']]);
      const modified = changes.find((c) => c.path === notes)!;
      expect(modified.patch).toContain('+Added line.');
      expect(modified.patch!.split('\n').filter((l) => l.startsWith('-'))).toEqual([]);
      expect(changes.find((c) => c.path === 'new.md')!.patch).toContain('+fresh');
      expect(changes.find((c) => c.path === 'bin.dat')!.patch).toBeUndefined();
      expect(await d.compare(c1.sha, c1.sha)).toEqual([]);
    });

    describe('revert (spec §6.2, schema §5)', () => {
      const unfiled = 'inbox/20260906-070000-2bq.md';
      async function file(d: StorageDriver, capturePath: string, title: string, author: string) {
        const s = await loadSnapshot(d);
        const capture = s.files.get(capturePath) as BrainFile<InboxFm>;
        const batch = buildFiling(s, capture, { title, author }, [{ kind: 'tag', title: 'tag it', rationale: 'r\n' }], { now: NOW });
        const { sha } = await d.commit(batch);
        return { sha, slug: batch.message.slice('File: '.length) };
      }

      it('reverting a filing removes the source folder and its proposal and returns the capture to unfiled', async () => {
        const d = await fresh();
        const before = await loadSnapshot(d);
        const { sha, slug } = await file(d, unfiled, 'Dance', 'Alan Watts');
        expect((await loadSnapshot(d)).files.has(`sources/${slug}/raw.md`)).toBe(true);
        const r = await d.revert(sha, `Reject: ${slug}`);
        expect(await d.head()).toBe(r.sha);
        const after = await loadSnapshot(d);
        expect(after.files.has(`sources/${slug}/raw.md`)).toBe(false);
        expect(after.files.has(`sources/${slug}/notes.md`)).toBe(false);
        expect(after.byType('proposal').length).toBe(before.byType('proposal').length);
        expect((after.files.get(unfiled)!.fm as InboxFm).status).toBe('unfiled');
        expect((after.files.get(unfiled)!.fm as InboxFm).filed_as).toBeUndefined();
        expect(validateSnapshot(after)).toEqual([]);
        expect((await d.history({ limit: 1 }))[0]!.message).toBe(`Reject: ${slug}`);
      });

      it('rejecting an earlier filing after a later filing has landed succeeds', async () => {
        const d = await fresh();
        const a = await file(d, unfiled, 'Dance', 'Alan Watts');
        const h = await d.head();
        await d.commit({ message: 'Capture: 20260906-090000-q2w', expectedHead: h, writes: [{ path: 'inbox/20260906-090000-q2w.md', text: '---\ntype: inbox\nstatus: unfiled\ncurated: human\ncreated: 2026-09-06T09:00:00Z\nupdated: 2026-09-06T09:00:00Z\n---\nLater.\n' }], deletes: [] });
        const b = await file(d, 'inbox/20260906-090000-q2w.md', 'Later', 'Someone Else');
        await d.revert(a.sha, `Reject: ${a.slug}`);
        const s = await loadSnapshot(d);
        expect(s.files.has(`sources/${a.slug}/raw.md`)).toBe(false);
        expect(s.files.has(`sources/${b.slug}/raw.md`)).toBe(true);
        expect((s.files.get('inbox/20260906-090000-q2w.md')!.fm as InboxFm).filed_as).toBe(b.slug);
        expect(validateSnapshot(s)).toEqual([]);
      });

      it('refuses with RevertConflictError when a later commit touched one of the filing\'s files, and changes nothing', async () => {
        const d = await fresh();
        const { sha, slug } = await file(d, unfiled, 'Dance', 'Alan Watts');
        const s = await loadSnapshot(d);
        const notes = s.files.get(`sources/${slug}/notes.md`)!;
        await d.commit({ message: 'edit notes', expectedHead: s.head, writes: [{ path: notes.path, text: notes.body + '\nCurator note.\n' }], deletes: [] });
        const h = await d.head();
        const err = await d.revert(sha, `Reject: ${slug}`).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(RevertConflictError);
        expect((err as RevertConflictError).paths).toEqual([`sources/${slug}/notes.md`]);
        expect(await d.head()).toBe(h);
      });

      it('a decided proposal from the filing also blocks the revert', async () => {
        const d = await fresh();
        const { sha, slug } = await file(d, unfiled, 'Dance', 'Alan Watts');
        const s = await loadSnapshot(d);
        const id = s.byType('proposal').find((p) => p.fm.from_source === slug)!.path.slice('maps/proposals/'.length, -3);
        await d.commit(decideProposal(s, id, 'accepted', NOW));
        const err = await d.revert(sha, `Reject: ${slug}`).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(RevertConflictError);
        expect((err as RevertConflictError).paths).toEqual([`maps/proposals/${id}.md`]);
      });

      it('reverting a commit that deleted and modified files restores them', async () => {
        const d = await fresh();
        const s = await loadSnapshot(d);
        const p = 'principles/ps-g8xw/courage-before-comfort.md';
        const original = (await d.readMany([p])).get(p)!;
        const edit = updatePrinciple(s, p, { body: 'Rewritten.\n', now: NOW });
        edit.deletes.push('sources/.gitkeep');
        const { sha } = await d.commit(edit);
        await d.revert(sha, 'undo');
        expect((await d.readMany([p])).get(p)).toEqual(original);
        expect((await d.list()).some((e) => e.path === 'sources/.gitkeep')).toBe(true);
        expect(validateSnapshot(await loadSnapshot(d))).toEqual([]);
      });
    });
  });
}
