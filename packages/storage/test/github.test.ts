import { describe, expect, it } from 'vitest';
import { isFrontmatterPath, validateSnapshot } from '@gnomon/core';
import { AuthError, CONTENT_RATE, GRAPHQL_BATCH, GitHubDriver, HeadMovedError, NetworkError, NotFoundError, RETRY_DELAYS_MS, RateLimitError, loadSnapshot } from '../src/index';
import { driverContract } from './contract';
import { FakeGitHub } from './fake-github';
import { readBrainBytes } from './fixture';

// The fake has no secondary limit, so the driver's pacing is off here; one test below turns it on.
const UNPACED = { perWindow: Infinity, windowMs: 0 };

async function pair(seed = readBrainBytes()) {
  const gh = await FakeGitHub.create(seed);
  const driver = new GitHubDriver({ owner: 'octocat', name: 'brain', token: 'test-token', fetch: gh.fetch, contentRate: UNPACED });
  return { gh, driver };
}

driverContract('GitHubDriver(FakeGitHub)', async (seed) => (await pair(seed)).driver);

describe('GitHubDriver against the fake API (spec §6.2)', () => {
  it('sends the token, the JSON accept header, and the API version on every request', async () => {
    const gh = await FakeGitHub.create(readBrainBytes());
    let seen: Headers | undefined;
    const spy: typeof fetch = (input, init) => {
      seen = new Headers(init?.headers);
      return gh.fetch(input, init);
    };
    const driver = new GitHubDriver({ owner: 'octocat', name: 'brain', token: 'test-token', fetch: spy });
    await driver.head();
    expect(seen!.get('authorization')).toBe('Bearer test-token');
    expect(seen!.get('accept')).toBe('application/vnd.github+json');
    expect(seen!.get('x-github-api-version')).toBe('2022-11-28');
  });

  it('loads a 500-file brain in one tree call plus at most six GraphQL batches', async () => {
    const seed = readBrainBytes();
    for (let i = 0; i < 480; i++) {
      seed.set(`inbox/20260906-${String(100000 + i).slice(-6)}-abc.md`, new TextEncoder().encode(`---\ntype: inbox\nstatus: unfiled\ncurated: human\ncreated: 2026-09-06\nupdated: 2026-09-06\n---\nn${i}\n`));
    }
    const { gh, driver } = await pair(seed);
    const s = await loadSnapshot(driver);
    const md = [...seed.keys()].filter(isFrontmatterPath).length;
    expect(s.files.size).toBe(md);
    expect(gh.requests.filter((r) => r.path.startsWith('/repos/octocat/brain/git/trees/')).length).toBe(1);
    expect(gh.requests.filter((r) => r.path === '/graphql').length).toBe(Math.ceil(md / GRAPHQL_BATCH));
    expect(gh.requests.filter((r) => r.path === '/graphql').length).toBeLessThanOrEqual(6);
    expect(validateSnapshot(s)).toEqual([]);
  });

  it('commit is the five-step Git Data sequence, a non-forced ref update, then a history read to see it', async () => {
    const { gh, driver } = await pair();
    const head = await driver.head();
    gh.requests.length = 0;
    await driver.commit({ message: 'x', expectedHead: head, writes: [{ path: 'a.md', text: 'a' }, { path: 'b.bin', bytes: new Uint8Array([0, 1]) }], deletes: ['inbox/.gitkeep'] });
    expect(gh.requests.map((r) => `${r.method} ${r.path.replace(/\/repos\/octocat\/brain/, '')}`)).toEqual([
      'GET /git/ref/heads/main',
      `GET /git/commits/${head}`,
      'POST /git/blobs',
      'POST /git/blobs',
      'POST /git/trees',
      'POST /git/commits',
      'PATCH /git/refs/heads/main',
      'GET /commits?sha=main&per_page=1',
    ]);
  });

  it('a head that moves between the ref check and the ref update surfaces as HeadMovedError', async () => {
    const { gh, driver } = await pair();
    const head = await driver.head();
    let moved = '';
    gh.beforePatch = async () => {
      gh.beforePatch = undefined;
      moved = await gh.externalCommit({ 'race.md': 'from another device\n' });
    };
    const err = await driver.commit({ message: 'x', expectedHead: head, writes: [{ path: 'a.md', text: 'a' }], deletes: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HeadMovedError);
    expect((err as HeadMovedError).actual).toBe(moved);
    expect(await driver.head()).toBe(moved);
  });

  it('after its own commit the driver reports that head however long the ref read lags, and waits for the commits listing', async () => {
    const { gh, driver } = await pair();
    const head = await driver.head();
    gh.staleRefReads = 1000;
    gh.staleHistoryReads = 2;
    gh.requests.length = 0;
    const { sha } = await driver.commit({ message: 'Ratify: x', expectedHead: head, writes: [{ path: 'a.md', text: 'a' }], deletes: [] });
    expect(await driver.head()).toBe(sha);
    expect((await driver.history({ limit: 1 }))[0]!.sha).toBe(sha);
    expect(gh.requests.filter((r) => r.path.startsWith('/repos/octocat/brain/commits?')).length).toBe(3 + 1);
    // A refresh right after the commit sees the commit's content, not the parent's.
    const s = await loadSnapshot(driver);
    expect(s.head).toBe(sha);
    expect((await driver.list()).some((e) => e.path === 'a.md')).toBe(true);
    // The next commit builds on the real head, so it lands.
    const next = await driver.commit({ message: 'y', expectedHead: sha, writes: [{ path: 'b.md', text: 'b' }], deletes: [] });
    expect(await driver.head()).toBe(next.sha);
    // A head moved by someone else is reported as such.
    gh.staleRefReads = 0;
    gh.stale = undefined;
    const moved = await gh.externalCommit({ 'race.md': 'other device\n' });
    expect(await driver.head()).toBe(moved);
  });

  it('a dropped connection is retried before it is a NetworkError; creating a repository never is', async () => {
    const { gh, driver } = await pair();
    const head = await driver.head();
    gh.dropNext = 2;
    expect(await driver.head()).toBe(head);
    gh.dropNext = 1;
    await driver.commit({ message: 'x', expectedHead: head, writes: [{ path: 'a.md', text: 'a' }], deletes: [] });
    gh.dropNext = RETRY_DELAYS_MS.length + 1;
    const err = await driver.head().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as Error).message).toBe('GET /git/ref/heads/main: fetch failed (other side closed)');
    gh.dropNext = 1;
    await expect(driver.createRepo({ name: 'second-brain', private: true })).rejects.toBeInstanceOf(NetworkError);
    expect(driver.repo).toBe('octocat/brain');
  });

  it('content-generating requests are paced under GitHub\'s secondary limit; reads are not', async () => {
    const gh = await FakeGitHub.create(readBrainBytes());
    const driver = new GitHubDriver({ owner: 'octocat', name: 'brain', token: 'test-token', fetch: gh.fetch, contentRate: { perWindow: 4, windowMs: 400 } });
    const head = await driver.head();
    const writes = Array.from({ length: 10 }, (_, i) => ({ path: `w${i}.md`, text: `${i}` }));
    const t0 = Date.now();
    await driver.commit({ message: 'many', expectedHead: head, writes, deletes: [] });
    // 10 blobs + tree + commit + ref = 13 sends in windows of 4: at least three window waits.
    expect(Date.now() - t0).toBeGreaterThanOrEqual(3 * 400 - 50);
    expect(gh.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/git/blobs')).length).toBe(10);
    const t1 = Date.now();
    for (let i = 0; i < 20; i++) await driver.head();
    expect(Date.now() - t1).toBeLessThan(300);
  });

  it('the secondary rate limit (a 403 with Retry-After) is a RateLimitError, not an AuthError', async () => {
    const { gh, driver } = await pair();
    const head = await driver.head();
    gh.secondaryLimited = true;
    const err = await driver.commit({ message: 'x', expectedHead: head, writes: [{ path: 'a.md', text: 'a' }], deletes: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as Error).message).toContain('retry after 60 seconds');
    expect(await driver.head()).toBe(head);
  });

  it('binary blobs reported by GraphQL fall back to the blob endpoint', async () => {
    const seed = readBrainBytes();
    seed.set('sources/weil-attention/notes.md', new Uint8Array([0xff, 0xfe, 0, 1]));
    const { gh, driver } = await pair(seed);
    const got = await driver.readMany(['sources/weil-attention/notes.md', 'AGENTS.md']);
    expect(got.get('AGENTS.md')!.text).toContain('AGENTS.md');
    expect(got.has('sources/weil-attention/notes.md')).toBe(true);
    expect(gh.requests.some((r) => /\/git\/blobs\/[0-9a-f]+$/.test(r.path))).toBe(true);
  });

  it('maps 401 to AuthError, rate limits to RateLimitError, and a thrown fetch to NetworkError', async () => {
    const { gh } = await pair();
    const bad = new GitHubDriver({ owner: 'octocat', name: 'brain', token: 'wrong', fetch: gh.fetch });
    await expect(bad.head()).rejects.toBeInstanceOf(AuthError);
    const driver = new GitHubDriver({ owner: 'octocat', name: 'brain', token: 'test-token', fetch: gh.fetch });
    gh.rateLimited = true;
    const err = await driver.head().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as Error).message).toContain('1800000000');
    const offline = new GitHubDriver({ owner: 'octocat', name: 'brain', token: 'test-token', fetch: async () => { throw new TypeError('fetch failed'); } });
    await expect(offline.head()).rejects.toBeInstanceOf(NetworkError);
  });

  it('whoami returns the login and, for a classic token only, the scopes header', async () => {
    const { gh, driver } = await pair();
    expect(await driver.whoami()).toEqual({ login: 'octocat', scopes: null });
    gh.scopes = 'repo, read:org';
    expect(await driver.whoami()).toEqual({ login: 'octocat', scopes: ['repo', 'read:org'] });
    gh.scopes = '';
    expect(await driver.whoami()).toEqual({ login: 'octocat', scopes: [] });
    await expect(new GitHubDriver({ owner: 'octocat', name: 'brain', token: 'nope', fetch: gh.fetch }).whoami()).rejects.toBeInstanceOf(AuthError);
  });

  it('repository reports push permission; a read-only token also gets a 403 on every write', async () => {
    const { gh, driver } = await pair();
    expect(await driver.repository()).toEqual({ fullName: 'octocat/brain', defaultBranch: 'main', permissions: { pull: true, push: true } });
    gh.readOnly = true;
    expect((await driver.repository()).permissions.push).toBe(false);
    const head = await driver.head();
    await expect(driver.commit({ message: 'x', expectedHead: head, writes: [{ path: 'a.md', text: 'a' }], deletes: [] })).rejects.toBeInstanceOf(AuthError);
    const other = new GitHubDriver({ owner: 'octocat', name: 'elsewhere', token: 'test-token', fetch: gh.fetch });
    await expect(other.repository()).rejects.toBeInstanceOf(NotFoundError);
  });

  it('createRepo is refused with an AuthError when the token may not create repositories', async () => {
    const { gh, driver } = await pair();
    gh.canCreate = false;
    await expect(driver.createRepo({ name: 'second-brain', private: true })).rejects.toBeInstanceOf(AuthError);
    expect(driver.repo).toBe('octocat/brain');
  });

  it('createRepo uses auto_init and retargets the driver at the new repository', async () => {
    const { gh, driver } = await pair();
    const { fullName, head } = await driver.createRepo({ name: 'second-brain', private: true });
    expect(fullName).toBe('octocat/second-brain');
    expect(driver.repo).toBe('octocat/second-brain');
    expect(await driver.head()).toBe(head);
    expect((await driver.list()).map((e) => e.path)).toEqual(['README.md']);
    expect(gh.requests.find((r) => r.path === '/user/repos')!.method).toBe('POST');
  });
});
