// GitHubDriver against real GitHub (spec §18; Phase 1 item P1-13b). The
// fake in fake-github.ts is a model; this file is what proves the model
// right. It runs only when GNOMON_TEST_TOKEN (a fine-grained token with
// Contents and Administration read/write on all repositories) and
// GNOMON_TEST_REPO (owner/name of the disposable scratch repository) are
// set, which the nightly workflow does; `npm test` skips it.
//
// Every repository this file touches is either GNOMON_TEST_REPO or one it
// created itself, named gnomon-scratch-<run>; it deletes only the latter.

import { afterAll, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toBase64 } from '@gnomon/core';
import { validateSnapshot } from '@gnomon/core';
import { AuthError, GitHubDriver, NotFoundError, StorageError, loadSnapshot } from '../src/index';
import { driverContract } from './contract';
import { readBrainBytes } from './fixture';

const token = process.env['GNOMON_TEST_TOKEN'];
const scratch = process.env['GNOMON_TEST_REPO'];
const runId = (process.env['GNOMON_TEST_RUN'] ?? `local-${Date.now()}`).replace(/[^A-Za-z0-9_.-]/g, '-');
const live = Boolean(token && scratch && /^[^/]+\/[^/]+$/.test(scratch));
const suite = live ? describe : describe.skip;

const TEMPLATE = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'template');
const TEMP_PREFIX = 'gnomon-scratch-';
const API = 'https://api.github.com';
const dec = new TextDecoder();

/** Raw call with the test token; returns the parsed body and status. Used for seeding and cleanup, never through the driver. */
async function api(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let data: any = text;
  try { data = text ? JSON.parse(text) : undefined; } catch { /* not json */ }
  return { status: res.status, data };
}

async function must(method: string, path: string, body?: unknown, ok: number[] = [200, 201, 204]): Promise<any> {
  const r = await api(method, path, body);
  if (!ok.includes(r.status)) throw new Error(`${method} ${path} -> ${r.status}: ${typeof r.data === 'string' ? r.data : JSON.stringify(r.data)}`);
  return r.data;
}

/** Point main at a commit whose tree is exactly `seed` (no base_tree), on top of whatever is there. */
async function resetTo(seed: Map<string, Uint8Array>): Promise<string> {
  const parent: string = (await must('GET', `/repos/${scratch}/git/ref/heads/main`)).object.sha;
  const tree: Array<{ path: string; mode: string; type: string; sha: string }> = [];
  for (const [path, bytes] of seed) {
    const blob = await must('POST', `/repos/${scratch}/git/blobs`, { content: toBase64(bytes), encoding: 'base64' });
    tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const t = await must('POST', `/repos/${scratch}/git/trees`, { tree });
  const c = await must('POST', `/repos/${scratch}/git/commits`, { message: `Seed: nightly ${runId}`, tree: t.sha, parents: [parent] });
  await must('PATCH', `/repos/${scratch}/git/refs/heads/main`, { sha: c.sha, force: true });
  return c.sha;
}

function scratchDriver(): GitHubDriver {
  const [owner, name] = scratch!.split('/') as [string, string];
  return new GitHubDriver({ owner, name, token: token! });
}

suite('GitHubDriver against real GitHub (spec §18, nightly)', () => {
  vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });
  const created: string[] = [];

  afterAll(async () => {
    if (!live) return;
    // Delete what this run created, then any leftover from a run that died before its cleanup. Never anything else.
    const mine = await must('GET', '/user/repos?per_page=100&affiliation=owner&sort=created');
    const leftovers = (mine as Array<{ full_name: string; name: string }>).filter((r) => r.name.startsWith(TEMP_PREFIX)).map((r) => r.full_name);
    for (const fullName of new Set([...created, ...leftovers])) {
      const name = fullName.split('/')[1] ?? '';
      if (!name.startsWith(TEMP_PREFIX)) throw new Error(`refusing to delete ${fullName}: not a temporary scratch repository`);
      const r = await api('DELETE', `/repos/${fullName}`);
      if (![204, 404].includes(r.status)) console.warn(`could not delete ${fullName}: ${r.status}`);
    }
  });

  driverContract('GitHubDriver(real GitHub)', async (seed) => {
    await resetTo(seed);
    return scratchDriver();
  });

  describe('the fake\'s assumptions (tracker P1-13b)', () => {
    it('a fine-grained token has no X-OAuth-Scopes header and push permission on the scratch repository', async () => {
      const d = scratchDriver();
      const who = await d.whoami();
      expect(who.login).toBe(scratch!.split('/')[0]);
      expect(who.scopes).toBeNull();
      const repo = await d.repository();
      expect(repo.fullName.toLowerCase()).toBe(scratch!.toLowerCase());
      expect(repo.defaultBranch).toBe('main');
      expect(repo.permissions).toEqual({ pull: true, push: true });
      await expect(new GitHubDriver({ owner: scratch!.split('/')[0]!, name: `${TEMP_PREFIX}does-not-exist`, token: token! }).repository()).rejects.toBeInstanceOf(NotFoundError);
    });

    it('a tree entry with sha null for a path absent from base_tree is a 422', async () => {
      const head = await resetTo(readBrainBytes());
      const commit = await must('GET', `/repos/${scratch}/git/commits/${head}`);
      const r = await api('POST', `/repos/${scratch}/git/trees`, { base_tree: commit.tree.sha, tree: [{ path: 'does/not/exist.md', mode: '100644', type: 'blob', sha: null }] });
      expect(r.status).toBe(422);
    });

    it('a ref update with force: false is a 422 when it is not a fast-forward', async () => {
      const head = await resetTo(readBrainBytes());
      const d = scratchDriver();
      const { sha } = await d.commit({ message: 'a', expectedHead: head, writes: [{ path: 'a.md', text: 'a' }], deletes: [] });
      const r = await api('PATCH', `/repos/${scratch}/git/refs/heads/main`, { sha: head, force: false });
      expect(r.status).toBe(422);
      expect(await d.head()).toBe(sha);
    });

    it('create-from-template: auto_init exposes the ref, the template lands in one commit, and a name collision is a generic 422', async () => {
      const name = `${TEMP_PREFIX}${runId}`;
      const d = scratchDriver();
      const { fullName, head } = await d.createRepo({ name, private: true });
      created.push(fullName);
      expect(fullName.toLowerCase()).toBe(`${scratch!.split('/')[0]}/${name}`.toLowerCase());
      expect(d.repo).toBe(fullName);
      expect((await d.list()).map((e) => e.path)).toEqual(['README.md']);

      const template = readBrainBytes(TEMPLATE);
      const { sha } = await d.commit({
        message: 'Scaffold: template',
        expectedHead: head,
        writes: [...template].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([path, bytes]) => ({ path, text: dec.decode(bytes) })),
        deletes: [],
      });
      expect(await d.head()).toBe(sha);
      expect((await d.list()).map((e) => e.path)).toEqual([...template.keys()].sort());
      expect(validateSnapshot(await loadSnapshot(d))).toEqual([]);
      expect((await d.history({ limit: 5 })).map((c) => c.message)).toEqual(['Scaffold: template', 'Initial commit']);

      const err = await scratchDriver().createRepo({ name, private: true }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(StorageError);
      expect(err).not.toBeInstanceOf(AuthError);
      expect((err as Error).message).toContain('422');
    });
  });
});
