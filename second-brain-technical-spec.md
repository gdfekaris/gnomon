# Second Brain — Technical Specification

**Companion PWA and template repository: stack, architecture, interfaces, and algorithms**

Version 0.1 — Derived from Product Proposal v0.2 and Brain Format Schema v0.1
September 2026

---

## 1. Purpose and scope

This document specifies how the companion app and the brain template repository are built. It is normative for implementation: module boundaries, interfaces, data formats, and algorithms are defined here; anything not defined is an implementation choice. The Product Proposal defines *what* and *why*; the Schema defines the on-disk brain format; this document defines *how the software works*.

Out of scope: visual design of the UI (a separate design pass), the exact prose of AGENTS.md (a separate document that this spec constrains), and desktop agent tools themselves.

## 2. Stack

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript 5.x, `strict: true` | Everywhere: app, shared library, template script, tests. |
| UI framework | Svelte 5 (runes) | No SvelteKit; single-page app with a lightweight client router. |
| Build | Vite | `base` set to the Pages subpath; single production bundle plus code-split reasoning and crypto chunks. |
| PWA | `vite-plugin-pwa` (Workbox) | Precache app shell only. Network-only for all API origins. |
| Frontmatter | `yaml` | Parse and stringify; the app always writes block-style lists. |
| Markdown | `markdown-it` + custom dual-link plugin | Render only; the app never round-trips markdown through a parser when writing. |
| Symmetric crypto | WebCrypto `SubtleCrypto` | AES-256-GCM, `getRandomValues`, non-extractable keys. |
| Password KDF | `libsodium-wrappers-sumo` | Argon2id only. Loaded lazily; never in the initial bundle. |
| Git host API | Plain `fetch` | Behind the `StorageDriver` interface. No Octokit. |
| On-device storage | `idb-keyval` (IndexedDB) | Credentials, preferences, wrapped keys. Never brain content. |
| Tests | Vitest (unit), Playwright (flows) | See §17. |
| Hosting/CI | GitHub Pages via GitHub Actions | See §18. |

Runtime targets: iOS Safari 17+, Chrome for Android (current), desktop Chrome/Edge/Firefox/Safari (current). WebCrypto, IndexedDB, WASM, and service workers are available in all targets.

## 3. Project structure

A single monorepo with npm workspaces:

```
second-brain/
├── packages/
│   ├── brain-core/        # shared, framework-free library
│   │   └── src/
│   │       ├── schema/    # types, parse/serialize frontmatter, validation
│   │       ├── links/     # dual-link parse, resolve, backlinks
│   │       ├── index/     # deterministic index generation
│   │       ├── sets/      # principle-set operations (create/rename/reorder/delete)
│   │       ├── assembly/  # prompt assembly, budgets, token estimation
│   │       └── crypto/    # encrypted body format (pure functions; no key storage)
│   ├── storage/           # StorageDriver interface, GitHub driver, Encrypting driver, Memory driver
│   ├── providers/         # ProviderDriver interface, Anthropic and OpenRouter drivers
│   ├── app/               # Svelte 5 PWA
│   └── brain-cli/         # tiny Node CLI shipped into the template repo (index regen, validate)
├── template/              # the canonical brain template repo contents (copied at onboarding)
└── .github/workflows/
```

`brain-core` has zero DOM or Node dependencies so it runs identically in the browser, in `brain-cli`, and in tests. `storage` and `providers` depend only on `fetch` and `crypto.subtle`, both available in browsers and Node 20+.

## 4. Architecture

```
┌──────────────────────────────── app (Svelte) ────────────────────────────────┐
│  screens ──▶ stores (runes) ──▶ BrainService ──▶ ReasoningService            │
│                                     │                    │                   │
└─────────────────────────────────────┼────────────────────┼───────────────────┘
                                      ▼                    ▼
                          ┌── storage ─────────┐   ┌── providers ─────┐
                          │ EncryptingDriver   │   │ AnthropicDriver  │
                          │   └▶ GitHubDriver  │   │ OpenRouterDriver │
                          └────────┬───────────┘   └────────┬─────────┘
                                   ▼                        ▼
                             api.github.com        api.anthropic.com / openrouter.ai
```

- **BrainService** (in `app`, thin) owns the in-memory snapshot of the brain — the parsed file map at a known commit SHA — and exposes operations that map 1:1 to Schema §7 procedures. Every operation produces exactly one commit through the storage driver.
- **ReasoningService** performs prompt assembly via `brain-core/assembly` against the snapshot, calls a provider, and parses citations from the response.
- The **driver stack** is composed once at startup from settings: `EncryptingDriver(GitHubDriver)` when encryption is enabled, plain `GitHubDriver` otherwise. Feature code never knows which.

State ownership: the repo is truth; the in-memory snapshot is a cache keyed by the head SHA; IndexedDB holds only credentials and preferences. Any operation that discovers the remote head has moved invalidates the snapshot and surfaces the "repo has newer changes" state (Proposal §4.5).

## 5. Core types (`brain-core/schema`)

```ts
export type CurationState = 'human' | 'agent-proposed' | 'ratified';
export type FileType = 'source' | 'notes' | 'principle' | 'principle-set' | 'inbox' | 'proposals' | 'index';

interface Common { type: FileType; curated: CurationState; created: string; updated: string; tags?: string[]; }

export interface SourceFm extends Common { type: 'source'; title: string; author: string; work?: string; year?: number; locator?: string; origin?: string; inbox_ref?: string; }
export interface NotesFm extends Common { type: 'notes'; source: string; }
export interface SetFm extends Common { type: 'principle-set'; order: number; name?: string; curated: 'human'; }
export interface PrincipleFm extends Common { type: 'principle'; title: string; set: string; grounds: string[]; related?: string[]; curated: 'human'; }
export interface InboxFm extends Common { type: 'inbox'; captured: string; note?: string; status: 'unfiled' | 'filed'; filed_as?: string; filed_commit?: string; curated: 'human'; }
export interface ProposalsFm extends Common { type: 'proposals'; }
export interface IndexFm extends Common { type: 'index'; generated: string; generator: string; }

export type Frontmatter = SourceFm | NotesFm | SetFm | PrincipleFm | InboxFm | ProposalsFm | IndexFm;

export interface BrainFile<F extends Frontmatter = Frontmatter> {
  path: string;          // repo-relative, e.g. "principles/ps-7k2m/courage.md"
  sha: string;           // blob SHA at the snapshot commit
  fm: F;
  body: string;          // markdown body, decrypted if applicable
  encrypted: boolean;    // body was stored as ciphertext
}

export interface BrainSnapshot {
  head: string;                       // commit SHA
  files: Map<string, BrainFile>;
  sets: SetFm[];                      // sorted by order
  byType: <T extends FileType>(t: T) => BrainFile<Extract<Frontmatter, {type: T}>>[];
}
```

`parseFile(path, text): BrainFile` splits frontmatter and body, validates against Schema §9, and throws a typed `ValidationError` listing every failure. `serializeFile(file): string` produces canonical output: frontmatter keys in schema order, block-style lists, `updated` refreshed, LF line endings, exactly one trailing newline. Canonical serialization is what makes index regeneration byte-deterministic.

## 6. Storage layer (`storage`)

### 6.1 Interface

```ts
export interface StorageDriver {
  head(): Promise<string>;                                   // current commit SHA of main
  list(): Promise<TreeEntry[]>;                              // full recursive tree at head
  read(path: string): Promise<{ text: string; sha: string }>;
  commit(batch: CommitBatch): Promise<{ sha: string }>;     // atomic multi-file commit
  history(opts: { limit: number; path?: string }): Promise<CommitInfo[]>;
  compare(base: string, head: string): Promise<FileChange[]>;
  revert(commitSha: string, message: string): Promise<{ sha: string }>;
  createRepo?(opts: { name: string; private: true; templateFiles: FileWrite[] }): Promise<{ fullName: string }>;
}

export interface CommitBatch {
  message: string;
  expectedHead: string;                 // optimistic concurrency; commit fails with HeadMovedError if stale
  writes: { path: string; text: string }[];
  deletes: string[];
}
```

`expectedHead` is mandatory. Every BrainService operation passes the snapshot's head; a `HeadMovedError` triggers snapshot refresh and a user-visible prompt to retry.

### 6.2 GitHub driver

Uses the Git Data API for all commits so multi-file changes are one commit:

1. `GET /repos/{o}/{r}/git/ref/heads/main` → verify `object.sha === expectedHead`, else `HeadMovedError`.
2. `POST /git/blobs` for each write (base64, `encoding: "base64"` so binary-safe).
3. `POST /git/trees` with `base_tree` = head tree; deletes expressed as entries with `sha: null`.
4. `POST /git/commits` with parent = head.
5. `PATCH /git/refs/heads/main` with `force: false` — a second guard against a moved head.

Single-file reads use `GET /contents/{path}?ref={head}` (returns blob SHA and base64 content). Full listing uses `GET /git/trees/{head}?recursive=1`. `history` uses `GET /commits?sha=main&per_page=`. `compare` uses `GET /compare/{base}...{head}` and maps to `{ path, status: 'added'|'modified'|'removed', patch? }`. `revert` fetches the commit's parent tree, builds a new tree that restores the parent's blobs for every touched path (added files → delete, modified → parent blob, removed → parent blob), and commits it; it refuses (`RevertConflictError`) if any touched path's current blob SHA differs from the target commit's blob SHA — that is the Schema §5 "later commits built on it" check, done precisely.

Rate limits: authenticated REST allows 5,000 requests/hour; a full snapshot load is one tree call plus N content calls. To keep N small, snapshot loading reads only frontmatter-bearing files' full content lazily: the tree gives paths and blob SHAs; the app fetches bodies on demand and caches by blob SHA in memory (blob SHA is content-addressed, so the cache never goes stale). Principle sets and principles are prefetched eagerly since every reasoning task needs them.

Token: fine-grained PAT with Contents read/write on the one repo. Onboarding requires a classic or fine-grained token with repository-creation permission for `createRepo` only, then guides the swap (Proposal §7).

### 6.3 Memory driver

An in-memory `StorageDriver` implementing the same semantics including `expectedHead` checks. Used by unit tests and by an in-app "demo brain" mode for onboarding screenshots. Not user-visible otherwise.

### 6.4 Encrypting driver (designed now, shipped Phase 4)

A wrapper `EncryptingDriver(inner: StorageDriver, keyring: Keyring)` implementing `StorageDriver`. It is transparent to callers: `read` returns plaintext, `commit` writes ciphertext. It encrypts **bodies only**; frontmatter stays cleartext so indexes, set ordering, validation, and ratification work unchanged, and so a desktop tool with the key can decrypt selectively. This tradeoff is disclosed to the user verbatim in Settings: *titles, tags, authors, and structure remain readable to your git host; passage text, notes, principle text, and inbox text do not.*

**Encrypted body format.** A body is encrypted when it begins with the marker line:

```
<!-- sb-enc v1 -->
<base64 payload>
```

Payload = `nonce(12 bytes) || ciphertext || tag(16 bytes)` as produced by AES-256-GCM. Associated data (AAD) = UTF-8 of the file's repo path, binding ciphertext to its location so a blob cannot be swapped between files undetected. Files without the marker are treated as plaintext, which is what makes gradual enablement and mixed brains possible.

**Files never encrypted:** `AGENTS.md`, `README.md`, `templates/*`, both `_index.md` files (they contain titles and links, already cleartext in frontmatter). `_proposals.md` and `_set.md` bodies **are** encrypted.

**Key derivation.** Argon2id via libsodium: `crypto_pwhash(32, passphrase, salt, OPSLIMIT_MODERATE, MEMLIMIT_MODERATE, ALG_ARGON2ID13)`. Parameters are stored, not assumed, so they can be raised later. The 16-byte random salt and the parameters live in the repo at `.brain/encryption.json`:

```json
{ "version": 1, "kdf": "argon2id13", "salt": "<base64>", "opslimit": 3, "memlimit": 268435456,
  "check": "<base64 AES-GCM encryption of the 16-byte constant 'second-brain-ok' under the derived key>" }
```

`check` lets the app verify a passphrase before touching any file. The derived 32 bytes are imported with `crypto.subtle.importKey('raw', ..., {name:'AES-GCM'}, false, ['encrypt','decrypt'])` — **non-extractable** — and the raw bytes are zeroed. Unlock happens once per session; the `CryptoKey` lives in memory only. "Remember on this device" is offered: the raw key is wrapped with a device key held in IndexedDB as a non-extractable `CryptoKey`, and the wrapped blob is stored beside it. This does not protect against an attacker with the device unlocked; the disclosure says so.

**Enabling encryption on an existing brain** is a single commit that rewrites every eligible body as ciphertext and adds `.brain/encryption.json`. **Disabling** is the reverse. Both require the head to be unchanged during the operation (standard `expectedHead`). **Passphrase change** re-derives, re-encrypts every body, and rewrites the salt and `check` in one commit.

**Desktop interop.** `brain-cli` gains `encrypt`/`decrypt` commands using the same format, so a desktop user can decrypt a clone into a working directory for a local-model session and re-encrypt before pushing. AGENTS.md for encrypted brains instructs agents to run these at session boundaries. git-crypt is documented as an alternative for users who prefer filter-based transparency, but is not required by the format.

**What is deliberately not done:** no custom padding or length hiding (file sizes leak; disclosed), no encryption of filenames (slugs leak; disclosed), no key escrow or recovery — a lost passphrase loses the bodies, and the enable flow requires the user to type that sentence back.

## 7. Brain model operations (`brain-core`)

### 7.1 Links (`links`)

- `parseLinks(body): LinkRef[]` finds dual links `[[target]] ([label](relative.md))`, lone wikilinks, and lone relative links to `.md` files. Each ref carries the resolved repo path and its source span.
- `renderDualLink(fromPath, toPath, label)` produces the canonical dual-link string (Schema §6). The markdown-it plugin in `app` collapses a dual link to one anchor at render time.
- `backlinks(snapshot): Map<path, path[]>` computed once per snapshot from body links plus `grounds` and `related` frontmatter.

### 7.2 Index generation (`index`)

`generateIndexes(snapshot): { 'maps/_index.md': string; 'principles/_index.md': string }`. Pure, deterministic: sets by `order`; principles by `title` (locale-independent codepoint sort); sources by `author`, then `work`, then `title`; tags by name. Output uses `serializeFile` so byte equality across devices holds. Every BrainService write that changes any frontmatter-bearing file includes the regenerated indexes in the same commit **only if they differ** from the current blobs, so commits stay minimal.

### 7.3 Principle sets (`sets`)

Implements Schema §7.1–§7.4 as pure functions from `(snapshot, params)` to a `CommitBatch`. `deleteSet` returns the batch plus a `dangling: { path, ref }[]` report for the UI. `newSetSlug(existing: Set<string>)` uses `crypto.getRandomValues` over the 31-character alphabet.

### 7.4 Validation

`validateSnapshot(snapshot): Issue[]` runs Schema §9 across the whole brain (order contiguity, `set`/`source` path agreement, dangling grounds as warnings). `validateWrite(prev: BrainFile | undefined, next: BrainFile)` enforces the per-write rules, notably raw-body immutability for `human`/`ratified` sources. BrainService refuses to build a batch that fails `validateWrite`.

## 8. Reasoning (`brain-core/assembly`, `providers`, ReasoningService)

### 8.1 Provider interface

```ts
export interface ProviderDriver {
  id: 'anthropic' | 'openrouter';
  listModels(): Promise<ModelInfo[]>;       // { id, label, contextWindow, supportsStreaming }
  complete(req: CompletionRequest): AsyncIterable<CompletionEvent>;  // streaming; { type:'text', text } | { type:'done', usage }
}
export interface CompletionRequest { model: string; system: string; messages: ChatMessage[]; maxTokens: number; signal: AbortSignal; }
```

**Anthropic driver:** `POST https://api.anthropic.com/v1/messages` with headers `x-api-key`, `anthropic-version`, and `anthropic-dangerous-direct-browser-access: true` (required for browser CORS). SSE streaming. `listModels` calls `GET /v1/models` and maps context windows from a small bundled table keyed by model family, with a conservative default when unknown.

**OpenRouter driver:** `POST https://openrouter.ai/api/v1/chat/completions`, `Authorization: Bearer`, plus `HTTP-Referer` and `X-Title` headers as OpenRouter requests. `listModels` calls `GET /api/v1/models`, which returns `context_length` per model — the authoritative source for budgets.

### 8.2 Token estimation

Budgets are computed before any request, without a network call: `estimateTokens(text) = ceil(utf8Bytes / 3.6)` — deliberately conservative for English prose with markdown. The Anthropic driver may optionally refine with `POST /v1/messages/count_tokens` when the estimate is within 10% of budget. Displayed to the user as a budget bar, never as an exact number.

### 8.3 Assembly algorithm

`assemble(snapshot, task, selectedSets, input, budgetTokens): AssemblyResult` implements Schema §8 exactly:

1. For each selected set in `order`: emit `## Set {order}{ — name}`, the `_set.md` body, then each principle as `### {title}` + body + a machine-readable line `<!-- ref: principles/{set}/{slug} -->`. If the running total exceeds budget here, return `{ error: 'SETS_EXCEED_BUDGET', neededTokens }` and stop.
2. Collect grounding slugs in order of first reference across the emitted principles; for each, emit `### Passage: {title} — {author}` + `raw.md` body + ref comment, until adding the next would exceed budget.
3. For remaining slugs: emit under `## Passages referenced but not included` the `notes.md` body (if any) or the source's title/author line, plus a ref comment.
4. Task B appends `## New text` + input. If it does not fit, return `{ error: 'INPUT_EXCEEDS_BUDGET' }`.

The **system prompt** is a fixed template per task (A, B, D, free-form) shipped in `assembly/prompts/*.md`, and includes: the curation rules the model must respect (proposal-only for principles), the citation instruction (cite as `[[ref]]` using the ref comments), and — when more than one set is selected — the requirement to reason per set before comparing and to attribute every claim. The `_set.md` body is currently placed in the user turn as context, not in the system prompt (Proposal §9.3 open question; a settings flag will allow flipping this for evaluation).

`AssemblyResult` also returns `included: ref[]`, `excluded: ref[]`, and `tokensUsed`, which the UI shows before sending.

### 8.4 Citations

Responses are scanned for `[[path]]` refs that resolve into the snapshot; each becomes a tappable link. Unresolvable refs are rendered as plain text with a subtle marker so hallucinated citations are visible rather than hidden.

### 8.5 Agent filing through the app (Task C)

Filing via the PWA is a structured-output completion, not free chat. The system prompt asks for a strict JSON array of filings; the app validates each against the `SourceFm` schema, generates the slug (with collision handling), builds `raw.md` (body = inbox body **verbatim, copied by the app, never by the model**), `notes.md` stub, `_proposals.md` appends, and the inbox item update, and commits one batch per inbox item. The model proposes metadata and proposals; it never produces the passage text. This structurally satisfies Schema §4.2 immutability even if the model is careless.

## 9. Ratification and rejection

- **Ratify(filingSha):** `compare(parent(filingSha), filingSha)` → for every added file with `curated: agent-proposed`, rewrite to `ratified`; set the inbox item `status: filed` if not already; regenerate indexes; one commit `Ratify: {slug}`.
- **Reject(filingSha):** `revert(filingSha, "Reject: {slug}")`; the inbox item returns to `status: unfiled` because the revert restores its pre-filing frontmatter. On `RevertConflictError`, the UI lists the conflicting paths and offers per-file manual actions.
- **Review view:** built from `compare` output — added files rendered in full from their blob; modified files show `patch` lines beginning with `+` only.

Filing commits are recognized by message prefix `File: ` and by containing at least one added `raw.md`; the Inbox screen lists them from `history({limit: 50})`.

## 10. Application layer (`app`)

### 10.1 Structure

```
app/src/
├── lib/
│   ├── stores/        # runes-based state: session, snapshot, settings, reasoning
│   ├── services/      # BrainService, ReasoningService, OnboardingService, KeyringService
│   ├── router.ts      # hash-based router; routes: /capture /browse/* /inbox /sets /reason /settings /onboarding
│   └── components/    # reusable: MarkdownView, LinkChip, SetPicker, BudgetBar, CommitReview
├── routes/            # one Svelte component per screen (Proposal §6)
├── sw/                # service worker config (vite-plugin-pwa)
└── main.ts
```

Hash routing is used deliberately: GitHub Pages cannot rewrite paths to `index.html`, and hash routes survive refresh and home-screen launch without a 404 fallback hack.

### 10.2 State

- `session`: `{ driver: StorageDriver | null, unlocked: boolean }` — rebuilt from IndexedDB at launch.
- `snapshot`: `BrainSnapshot | null` plus `stale: boolean`; every driver `commit` success replaces it with the new head; every `HeadMovedError` sets `stale`.
- `settings`: git connection, providers, budget percent, `setDescriptionPlacement: 'context' | 'system'`, theme; persisted via `idb-keyval`.
- `reasoning`: current selected sets (persisted), task, transcript, streaming state.

Stores are Svelte 5 `$state` objects exported from modules; services mutate them. No global event bus.

### 10.3 On-device storage schema (IndexedDB via `idb-keyval`)

| Key | Value | Notes |
|---|---|---|
| `git.token` | string | Fine-grained PAT. |
| `git.repo` | `{ owner, name }` | |
| `provider.anthropic.key`, `provider.openrouter.key` | string | |
| `prefs` | object | Theme, budget percent, last selected sets, capture defaults. |
| `enc.deviceKey` | non-extractable `CryptoKey` | Only if "remember on this device". |
| `enc.wrappedKey` | ArrayBuffer | Brain key wrapped under `enc.deviceKey`. |

No brain content is ever written to IndexedDB, localStorage, or the Cache API. iOS may evict this store after seven days of non-use; the app treats a missing token as "signed out" and re-onboards to the token step only.

### 10.4 Capture path (US-1 budget)

Launch → Capture screen is the default route, rendered before the snapshot loads. Save builds the inbox file locally and issues a `commit` with `expectedHead` = last known head; on `HeadMovedError` it refetches head and retries once automatically (an inbox add cannot conflict with anything). Snapshot refresh happens after the commit resolves, off the critical path.

## 11. PWA and service worker

- Manifest: `display: standalone`, `start_url: {base}/#/capture`, maskable icons at 192/512, `theme_color` matching the app.
- Workbox `generateSW` with `globPatterns` for the app shell; `navigateFallback` to `index.html`; **no runtime caching routes** — requests to `api.github.com`, `api.anthropic.com`, `openrouter.ai` bypass the worker entirely.
- Update strategy: `registerType: 'prompt'`; the app shows a "new version — reload" toast rather than auto-reloading mid-edit.
- iOS: no install prompt API; onboarding shows the Share → Add to Home Screen steps with the actual icons. `apple-mobile-web-app-*` meta tags set.

## 12. Onboarding service

1. Token walkthrough (annotated screenshots bundled as assets; steps differ for classic vs fine-grained).
2. Validate token: `GET /user` and permission probe.
3. Create-from-template: `createRepo` → push the `template/` tree as the initial commit, with `principles/ps-xxxx/_set.md` generated at `order: 1` — the set slug is generated per user, not fixed in the template.
4. Or connect-existing: `list()` → validate layout → offer repairs, including the flat-principles migration (Schema §7.8), each repair one commit.
5. Privacy screen; optional encryption enablement (Phase 4) placed here so the choice is made before content exists.
6. Swap to a single-repo token (guided, optional).

## 13. Template repository and `brain-cli`

`template/` contains the scaffold (Schema §2), `AGENTS.md`, `README.md`, `templates/*`, and `package.json` + `bin/brain` that installs `brain-cli`. Commands:

- `brain index` — regenerate both index files (same code as the app).
- `brain validate` — Schema §9 over the working tree; nonzero exit on refusals.
- `brain encrypt` / `brain decrypt` — Phase 4; same format as §6.4; passphrase via prompt or `SB_PASSPHRASE`.

AGENTS.md instructs agents to run `npx brain validate && npx brain index` before the end-of-session commit. Requires Node 20+; the README says so and offers the app-side regeneration as the fallback for users without Node.

## 14. Error handling and offline

All driver errors are typed: `AuthError`, `HeadMovedError`, `RevertConflictError`, `RateLimitError`, `NetworkError`, `ValidationError`, `LockedError` (encrypted brain, no key). Screens map these to specific recoveries rather than generic toasts: `AuthError` → token step; `HeadMovedError` → refresh banner with retry; `LockedError` → unlock sheet. Offline: the app shell loads; Capture accepts text and queues **one** pending inbox item in memory (not persisted — see §10.3) with a clear "will save when online" state; everything else shows the read-only cached snapshot if present.

## 15. Security considerations

- Content Security Policy via meta tag: `default-src 'self'; connect-src 'self' https://api.github.com https://api.anthropic.com https://openrouter.ai; script-src 'self' 'wasm-unsafe-eval'; img-src 'self' data:; style-src 'self' 'unsafe-inline'`. No third-party scripts, no analytics.
- Markdown rendering: `markdown-it` with `html: false`; links to non-brain origins open in a new tab with `rel="noopener noreferrer"`.
- Keys never appear in URLs, logs, or error reports. There are no error reports; errors stay on device.
- Dependencies pinned with lockfile; `npm audit` in CI; libsodium and yaml pinned to exact versions.
- Subresource integrity is not applicable (same-origin bundle), but the Pages deploy is from a protected branch only.

## 16. Performance targets

Cold start to interactive Capture screen < 1.5 s on a mid-range phone over LTE; capture commit round-trip < 3 s; snapshot load for a 500-file brain < 4 s (one tree call + eager fetch of sets/principles, lazy everything else); assembly for a 40-principle set < 50 ms; Argon2id unlock 1–3 s on phone hardware (by design).

## 17. Testing

- **Unit (Vitest):** `brain-core` at high coverage — parse/serialize round-trips, canonical serialization determinism, index generation golden files, set operations (especially delete-and-renumber and dangling-reference reports), assembly against synthetic brains at various budgets, encrypted body encrypt/decrypt including AAD path-binding failure, validation rules one by one.
- **Driver contract tests:** a single suite run against `MemoryDriver` and, in CI with a disposable token, against a scratch GitHub repo: `expectedHead` rejection, multi-file atomic commit, `revert` conflict detection.
- **Flows (Playwright, against `MemoryDriver` in a test build):** capture; connect-existing with flat-principles repair; create Set 2, rename, delete Set 1, verify labels and links; file via mocked provider, review, ratify, reject; reason from two sets with a mocked provider and verify citations resolve.
- **Fixtures:** a small reference brain checked into `packages/brain-core/fixtures/` used across all suites.

## 18. Build and deploy

GitHub Actions on push to `main`: install, typecheck, unit tests, build `app` with `VITE_BASE=/second-brain/`, deploy to Pages via `actions/deploy-pages`. Contract tests against real GitHub run on a nightly schedule, not on every push. Releases tag the repo; the app shows its version (from `package.json`) in Settings and writes it into `generator` on index files.

## 19. Phase mapping

| Phase | This spec's deliverables |
|---|---|
| 1 | `brain-core` schema/links/index/sets/validation; `storage` interface, GitHub + Memory drivers, **Encrypting driver interface, body format, and unit tests with a stub keyring**; `brain-cli` index/validate; app shell, router, Capture, Browse, Settings, PWA; onboarding connect-existing + repair. |
| 2 | Sets screen; `providers` both drivers; assembly + Reason screen (Tasks A, B, D); filing (Task C), review, ratify/reject; editors with curation enforcement. |
| 3 | Onboarding create-from-template, token walkthrough, privacy screen; polish. |
| 4 | Encrypting driver wired to real keyring, unlock UI, enable/disable/passphrase-change flows; `brain encrypt/decrypt`; second storage driver. |

## 20. Open technical decisions

1. **Snapshot persistence across launches.** Currently none (brain content never touches device storage). A Cache-API-free option is to persist only the tree listing (paths + blob SHAs, no content) to speed cold start; decide after measuring §16 targets.
2. **Anthropic context-window table maintenance.** Bundled table vs. a `/models` field if one becomes available; revisit at each release.
3. **Argon2id parameters.** `MODERATE` (256 MB) may be too slow on older phones; measure on the oldest supported iPhone and decide whether to default to `INTERACTIVE` with a user-raisable setting.
4. **Multiple pending offline captures.** Deliberately capped at one; revisit if real usage shows loss.
5. **Set description placement** (context vs. system) — evaluate with real prompts in Phase 2 before removing the flag.
