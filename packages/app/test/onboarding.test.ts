import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { indexWrites, validateLayout, validateSnapshot } from '@gnomon/core';
import { GitHubDriver } from '@gnomon/storage';
import { FakeGitHub } from '../../storage/test/fake-github';
import { readBrainBytes } from '../../storage/test/fixture';
import { SCAFFOLD } from '../src/lib/scaffold';
import { BrainService, type SnapshotState } from '../src/lib/services/brain';
import { createFromTemplate, validateToken } from '../src/lib/services/onboarding';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEMPLATE = join(here, '..', '..', '..', 'template');
function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(root, full).split('\\').join('/'));
    }
  };
  walk(root);
  return out.sort();
}

const fresh = () => {
  const gh = new FakeGitHub('nobody', 'nothing');
  const driver = new GitHubDriver({ owner: '', name: '', token: 'test-token', fetch: gh.fetch });
  return { gh, driver };
};
const check = (gh: FakeGitHub, extra: Partial<Parameters<typeof validateToken>[0]> = {}) => validateToken({ token: 'test-token', fetch: gh.fetch, ...extra });

describe('SCAFFOLD (spec §13)', () => {
  it('is the whole template/ tree, dot-files included', () => {
    const disk = listFiles(TEMPLATE);
    expect([...SCAFFOLD.keys()].sort()).toEqual(disk);
    expect(disk).toContain('.gitignore');
    expect(disk).toContain('inbox/.gitkeep');
    expect(disk).toContain('.claude/commands/capture.md');
    expect(SCAFFOLD.get('inbox/.gitkeep')).toBe('');
  });
});

describe('createFromTemplate (spec §12 step 3, US-14)', () => {
  it('leaves a fresh repository as the template in one commit on top of auto_init, valid and indexed', async () => {
    const { gh, driver } = fresh();
    const r = await createFromTemplate(driver, 'brain', SCAFFOLD);
    expect(r).toMatchObject({ ok: true, fullName: 'octocat/brain' });
    expect(driver.repo).toBe('octocat/brain');

    const tree = await driver.list();
    expect(tree.map((e) => e.path)).toEqual(listFiles(TEMPLATE));
    expect((await driver.history({ limit: 10 })).map((c) => c.message)).toEqual(['Scaffold: template', 'Initial commit']);
    expect((await driver.readMany(['README.md'])).get('README.md')!.text).toBe(SCAFFOLD.get('README.md'));
    expect(gh.requests.filter((q) => q.method === 'PATCH').length).toBe(1);

    const state: SnapshotState = { current: null, stale: false, loading: false, error: null };
    const snapshot = await new BrainService(state).connect(driver);
    expect(validateLayout(tree)).toEqual([]);
    expect(validateSnapshot(snapshot)).toEqual([]);
    expect(indexWrites(snapshot)).toEqual([]);
    expect(snapshot.files.has('principles/ps-g8xw/_set.md')).toBe(true);
    expect(r.ok && r.head).toBe(snapshot.head);
  });

  it('explains a token that may not create repositories, and creates nothing', async () => {
    const { gh, driver } = fresh();
    gh.canCreate = false;
    const r = await createFromTemplate(driver, 'brain', SCAFFOLD);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/would not let this token create a repository/);
    expect(!r.ok && r.reason).toMatch(/Administration read and write/);
    expect(gh.commits.size).toBe(0);
  });

  it('refuses a name GitHub would refuse before calling it', async () => {
    const { gh, driver } = fresh();
    const r = await createFromTemplate(driver, 'my brain!', SCAFFOLD);
    expect(!r.ok && r.reason).toMatch(/letters, digits/);
    expect(gh.requests).toEqual([]);
  });
});

describe('validateToken (spec §12 step 2)', () => {
  it('reports a fine-grained token by the absence of a scopes header', async () => {
    const { gh } = fresh();
    expect(await check(gh)).toEqual({ ok: true, login: 'nobody', kind: 'fine-grained' });
  });

  it('reports a classic token and warns when the repo scope is missing', async () => {
    const { gh } = fresh();
    gh.scopes = 'repo, read:org';
    expect(await check(gh)).toEqual({ ok: true, login: 'nobody', kind: 'classic' });
    gh.scopes = 'read:user, gist';
    const r = await check(gh);
    expect(r).toMatchObject({ ok: true, kind: 'classic' });
    expect(r.ok && r.warning).toMatch(/no "repo" scope/);
  });

  it('explains a rejected token, a rate limit, a lost connection, and an empty field', async () => {
    const { gh } = fresh();
    expect(await check(gh, { token: 'wrong' })).toEqual({ ok: false, reason: expect.stringMatching(/rejected the token/) });
    gh.rateLimited = true;
    expect(await check(gh)).toEqual({ ok: false, reason: expect.stringMatching(/rate limit/) });
    const offline = await validateToken({ token: 'test-token', fetch: async () => { throw new TypeError('fetch failed'); } });
    expect(offline).toEqual({ ok: false, reason: expect.stringMatching(/Could not reach GitHub/) });
    expect(await validateToken({ token: '  ' })).toEqual({ ok: false, reason: 'Paste the token first.' });
  });

  it('probes a named repository: invisible, read-only, or writable', async () => {
    const gh = await FakeGitHub.create(readBrainBytes());
    expect(await check(gh, { owner: 'octocat', name: 'brain' })).toEqual({ ok: true, login: 'octocat', kind: 'fine-grained' });
    expect(await check(gh, { owner: 'octocat', name: 'elsewhere' })).toEqual({ ok: false, reason: expect.stringMatching(/cannot see octocat\/elsewhere/) });
    gh.readOnly = true;
    expect(await check(gh, { owner: 'octocat', name: 'brain' })).toEqual({ ok: false, reason: expect.stringMatching(/can read octocat\/brain but not write/) });
  });
});
