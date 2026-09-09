// Onboarding (spec §12 steps 2–4, US-14, US-15): check a token and explain
// what is wrong with it in a sentence, and create a brain from the bundled
// template in one commit. Connect-existing lives in connect.ts. Framework-
// free so it runs under vitest over the fake GitHub.

import { AuthError, GitHubDriver, NetworkError, NotFoundError, RateLimitError, type StorageDriver } from '@gnomon/storage';

export type TokenKind = 'classic' | 'fine-grained';

export type TokenCheck =
  | { ok: true; login: string; kind: TokenKind; warning?: string }
  | { ok: false; reason: string };

export interface ValidateTokenOptions {
  token: string;
  /** with `name`, also probe this repository (connect-existing) */
  owner?: string;
  name?: string;
  fetch?: typeof fetch;
  apiBase?: string;
}

const REJECTED = 'GitHub rejected the token. Check that it was copied whole and has not expired.';
const RATE_LIMITED = 'GitHub rate limit reached. Try again in a while.';
const OFFLINE = 'Could not reach GitHub. Check the connection.';

/**
 * `GET /user`, then, when a repository is named, `GET /repos/<owner>/<name>`
 * for its `permissions.push`. A classic token's scopes are visible in a
 * header; a fine-grained token's permissions are not exposed by any endpoint,
 * so a repository it cannot create is discovered by `createFromTemplate`.
 */
export async function validateToken(opts: ValidateTokenOptions): Promise<TokenCheck> {
  const token = opts.token.trim();
  if (!token) return { ok: false, reason: 'Paste the token first.' };
  const driverOpts: ConstructorParameters<typeof GitHubDriver>[0] = { owner: opts.owner ?? '', name: opts.name ?? '', token };
  if (opts.fetch) driverOpts.fetch = opts.fetch;
  if (opts.apiBase) driverOpts.apiBase = opts.apiBase;
  const driver = new GitHubDriver(driverOpts);

  let login: string;
  let scopes: string[] | null;
  try {
    ({ login, scopes } = await driver.whoami());
  } catch (e) {
    return { ok: false, reason: describeProbeError(e) };
  }
  const kind: TokenKind = scopes === null ? 'fine-grained' : 'classic';
  const result: TokenCheck = { ok: true, login, kind };
  if (kind === 'classic' && !scopes!.includes('repo')) {
    result.warning = 'This classic token has no "repo" scope, so it cannot create or write to a private repository. Generate one with the repo scope ticked, or use a fine-grained token.';
  }

  if (opts.owner && opts.name) {
    const repo = `${opts.owner}/${opts.name}`;
    try {
      const { permissions } = await driver.repository();
      if (!permissions.push) return { ok: false, reason: `This token can read ${repo} but not write to it. It needs Contents read and write on that repository.` };
    } catch (e) {
      if (e instanceof NotFoundError) return { ok: false, reason: `The token cannot see ${repo}. Check the owner and repository name, and that the token was granted access to it.` };
      if (e instanceof AuthError) return { ok: false, reason: `GitHub refused access to ${repo} with this token.` };
      return { ok: false, reason: describeProbeError(e) };
    }
  }
  return result;
}

export type CreateResult =
  | { ok: true; fullName: string; head: string }
  | { ok: false; reason: string };

/** The one commit that turns an `auto_init` repository into the template (spec §12 step 3). */
export const SCAFFOLD_MESSAGE = 'Scaffold: template';

/**
 * `createRepo` (private, `auto_init`), then exactly one commit on top that
 * writes the bundled template. The template's own README.md replaces the
 * auto-generated one in that tree. Nothing is generated per user: Set 1 and
 * both generated-empty indexes arrive as template files.
 */
export async function createFromTemplate(driver: StorageDriver, name: string, scaffold: ReadonlyMap<string, string>): Promise<CreateResult> {
  if (!driver.createRepo) return { ok: false, reason: 'This connection cannot create repositories.' };
  const repoName = name.trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(repoName)) return { ok: false, reason: 'A repository name uses letters, digits, hyphens, underscores, and dots only.' };

  let created: { fullName: string; head: string };
  try {
    created = await driver.createRepo({ name: repoName, private: true });
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, reason: `GitHub would not let this token create a repository. A fine-grained token needs Administration read and write for all repositories; a classic token needs the repo scope. Or create an empty private repository named ${repoName} on GitHub and connect it instead.` };
    if (e instanceof RateLimitError) return { ok: false, reason: RATE_LIMITED };
    if (e instanceof NetworkError) return { ok: false, reason: OFFLINE };
    return { ok: false, reason: `GitHub could not create ${repoName}. A repository with that name may already exist: pick another name, or connect the existing one.` };
  }

  try {
    const { sha } = await driver.commit({
      message: SCAFFOLD_MESSAGE,
      expectedHead: created.head,
      writes: [...scaffold].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([path, text]) => ({ path, text })),
      deletes: [],
    });
    return { ok: true, fullName: created.fullName, head: sha };
  } catch (e) {
    return { ok: false, reason: `${created.fullName} was created but the template could not be written: ${describeProbeError(e)} Connect it as an existing brain to add the missing files.` };
  }
}

function describeProbeError(e: unknown): string {
  if (e instanceof AuthError) return REJECTED;
  if (e instanceof RateLimitError) return RATE_LIMITED;
  if (e instanceof NetworkError) return OFFLINE;
  return (e as Error).message;
}
