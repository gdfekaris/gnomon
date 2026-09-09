// An in-memory model of the GitHub endpoints GitHubDriver uses (spec §6.2),
// served through a fetch-compatible function. Faithful in shapes, status
// codes, and git object semantics; the nightly run against a real scratch
// repository is what proves the model right.

import { fromBase64, toBase64 } from '@gnomon/core';
import { gitBlobSha, linePatch } from '../src/index';

interface Commit { sha: string; tree: string; parents: string[]; message: string; date: string; }

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha1 = async (s: string) => hex(await crypto.subtle.digest('SHA-1', enc.encode(s)));
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function isText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export class FakeGitHub {
  readonly blobs = new Map<string, Uint8Array>();
  /** tree sha → path → blob sha (flat; the driver only ever asks for recursive listings) */
  readonly trees = new Map<string, Map<string, string>>();
  readonly commits = new Map<string, Commit>();
  readonly refs = new Map<string, string>();
  readonly requests: Array<{ method: string; path: string }> = [];
  token = 'test-token';
  rateLimited = false;
  /** the token can read but not write: `permissions.push` is false and every write is a 403 */
  readOnly = false;
  /** the token may not create repositories: `POST /user/repos` is a 403 */
  canCreate = true;
  /** a classic token's scopes, sent as `X-OAuth-Scopes` on `GET /user`; unset models a fine-grained token, which has no such header */
  scopes: string | undefined;
  /** runs before every PATCH of a ref; lets a test move the head between the driver's check and its update */
  beforePatch: (() => Promise<void>) | undefined;
  private seq = 0;

  constructor(public owner = 'octocat', public name = 'brain') {}

  static async create(seed: Map<string, Uint8Array>, owner = 'octocat', name = 'brain'): Promise<FakeGitHub> {
    const g = new FakeGitHub(owner, name);
    const tree = new Map<string, string>();
    for (const [path, bytes] of seed) tree.set(path, await g.putBlob(bytes));
    await g.putCommit(await g.putTree(tree), [], 'Initial commit');
    return g;
  }

  async putBlob(bytes: Uint8Array): Promise<string> {
    const sha = await gitBlobSha(bytes);
    this.blobs.set(sha, bytes);
    return sha;
  }
  async putTree(tree: Map<string, string>): Promise<string> {
    const sha = await sha1([...tree].sort().map(([p, s]) => `${p} ${s}`).join('\n'));
    this.trees.set(sha, tree);
    return sha;
  }
  async putCommit(tree: string, parents: string[], message: string): Promise<string> {
    const date = `2026-09-06T12:00:${String(this.seq % 60).padStart(2, '0')}Z`;
    const sha = await sha1(`${tree}|${parents.join(',')}|${message}|${this.seq++}`);
    this.commits.set(sha, { sha, tree, parents, message, date });
    if (parents.length === 0 || this.refs.get('heads/main') === parents[0]) this.refs.set('heads/main', sha);
    return sha;
  }
  /** A commit made "from another device": moves main without going through the driver. */
  async externalCommit(writes: Record<string, string>): Promise<string> {
    const head = this.refs.get('heads/main')!;
    const tree = new Map(this.trees.get(this.commits.get(head)!.tree)!);
    for (const [p, text] of Object.entries(writes)) tree.set(p, await this.putBlob(enc.encode(text)));
    const sha = await this.putCommit(await this.putTree(tree), [head], 'external');
    this.refs.set('heads/main', sha);
    return sha;
  }

  private ancestry(from: string): Commit[] {
    const out: Commit[] = [];
    let sha: string | undefined = from;
    while (sha) {
      const c: Commit | undefined = this.commits.get(sha);
      if (!c) break;
      out.push(c);
      sha = c.parents[0];
    }
    return out;
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
    this.requests.push({ method, path: url.pathname + url.search });

    if (headers.get('authorization') !== `Bearer ${this.token}`) return json(401, { message: 'Bad credentials' });
    if (this.rateLimited) return json(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' });

    if (url.pathname === '/graphql' && method === 'POST') return this.graphql(body as { query: string; variables: { owner: string; name: string } });
    if (url.pathname === '/user' && method === 'GET') {
      return json(200, { login: this.owner, type: 'User' }, this.scopes === undefined ? {} : { 'x-oauth-scopes': this.scopes });
    }
    if (this.readOnly && method !== 'GET') return json(403, { message: 'Resource not accessible by personal access token' });
    if (url.pathname === '/user/repos' && method === 'POST') {
      if (!this.canCreate) return json(403, { message: 'Resource not accessible by personal access token' });
      const name = String(body['name']);
      this.owner = 'octocat';
      this.name = name;
      this.commits.clear();
      this.trees.clear();
      this.refs.clear();
      const readme = enc.encode(`# ${name}\n`);
      const tree = new Map([['README.md', await this.putBlob(readme)]]);
      await this.putCommit(await this.putTree(tree), [], 'Initial commit');
      return json(201, { full_name: `octocat/${name}`, owner: { login: 'octocat' }, name, default_branch: 'main' });
    }

    const bare = /^\/repos\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (bare && method === 'GET') {
      if (bare[1] !== this.owner || bare[2] !== this.name) return json(404, { message: 'Not Found' });
      return json(200, {
        full_name: `${this.owner}/${this.name}`, name: this.name, owner: { login: this.owner }, private: true, default_branch: 'main',
        permissions: { admin: false, maintain: false, push: !this.readOnly, triage: false, pull: true },
      });
    }

    const m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)$/.exec(url.pathname);
    if (!m || m[1] !== this.owner || m[2] !== this.name) return json(404, { message: 'Not Found' });
    const rest = m[3]!;

    let r: RegExpExecArray | null;
    if ((r = /^\/git\/ref\/heads\/(.+)$/.exec(rest)) && method === 'GET') {
      const sha = this.refs.get(`heads/${r[1]}`);
      return sha ? json(200, { ref: `refs/heads/${r[1]}`, object: { type: 'commit', sha } }) : json(404, { message: 'Not Found' });
    }
    if ((r = /^\/git\/refs\/heads\/(.+)$/.exec(rest)) && method === 'PATCH') {
      if (this.beforePatch) await this.beforePatch();
      const current = this.refs.get(`heads/${r[1]}`)!;
      const next = this.commits.get(String(body['sha']));
      if (!next) return json(422, { message: 'Object does not exist' });
      if (body['force'] !== true && next.parents[0] !== current) return json(422, { message: 'Update is not a fast forward' });
      this.refs.set(`heads/${r[1]}`, next.sha);
      return json(200, { ref: `refs/heads/${r[1]}`, object: { type: 'commit', sha: next.sha } });
    }
    if ((r = /^\/git\/trees\/([0-9a-f]+)$/.exec(rest)) && method === 'GET') {
      const sha = r[1]!;
      const tree = this.trees.get(sha) ?? (this.commits.has(sha) ? this.trees.get(this.commits.get(sha)!.tree) : undefined);
      if (!tree) return json(404, { message: 'Not Found' });
      return json(200, { sha, truncated: false, tree: [...tree].sort().map(([path, blob]) => ({ path, mode: '100644', type: 'blob', sha: blob, size: this.blobs.get(blob)!.length })) });
    }
    if (rest === '/git/trees' && method === 'POST') {
      const base = this.trees.get(String(body['base_tree']));
      if (!base) return json(404, { message: 'Not Found' });
      const tree = new Map(base);
      for (const e of body['tree'] as Array<{ path: string; sha: string | null }>) {
        if (e.sha === null) {
          if (!tree.has(e.path)) return json(422, { message: `GitRPC::BadObjectState: ${e.path} does not exist in the base tree` });
          tree.delete(e.path);
        } else {
          if (!this.blobs.has(e.sha)) return json(422, { message: 'Tree SHA does not exist' });
          tree.set(e.path, e.sha);
        }
      }
      return json(201, { sha: await this.putTree(tree) });
    }
    if ((r = /^\/git\/commits\/([0-9a-f]+)$/.exec(rest)) && method === 'GET') {
      const c = this.commits.get(r[1]!);
      if (!c) return json(404, { message: 'Not Found' });
      return json(200, { sha: c.sha, tree: { sha: c.tree }, parents: c.parents.map((sha) => ({ sha })), message: c.message, committer: { date: c.date } });
    }
    if (rest === '/git/commits' && method === 'POST') {
      const parents = body['parents'] as string[];
      if (!this.trees.has(String(body['tree']))) return json(422, { message: 'Tree SHA does not exist' });
      const sha = await sha1(`${body['tree']}|${parents.join(',')}|${body['message']}|${this.seq}`);
      this.commits.set(sha, { sha, tree: String(body['tree']), parents, message: String(body['message']), date: `2026-09-06T12:01:${String(this.seq++ % 60).padStart(2, '0')}Z` });
      return json(201, { sha });
    }
    if (rest === '/git/blobs' && method === 'POST') {
      if (body['encoding'] !== 'base64') return json(422, { message: 'unsupported encoding' });
      return json(201, { sha: await this.putBlob(fromBase64(String(body['content']))) });
    }
    if ((r = /^\/git\/blobs\/([0-9a-f]+)$/.exec(rest)) && method === 'GET') {
      const bytes = this.blobs.get(r[1]!);
      return bytes ? json(200, { sha: r[1], size: bytes.length, encoding: 'base64', content: toBase64(bytes) }) : json(404, { message: 'Not Found' });
    }
    if (rest === '/commits' && method === 'GET') {
      const q = url.searchParams;
      const head = this.refs.get(`heads/${q.get('sha') ?? 'main'}`)!;
      const path = q.get('path');
      const limit = Number(q.get('per_page') ?? 30);
      const out = [];
      for (const c of this.ancestry(head)) {
        if (path !== null) {
          const before = c.parents[0] ? this.trees.get(this.commits.get(c.parents[0])!.tree)!.get(path) : undefined;
          if (before === this.trees.get(c.tree)!.get(path)) continue;
        }
        out.push({ sha: c.sha, commit: { message: c.message, committer: { date: c.date } }, parents: c.parents.map((sha) => ({ sha })) });
        if (out.length >= limit) break;
      }
      return json(200, out);
    }
    if ((r = /^\/compare\/([0-9a-f]+)\.\.\.([0-9a-f]+)$/.exec(rest)) && method === 'GET') {
      const a = this.commits.get(r[1]!);
      const b = this.commits.get(r[2]!);
      if (!a || !b) return json(404, { message: 'Not Found' });
      const ta = this.trees.get(a.tree)!;
      const tb = this.trees.get(b.tree)!;
      const files = [];
      for (const path of [...new Set([...ta.keys(), ...tb.keys()])].sort()) {
        const x = ta.get(path);
        const y = tb.get(path);
        if (x === y) continue;
        const status = !x ? 'added' : !y ? 'removed' : 'modified';
        const xb = x ? this.blobs.get(x)! : undefined;
        const yb = y ? this.blobs.get(y)! : undefined;
        const file: { filename: string; status: string; patch?: string } = { filename: path, status };
        if ((!xb || isText(xb)) && (!yb || isText(yb))) file.patch = linePatch(xb ? new TextDecoder().decode(xb) : '', yb ? new TextDecoder().decode(yb) : '');
        files.push(file);
      }
      return json(200, { files });
    }
    return json(404, { message: `unmodelled: ${method} ${rest}` });
  };

  private graphql(body: { query: string; variables: { owner: string; name: string } }): Response {
    if (body.variables.owner !== this.owner || body.variables.name !== this.name) return json(200, { data: { repository: null }, errors: [{ message: 'Could not resolve to a Repository' }] });
    const repository: Record<string, unknown> = {};
    for (const m of body.query.matchAll(/(f\d+): object\(expression: ("(?:[^"\\]|\\.)*")\)/g)) {
      const expr = JSON.parse(m[2]!) as string;
      const [commitSha, path] = expr.split(/:(.*)/s) as [string, string];
      const commit = this.commits.get(commitSha);
      const blob = commit ? this.trees.get(commit.tree)!.get(path) : undefined;
      if (!blob) {
        repository[m[1]!] = null;
        continue;
      }
      const bytes = this.blobs.get(blob)!;
      const binary = !isText(bytes);
      repository[m[1]!] = { oid: blob, isBinary: binary, text: binary ? null : new TextDecoder().decode(bytes) };
    }
    return json(200, { data: { repository } });
  }
}
