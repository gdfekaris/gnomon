import { describe, expect, it } from 'vitest';
import { isFrontmatterPath, validateSnapshot } from '@gnomon/core';
import { AuthError, GRAPHQL_BATCH, GitHubDriver, HeadMovedError, NetworkError, RateLimitError, loadSnapshot } from '../src/index';
import { driverContract } from './contract';
import { FakeGitHub } from './fake-github';
import { readBrainBytes } from './fixture';

async function pair(seed = readBrainBytes()) {
  const gh = await FakeGitHub.create(seed);
  const driver = new GitHubDriver({ owner: 'octocat', name: 'brain', token: 'test-token', fetch: gh.fetch });
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

  it('commit is the five-step Git Data sequence and ends with a non-forced ref update', async () => {
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
