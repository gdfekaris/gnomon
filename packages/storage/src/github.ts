// GitHubDriver — spec §6.2. Plain fetch, no Octokit. REST Git Data API for
// writes (one commit per batch), GraphQL for batched reads, REST for
// history and compare. Every response is mapped to a typed error (spec §14).

import type { CommitBatch, ReadResult, TreeEntry } from '@gnomon/core';
import { fromBase64, toBase64 } from '@gnomon/core';
import type { CommitInfo, FileChange, StorageDriver } from './driver';
import { AuthError, HeadMovedError, NetworkError, NotFoundError, RateLimitError, RevertConflictError, StorageError } from './errors';

export interface GitHubDriverOptions {
  owner: string;
  name: string;
  /** fine-grained PAT with Contents read/write on this repository */
  token: string;
  branch?: string;
  apiBase?: string;
  fetch?: typeof fetch;
  /** pacing of content-generating requests; defaults to CONTENT_RATE, which matches real GitHub */
  contentRate?: { perWindow: number; windowMs: number };
}

interface GitTree { sha: string; tree: Array<{ path: string; type: string; sha: string; size?: number }>; truncated?: boolean }
interface GitCommit { sha: string; tree: { sha: string }; parents: Array<{ sha: string }>; message: string; committer: { date: string } }

export const GRAPHQL_BATCH = 100;
/** A dropped connection is retried this many times, with these pauses, before it is a NetworkError. Never for POST /user/repos, which is not idempotent. */
export const RETRY_DELAYS_MS = [300, 900];
/** After a ref update, GitHub may serve the previous sha for a moment; the driver rereads until it sees its own write, at most this often. */
export const REF_SETTLE = { tries: 12, delayMs: 250 };
/**
 * GitHub's secondary limit allows 80 content-generating requests (POST, PATCH,
 * PUT, DELETE) a minute per token, then answers 403 for a while. The driver
 * never sends more than this many in a window; a normal commit is far below
 * it, and a large one is paced rather than refused.
 */
export const CONTENT_RATE = { perWindow: 72, windowMs: 60_000 };
const enc = new TextEncoder();
const dec = new TextDecoder();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class GitHubDriver implements StorageDriver {
  private owner: string;
  private name: string;
  private readonly branch: string;
  private readonly apiBase: string;
  private readonly token: string;
  private readonly fetchFn: typeof fetch;
  /** path → blob sha from the last list(), for readBytes */
  private treeCache = new Map<string, string>();
  private readonly rate: { perWindow: number; windowMs: number };
  /** send times of recent content-generating requests, for `rate` */
  private readonly sent: number[] = [];
  /** the last commit this driver made and what it was made on: a ref read that still says the parent is a lagging read */
  private lastWrite: { parent: string; sha: string } | null = null;

  constructor(opts: GitHubDriverOptions) {
    this.owner = opts.owner;
    this.name = opts.name;
    this.branch = opts.branch ?? 'main';
    this.apiBase = (opts.apiBase ?? 'https://api.github.com').replace(/\/$/, '');
    this.token = opts.token;
    this.rate = opts.contentRate ?? CONTENT_RATE;
    // Called unbound: browsers throw "Illegal invocation" when window.fetch runs with another `this`.
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  get repo(): string {
    return `${this.owner}/${this.name}`;
  }

  // ---------------------------------------------------------------- http

  private async request<T>(method: string, path: string, body?: unknown, okStatuses: number[] = [200, 201]): Promise<T> {
    return (await this.requestWithHeaders<T>(method, path, body, okStatuses)).data;
  }

  private async requestWithHeaders<T>(method: string, path: string, body?: unknown, okStatuses: number[] = [200, 201]): Promise<{ data: T; headers: Headers }> {
    const url = path.startsWith('/repos/') || path.startsWith('/user') || path === '/graphql' ? `${this.apiBase}${path}` : `${this.apiBase}/repos/${this.repo}${path}`;
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
    // Every call here is safe to repeat: reads, content-addressed object creation, and a ref
    // update to one sha. Creating a repository is the exception, so a drop there surfaces at once.
    const retries = method === 'POST' && path === '/user/repos' ? [] : RETRY_DELAYS_MS;
    let res: Response | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        if (method !== 'GET' && path !== '/graphql') await this.pace();
        res = await this.fetchFn(url, init);
        break;
      } catch (e) {
        const delay = retries[attempt];
        if (delay === undefined) {
          const cause = (e as { cause?: { message?: string } }).cause?.message;
          throw new NetworkError(`${method} ${path}: ${(e as Error).message}${cause ? ` (${cause})` : ''}`);
        }
        await sleep(delay);
      }
    }
    if (okStatuses.includes(res.status)) return { data: (res.status === 204 ? undefined : await res.json()) as T, headers: res.headers };
    const text = await res.text();
    let message = text;
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {
      /* not json */
    }
    if (res.status === 401) throw new AuthError(`GitHub rejected the token: ${message}`);
    if (res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')) {
      throw new RateLimitError(`GitHub rate limit reached; resets at ${res.headers.get('x-ratelimit-reset') ?? 'unknown'}`);
    }
    // The secondary limit is a 403 with a Retry-After header (and a message saying so), not a 429.
    if (res.status === 403 && (res.headers.has('retry-after') || /secondary rate limit/i.test(message))) {
      throw new RateLimitError(`GitHub secondary rate limit reached; retry after ${res.headers.get('retry-after') ?? '60'} seconds`);
    }
    if (res.status === 403) throw new AuthError(`GitHub refused ${method} ${path}: ${message}`);
    if (res.status === 404) throw new NotFoundError(path);
    throw new StorageError(`GitHub ${res.status} on ${method} ${path}: ${message}`);
  }

  /** Hold a content-generating request until sending it keeps the last window under `rate`. */
  private async pace(): Promise<void> {
    for (;;) {
      const now = Date.now();
      while (this.sent.length && now - this.sent[0]! >= this.rate.windowMs) this.sent.shift();
      if (this.sent.length < this.rate.perWindow) break;
      await sleep(this.sent[0]! + this.rate.windowMs - now + 1);
    }
    this.sent.push(Date.now());
  }

  // ---------------------------------------------------------------- token probes (spec §12 step 2)

  /**
   * `GET /user`: who the token belongs to. `scopes` is the parsed
   * `X-OAuth-Scopes` header, which only classic tokens carry; a fine-grained
   * token yields null, and GitHub offers no endpoint that lists its permissions.
   */
  async whoami(): Promise<{ login: string; scopes: string[] | null }> {
    const { data, headers } = await this.requestWithHeaders<{ login: string }>('GET', '/user');
    const raw = headers.get('x-oauth-scopes');
    const scopes = raw === null ? null : raw.split(',').map((s) => s.trim()).filter(Boolean);
    return { login: data.login, scopes };
  }

  /** `GET /repos/<owner>/<name>`: what this token may do to the repository. A repository the token cannot see is a NotFoundError. */
  async repository(): Promise<{ fullName: string; defaultBranch: string; permissions: { pull: boolean; push: boolean } }> {
    const r = await this.request<{ full_name: string; default_branch: string; permissions?: { pull?: boolean; push?: boolean } }>('GET', `/repos/${this.repo}`);
    return { fullName: r.full_name, defaultBranch: r.default_branch, permissions: { pull: r.permissions?.pull ?? false, push: r.permissions?.push ?? false } };
  }

  // ---------------------------------------------------------------- reads

  async head(): Promise<string> {
    const ref = await this.request<{ object: { sha: string } }>('GET', `/git/ref/heads/${this.branch}`);
    // Real GitHub can serve the previous sha for a while after a successful ref update. The update was
    // confirmed by the PATCH, so a read that still names the parent of this driver's own last commit is
    // behind, not a moved head; anything else (another device's commit, a revert) is taken as read.
    if (this.lastWrite && ref.object.sha === this.lastWrite.parent) return this.lastWrite.sha;
    return ref.object.sha;
  }

  async list(): Promise<TreeEntry[]> {
    const head = await this.head();
    const tree = await this.request<GitTree>('GET', `/git/trees/${head}?recursive=1`);
    if (tree.truncated) throw new StorageError('the repository tree is too large for one listing');
    const entries = tree.tree.filter((e) => e.type === 'blob').map((e) => ({ path: e.path, sha: e.sha, size: e.size ?? 0 }));
    this.treeCache = new Map(entries.map((e) => [e.path, e.sha]));
    return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  async readMany(paths: string[]): Promise<Map<string, ReadResult>> {
    const out = new Map<string, ReadResult>();
    if (paths.length === 0) return out;
    const head = await this.head();
    for (let i = 0; i < paths.length; i += GRAPHQL_BATCH) {
      const batch = paths.slice(i, i + GRAPHQL_BATCH);
      const fields = batch.map((p, j) => `f${j}: object(expression: ${JSON.stringify(`${head}:${p}`)}) { ... on Blob { oid text isBinary } }`).join('\n');
      const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) {\n${fields}\n} }`;
      const res = await this.request<{ data?: { repository?: Record<string, { oid: string; text: string | null; isBinary: boolean } | null> }; errors?: Array<{ message: string }> }>(
        'POST', '/graphql', { query, variables: { owner: this.owner, name: this.name } },
      );
      if (res.errors?.length) throw new StorageError(`GraphQL: ${res.errors.map((e) => e.message).join('; ')}`);
      const repo = res.data?.repository ?? {};
      for (let j = 0; j < batch.length; j++) {
        const blob = repo[`f${j}`];
        const path = batch[j]!;
        if (!blob) continue;
        if (blob.isBinary || blob.text === null) {
          const { bytes } = await this.readBlob(blob.oid);
          out.set(path, { text: dec.decode(bytes), sha: blob.oid });
        } else out.set(path, { text: blob.text, sha: blob.oid });
      }
    }
    return out;
  }

  private async readBlob(sha: string): Promise<{ bytes: Uint8Array; sha: string }> {
    const blob = await this.request<{ sha: string; content: string; encoding: string }>('GET', `/git/blobs/${sha}`);
    if (blob.encoding !== 'base64') throw new StorageError(`unexpected blob encoding '${blob.encoding}'`);
    return { bytes: fromBase64(blob.content), sha: blob.sha };
  }

  async readBytes(path: string): Promise<{ bytes: Uint8Array; sha: string }> {
    let sha = this.treeCache.get(path);
    if (sha === undefined) {
      await this.list();
      sha = this.treeCache.get(path);
    }
    if (sha === undefined) throw new NotFoundError(path);
    return this.readBlob(sha);
  }

  // ---------------------------------------------------------------- writes

  private async commitObject(sha: string): Promise<GitCommit> {
    return this.request<GitCommit>('GET', `/git/commits/${sha}`);
  }

  private async flatTree(treeSha: string): Promise<Map<string, string>> {
    const tree = await this.request<GitTree>('GET', `/git/trees/${treeSha}?recursive=1`);
    if (tree.truncated) throw new StorageError('the repository tree is too large for one listing');
    return new Map(tree.tree.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]));
  }

  /** Steps 3–5 of spec §6.2: tree on base, commit on parent, ref update with force: false. */
  private async finish(baseTreeSha: string, parent: string, entries: Array<{ path: string; sha: string | null }>, message: string): Promise<{ sha: string }> {
    const tree = await this.request<{ sha: string }>('POST', '/git/trees', {
      base_tree: baseTreeSha,
      tree: entries.map((e) => ({ path: e.path, mode: '100644', type: 'blob', sha: e.sha })),
    });
    const commit = await this.request<{ sha: string }>('POST', '/git/commits', { message, tree: tree.sha, parents: [parent] });
    try {
      await this.request('PATCH', `/git/refs/heads/${this.branch}`, { sha: commit.sha, force: false });
    } catch (e) {
      if (e instanceof StorageError && !(e instanceof AuthError) && !(e instanceof RateLimitError) && !(e instanceof NetworkError)) {
        throw new HeadMovedError(parent, await this.head());
      }
      throw e;
    }
    this.lastWrite = { parent, sha: commit.sha };
    await this.settleRef(commit.sha);
    for (const e of entries) {
      if (e.sha === null) this.treeCache.delete(e.path);
      else this.treeCache.set(e.path, e.sha);
    }
    return { sha: commit.sha };
  }

  /**
   * The commits listing can lag a successful ref update, as the ref itself
   * does (seen in the nightly run; head() covers the ref through lastWrite).
   * This waits until the listing shows the commit, so a caller's next
   * history() sees the commit it was just handed.
   */
  private async settleRef(sha: string): Promise<void> {
    // head() already answers with this commit while the ref lags (lastWrite); the listing has no such cover.
    for (let i = 0; i < REF_SETTLE.tries; i++) {
      if ((await this.history({ limit: 1 }))[0]?.sha === sha) return;
      await sleep(REF_SETTLE.delayMs);
    }
  }

  async commit(batch: CommitBatch): Promise<{ sha: string }> {
    const head = await this.head();
    if (head !== batch.expectedHead) throw new HeadMovedError(batch.expectedHead, head);
    const headCommit = await this.commitObject(head);
    const entries: Array<{ path: string; sha: string | null }> = [];
    for (const w of batch.writes) {
      const bytes = 'text' in w ? enc.encode(w.text) : w.bytes;
      const blob = await this.request<{ sha: string }>('POST', '/git/blobs', { content: toBase64(bytes), encoding: 'base64' });
      entries.push({ path: w.path, sha: blob.sha });
    }
    for (const path of batch.deletes) entries.push({ path, sha: null });
    return this.finish(headCommit.tree.sha, head, entries, batch.message);
  }

  async history(opts: { limit: number; path?: string }): Promise<CommitInfo[]> {
    const q = new URLSearchParams({ sha: this.branch, per_page: String(opts.limit) });
    if (opts.path !== undefined) q.set('path', opts.path);
    const commits = await this.request<Array<{ sha: string; commit: { message: string; committer: { date: string } }; parents: Array<{ sha: string }> }>>('GET', `/commits?${q}`);
    return commits.map((c) => ({ sha: c.sha, message: c.commit.message, date: c.commit.committer.date, parents: c.parents.map((p) => p.sha) }));
  }

  async compare(base: string, head: string): Promise<FileChange[]> {
    const res = await this.request<{ files?: Array<{ filename: string; status: string; patch?: string }> }>('GET', `/compare/${base}...${head}`);
    return (res.files ?? []).map((f) => {
      const status: FileChange['status'] = f.status === 'added' ? 'added' : f.status === 'removed' ? 'removed' : 'modified';
      const change: FileChange = { path: f.filename, status };
      if (f.patch !== undefined) change.patch = f.patch;
      return change;
    });
  }

  /** Spec §6.2: restore the parent's blob for every path the commit touched; refuse if any has since changed. */
  async revert(commitSha: string, message: string): Promise<{ sha: string }> {
    const target = await this.commitObject(commitSha);
    if (target.parents.length !== 1) throw new StorageError(`cannot revert ${commitSha}: it has ${target.parents.length} parents`);
    const parent = await this.commitObject(target.parents[0]!.sha);
    const [parentTree, targetTree] = await Promise.all([this.flatTree(parent.tree.sha), this.flatTree(target.tree.sha)]);
    const touched = [...new Set([...parentTree.keys(), ...targetTree.keys()])].filter((p) => parentTree.get(p) !== targetTree.get(p)).sort();

    const head = await this.head();
    const headCommit = await this.commitObject(head);
    const headTree = await this.flatTree(headCommit.tree.sha);
    const conflicts = touched.filter((p) => headTree.get(p) !== targetTree.get(p));
    if (conflicts.length) throw new RevertConflictError(conflicts);

    const entries = touched.map((p) => ({ path: p, sha: parentTree.get(p) ?? null }));
    return this.finish(headCommit.tree.sha, head, entries, message);
  }

  /** POST /user/repos with auto_init, then point this driver at the new repository (spec §6.2, §12). */
  async createRepo(opts: { name: string; private: true }): Promise<{ fullName: string; head: string }> {
    const repo = await this.request<{ full_name: string; owner: { login: string }; name: string }>('POST', '/user/repos', { name: opts.name, private: opts.private, auto_init: true });
    this.owner = repo.owner.login;
    this.name = repo.name;
    this.treeCache.clear();
    let lastError: unknown;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        return { fullName: repo.full_name, head: await this.head() };
      } catch (e) {
        lastError = e;
        if (!(e instanceof NotFoundError) && !(e instanceof StorageError && !(e instanceof AuthError))) throw e;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    throw lastError;
  }
}
