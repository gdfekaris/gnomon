// GitHubDriver against real GitHub (spec §18; Phase 1 item P1-13b). The
// fake in fake-github.ts is a model; this file is what proves the model
// right. It runs only when GNOMON_TEST_TOKEN (a fine-grained token with
// Contents read/write on the scratch repository alone) and
// GNOMON_TEST_REPO (owner/name of the disposable scratch repository) are
// set, which the live-github workflow does; `npm test` skips it.
//
// The only repository this file touches is GNOMON_TEST_REPO. Creating a
// repository from the template (onboarding's createRepo) is not tested
// here since 2026-11-19: it needed a token with Administration on every
// repository the maintainer owns, and the maintainer judged that token a
// liability. The fake's model of it stands untested against GitHub.

import { describe, expect, it, vi } from 'vitest';
import { toBase64 } from '@gnomon/core';
import { GitHubDriver, NotFoundError } from '../src/index';
import { driverContract } from './contract';
import { readBrainBytes } from './fixture';

const token = process.env['GNOMON_TEST_TOKEN'];
const scratch = process.env['GNOMON_TEST_REPO'];
const live = Boolean(token && scratch && /^[^/]+\/[^/]+$/.test(scratch));
const suite = live ? describe : describe.skip;

const API = 'https://api.github.com';

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

/** Wait until `GET /git/ref` agrees with a ref update this file made (real GitHub lags for a moment). */
async function settled(sha: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if ((await must('GET', `/repos/${scratch}/git/ref/heads/main`)).object.sha === sha) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`main did not settle on ${sha}`);
}

/**
 * A root commit (no parents) whose tree is exactly `seed`: the contract's
 * history assertions then see only the commits the test made, as they do
 * over the in-memory drivers, instead of every past run's. The objects are
 * reused by every later reset in this run.
 */
const seeded = new Map<string, string>();
async function seedCommit(seed: Map<string, Uint8Array>): Promise<string> {
  const key = [...seed.keys()].sort().join('\n') + ':' + [...seed.values()].reduce((n, b) => n + b.length, 0);
  const known = seeded.get(key);
  if (known) return known;
  const tree: Array<{ path: string; mode: string; type: string; sha: string }> = [];
  for (const [path, bytes] of seed) {
    const blob = await must('POST', `/repos/${scratch}/git/blobs`, { content: toBase64(bytes), encoding: 'base64' });
    tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const t = await must('POST', `/repos/${scratch}/git/trees`, { tree });
  const c = await must('POST', `/repos/${scratch}/git/commits`, { message: `Seed: nightly ${runId}`, tree: t.sha, parents: [] });
  seeded.set(key, c.sha);
  return c.sha;
}

/** Point main at the seed commit for `seed`, making it once and force-moving the ref back to it on every later call. */
async function resetTo(seed: Map<string, Uint8Array>): Promise<string> {
  const sha = await seedCommit(seed);
  await must('PATCH', `/repos/${scratch}/git/refs/heads/main`, { sha, force: true });
  await settled(sha);
  return sha;
}

function scratchDriver(): GitHubDriver {
  const [owner, name] = scratch!.split('/') as [string, string];
  return new GitHubDriver({ owner, name, token: token! });
}

suite('GitHubDriver against real GitHub (spec §18, on demand)', () => {
  vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });
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
      await expect(new GitHubDriver({ owner: scratch!.split('/')[0]!, name: 'gnomon-scratch-does-not-exist', token: token! }).repository()).rejects.toBeInstanceOf(NotFoundError);
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
  });
});
