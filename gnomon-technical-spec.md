# Gnomon — Technical Specification

**Companion PWA, shared library, desktop CLI, and template repository: stack, architecture, interfaces, and algorithms**

Version 0.2 — Derived from Product Proposal v0.3 and Brain Format Schema v0.2
September 2026

*Changes from 0.1, keyed to `alignment-review.md`: renamed to Gnomon in every path and identifier (§4); snapshot loading is eager through the GitHub GraphQL API (3.7); the CLI is `packages/cli`, published as `gnomon-cli` with binary `gnomon`, and the template carries no `package.json` (2.6, 3.8); principles carry `order` and the sets module gains principle operations (2.1); proposals are one file each with their own module (3.2); attachments flow through capture, storage, filing, and review (2.3c); ratify and reject follow Schema §5 with filing-time inbox marking (3.1); index frontmatter is `type: index` only (3.3); the flat-principles repair is removed (3.6); repository creation uses `auto_init` (3.10.7).*

---

## 1. Purpose and scope

This document specifies how the companion app, the shared library, the desktop CLI, and the brain template are built. It is normative for implementation: module boundaries, interfaces, data formats, and algorithms are defined here; anything not defined is an implementation choice. The Product Proposal defines *what* and *why*; the Schema defines the on-disk brain format; this document defines *how the software works*.

Out of scope: visual design of the UI (a separate design pass), the exact prose of AGENTS.md (a separate document that this spec constrains), and desktop agent tools themselves.

## 2. Stack

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript 5.x, `strict: true` | Everywhere: app, shared library, CLI, tests. |
| UI framework | Svelte 5 (runes) | No SvelteKit; single-page app with a lightweight client router. |
| Build | Vite | `base` set to the Pages subpath; single production bundle plus code-split reasoning and crypto chunks. |
| PWA | `vite-plugin-pwa` (Workbox) | Precache app shell only. Network-only for all API origins. |
| Frontmatter | `yaml` | Parse and stringify; the app always writes block-style lists. |
| Markdown | `markdown-it` + custom dual-link plugin | Render only; the app never round-trips markdown through a parser when writing. |
| Symmetric crypto | WebCrypto `SubtleCrypto` | AES-256-GCM, `getRandomValues`, non-extractable keys. |
| Password KDF | `libsodium-wrappers-sumo` | Argon2id only. Loaded lazily; never in the initial bundle. |
| Git host API | Plain `fetch` | REST Git Data API for writes, GraphQL for batched reads. Behind the `StorageDriver` interface. No Octokit. |
| On-device storage | `idb-keyval` (IndexedDB) | Credentials, preferences, wrapped keys. Never brain content. |
| Tests | Vitest (unit), Playwright (flows) | See §17. |
| Hosting/CI | GitHub Pages via GitHub Actions; npm for the CLI | See §18. |

Runtime targets: iOS Safari 17+, Chrome for Android (current), desktop Chrome/Edge/Firefox/Safari (current); Node 20+ for the CLI. WebCrypto, IndexedDB, WASM, and service workers are available in all browser targets.

## 3. Project structure

A single monorepo with npm workspaces:

```
gnomon/
├── packages/
│   ├── core/              # shared, framework-free library
│   │   └── src/
│   │       ├── schema/    # types, parse/serialize frontmatter, validation
│   │       ├── links/     # dual-link parse, resolve, backlinks
│   │       ├── index/     # deterministic index generation
│   │       ├── sets/      # set and principle operations (create/rename/reorder/delete)
│   │       ├── proposals/ # proposal ids, files, decisions
│   │       ├── filing/    # build a filing batch from a capture + metadata
│   │       ├── assembly/  # prompt assembly, budgets, token estimation
│   │       └── crypto/    # encrypted body format (pure functions; no key storage)
│   ├── storage/           # StorageDriver interface, GitHub driver, Encrypting driver, Memory driver
│   ├── providers/         # ProviderDriver interface, Anthropic and OpenRouter drivers
│   ├── app/               # Svelte 5 PWA
│   └── cli/               # published to npm as `gnomon-cli`, binary `gnomon`
├── template/              # the canonical brain template (Schema §2), copied at onboarding
├── docs/                  # proposal, schema, this spec, alignment review
└── .github/workflows/
```

`core` has zero DOM or Node dependencies so it runs identically in the browser, in the CLI, and in tests. `storage` and `providers` depend only on `fetch` and `crypto.subtle`, both available in browsers and Node 20+. `template/` is plain markdown: no `package.json`, no lockfile.

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
- **ReasoningService** performs prompt assembly via `core/assembly` against the snapshot, calls a provider, and parses citations from the response.
- The **driver stack** is composed once at startup from settings: `EncryptingDriver(GitHubDriver)` when encryption is enabled, plain `GitHubDriver` otherwise. Feature code never knows which.
- The **CLI** composes `core` with a local working-tree driver (§13). App and CLI share every algorithm; neither has private logic about the format.

State ownership: the repo is truth; the in-memory snapshot is a cache keyed by the head SHA; IndexedDB holds only credentials and preferences. Any operation that discovers the remote head has moved invalidates the snapshot and surfaces the "repo has newer changes" state (Proposal §4.5).

## 5. Core types (`core/schema`)

```ts
export type CurationState = 'human' | 'agent-proposed' | 'ratified';
export type FileType = 'source' | 'notes' | 'principle' | 'principle-set' | 'inbox' | 'proposal' | 'index';

interface Common { type: FileType; curated: CurationState; created: string; updated: string; tags?: string[]; }

export interface SourceFm extends Common { type: 'source'; title: string; author: string; work?: string; year?: number; locator?: string; origin?: string; inbox_ref?: string; attachment?: string; }
export interface NotesFm extends Common { type: 'notes'; source: string; }
export interface SetFm extends Common { type: 'principle-set'; order: number; name?: string; curated: 'human'; }
export interface PrincipleFm extends Common { type: 'principle'; title: string; set: string; order: number; grounds: string[]; related?: string[]; curated: 'human'; }
export interface InboxFm extends Common { type: 'inbox'; note?: string; attachment?: string; status: 'unfiled' | 'filed'; filed_as?: string; curated: 'human'; }
export interface ProposalFm extends Common {
  type: 'proposal'; kind: 'principle' | 'link' | 'tag' | 'amendment'; title: string;
  target_set?: string; target?: string; from_source?: string; grounds?: string[];
  status: 'open' | 'accepted' | 'declined'; curated: 'human' | 'agent-proposed';
}
export interface IndexFm { type: 'index'; }   // nothing else, by Schema §4.8

export type Frontmatter = SourceFm | NotesFm | SetFm | PrincipleFm | InboxFm | ProposalFm | IndexFm;

export interface BrainFile<F extends Frontmatter = Frontmatter> {
  path: string;          // repo-relative, e.g. "principles/ps-7k2m/courage.md"
  sha: string;           // blob SHA at the snapshot commit
  fm: F;
  body: string;          // markdown body, decrypted if applicable
  encrypted: boolean;    // body was stored as ciphertext
}

export interface Attachment { path: string; sha: string; size: number; }   // bytes fetched on demand

export interface BrainSnapshot {
  head: string;                       // commit SHA
  files: Map<string, BrainFile>;      // every .md file with frontmatter
  attachments: Map<string, Attachment>;
  sets: BrainFile<SetFm>[];           // sorted by order
  principlesOf: (setSlug: string) => BrainFile<PrincipleFm>[];   // sorted by order
  byType: <T extends FileType>(t: T) => BrainFile<Extract<Frontmatter, {type: T}>>[];
}
```

`parseFile(path, text): BrainFile` splits frontmatter and body, validates against Schema §9, and throws a typed `ValidationError` listing every refusal. `serializeFile(file): string` produces canonical output: frontmatter keys in schema order, block-style lists, `updated` refreshed on content change, LF line endings, exactly one trailing newline. Canonical serialization is what makes index regeneration byte-deterministic.

## 6. Storage layer (`storage`)

### 6.1 Interface

```ts
export interface StorageDriver {
  head(): Promise<string>;                                        // current commit SHA of main
  list(): Promise<TreeEntry[]>;                                   // full recursive tree at head: { path, sha, size }
  readMany(paths: string[]): Promise<Map<string, { text: string; sha: string }>>;  // batched text reads
  readBytes(path: string): Promise<{ bytes: Uint8Array; sha: string }>;            // one attachment
  commit(batch: CommitBatch): Promise<{ sha: string }>;           // atomic multi-file commit
  history(opts: { limit: number; path?: string }): Promise<CommitInfo[]>;
  compare(base: string, head: string): Promise<FileChange[]>;
  revert(commitSha: string, message: string): Promise<{ sha: string }>;
  createRepo?(opts: { name: string; private: true }): Promise<{ fullName: string; head: string }>;
}

export type FileWrite = { path: string; text: string } | { path: string; bytes: Uint8Array };

export interface CommitBatch {
  message: string;
  expectedHead: string;                 // optimistic concurrency; commit fails with HeadMovedError if stale
  writes: FileWrite[];
  deletes: string[];
}
```

`expectedHead` is mandatory. Every BrainService operation passes the snapshot's head; a `HeadMovedError` triggers snapshot refresh and a user-visible prompt to retry. `readMany` exists because snapshot loading needs every markdown file's frontmatter (Schema §9 validates on read; §4.8 regenerates indexes from all frontmatter), so per-file reads are the wrong shape.

### 6.2 GitHub driver

**Reads.** `list` is `GET /git/trees/{head}?recursive=1`. `readMany` is the GraphQL endpoint (`POST https://api.github.com/graphql`, same PAT), one query per batch of up to 100 paths using aliases:

```graphql
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    f0: object(expression: "<head>:principles/ps-g8xw/_set.md") { ... on Blob { oid text isBinary } }
    f1: object(expression: "<head>:sources/didion-why-i-write/raw.md") { ... on Blob { oid text isBinary } }
    # ...
  }
}
```

A 500-file brain loads in at most six requests. Blobs GraphQL reports as binary (never the case for well-formed `.md` files) fall back to `readBytes`. `readBytes` is `GET /git/blobs/{sha}` (base64, up to 100 MB) and is used only for attachments, on demand.

**Writes** use the Git Data API so multi-file changes are one commit:

1. `GET /git/ref/heads/main` → verify `object.sha === expectedHead`, else `HeadMovedError`.
2. `POST /git/blobs` for each write (`encoding: "base64"`, so text and attachments take the same path).
3. `POST /git/trees` with `base_tree` = head tree; deletes expressed as entries with `sha: null`.
4. `POST /git/commits` with parent = head.
5. `PATCH /git/refs/heads/main` with `force: false` — a second guard against a moved head.

`history` uses `GET /commits?sha=main&per_page=`. `compare` uses `GET /compare/{base}...{head}` and maps to `{ path, status: 'added'|'modified'|'removed', patch? }`. `revert` fetches the commit's parent tree, builds a new tree that restores the parent's blobs for every touched path (added files → delete, modified → parent blob, removed → parent blob), and commits it; it refuses (`RevertConflictError`) if any touched path's current blob SHA differs from the target commit's blob SHA — the Schema §5 "later commits built on it" check, done precisely. Because a filing touches only its own new files and its capture (Schema §7.6), later filings never conflict with it.

`createRepo` is `POST /user/repos` with `auto_init: true`, which yields an initial commit and a `main` ref; the template is then committed on top through the normal write path, and the auto-generated README is deleted in that same commit.

**Limits.** REST allows 5,000 requests/hour and GraphQL 5,000 points/hour per token; a full snapshot load costs one REST call plus a few GraphQL points. Attachments are capped at **20 MB** by the app before upload (`AttachmentTooLargeError`), well under GitHub's 100 MB blob limit and chosen so a phone on LTE finishes a capture in seconds; the number lives in one constant and is revisited with real usage.

Token: fine-grained PAT with Contents read/write on the one repo. Onboarding requires a token with repository-creation permission for `createRepo` only, then guides the swap (Proposal §7).

### 6.3 Memory driver

An in-memory `StorageDriver` implementing the same semantics including `expectedHead` checks and revert conflict detection. Used by unit tests and by an in-app "demo brain" mode for onboarding screenshots. Not user-visible otherwise.

### 6.4 Encrypting driver (designed now, shipped Phase 4)

A wrapper `EncryptingDriver(inner: StorageDriver, keyring: Keyring)` implementing `StorageDriver`. It is transparent to callers: reads return plaintext, `commit` writes ciphertext. It encrypts **markdown bodies only**; frontmatter stays cleartext so indexes, set ordering, validation, and ratification work unchanged, and so a desktop tool with the key can decrypt selectively. This tradeoff is disclosed to the user verbatim in Settings: *titles, tags, authors, structure, and attached files remain readable to your git host; passage text, notes, principle text, proposal text, and inbox text do not.*

**Encrypted body format.** A body is encrypted when it begins with the marker line:

```
<!-- gnomon-enc v1 -->
<base64 payload>
```

Payload = `nonce(12 bytes) || ciphertext || tag(16 bytes)` as produced by AES-256-GCM. Associated data (AAD) = UTF-8 of the file's repo path, binding ciphertext to its location so a blob cannot be swapped between files undetected. Files without the marker are treated as plaintext, which is what makes gradual enablement and mixed brains possible.

**Files never encrypted:** `AGENTS.md`, `README.md`, `templates/*`, both `_index.md` files (they contain titles and links, already cleartext in frontmatter), and attachments. `_set.md` and proposal bodies **are** encrypted. Attachment encryption is an open question for Phase 4 (Proposal §9.3); the first release leaves them cleartext and says so.

**Key derivation.** Argon2id via libsodium: `crypto_pwhash(32, passphrase, salt, OPSLIMIT_MODERATE, MEMLIMIT_MODERATE, ALG_ARGON2ID13)`. Parameters are stored, not assumed, so they can be raised later. The 16-byte random salt and the parameters live in the repo at `.gnomon/encryption.json` (Schema §10 reserves the folder):

```json
{ "version": 1, "kdf": "argon2id13", "salt": "<base64>", "opslimit": 3, "memlimit": 268435456,
  "check": "<base64 AES-GCM encryption of the constant 'gnomon-ok' under the derived key>" }
```

`check` lets the app verify a passphrase before touching any file. The derived 32 bytes are imported with `crypto.subtle.importKey('raw', ..., {name:'AES-GCM'}, false, ['encrypt','decrypt'])` — **non-extractable** — and the raw bytes are zeroed. Unlock happens once per session; the `CryptoKey` lives in memory only. "Remember on this device" is offered: the raw key is wrapped with a device key held in IndexedDB as a non-extractable `CryptoKey`, and the wrapped blob is stored beside it. This does not protect against an attacker with the device unlocked; the disclosure says so.

**Enabling encryption on an existing brain** is a single commit that rewrites every eligible body as ciphertext and adds `.gnomon/encryption.json`. **Disabling** is the reverse. Both require the head to be unchanged during the operation (standard `expectedHead`). **Passphrase change** re-derives, re-encrypts every body, and rewrites the salt and `check` in one commit.

**Desktop interop.** `gnomon encrypt` / `gnomon decrypt` use the same format, so a desktop user can decrypt a clone into a working directory for a local-model session and re-encrypt before pushing. AGENTS.md for encrypted brains instructs agents to run these at session boundaries. git-crypt is documented as an alternative for users who prefer filter-based transparency, but is not required by the format.

**What is deliberately not done:** no custom padding or length hiding (file sizes leak; disclosed), no encryption of filenames (slugs leak; disclosed), no key escrow or recovery — a lost passphrase loses the bodies, and the enable flow requires the user to type that sentence back.

## 7. Brain model operations (`core`)

### 7.1 Links (`links`)

- `parseLinks(body): LinkRef[]` finds dual links `[[target]] ([label](relative.md))`, lone wikilinks, and lone relative links to `.md` files. Each ref carries the resolved repo path, an optional heading anchor, and its source span.
- `renderDualLink(fromPath, toPath, label, anchor?)` produces the canonical dual-link string (Schema §6). The markdown-it plugin in `app` collapses a dual link to one anchor at render time.
- `backlinks(snapshot): Map<path, path[]>` computed once per snapshot from body links plus `grounds`, `related`, `target`, and `from_source` frontmatter.
- `groundsDrift(principle): { inBodyOnly: string[]; inGroundsOnly: string[] }` compares body source links with `grounds`; feeds the Schema §9 warning and the editor's one-tap sync.

### 7.2 Index generation (`index`)

`generateIndexes(snapshot): { 'maps/_index.md': string; 'principles/_index.md': string }`. Pure, deterministic: sets by `order`; principles by `order` within each set; sources by `author`, then `work`, then `title`; open proposals by id; tags by name; all comparisons by codepoint. Frontmatter is exactly `type: index` (Schema §4.8), so output depends on nothing but the other files. Every BrainService write that changes any frontmatter-bearing file includes the regenerated indexes in the same commit **only if they differ** from the current blobs; with no timestamp in the header, an unchanged index produces no write.

### 7.3 Sets and principles (`sets`)

Implements Schema §7.1–§7.4 (sets) and §7.9 (principles) as pure functions from `(snapshot, params)` to a `CommitBatch`. `deleteSet` and `deletePrinciple` return the batch plus a `dangling: { path, ref }[]` report for the UI, covering `related` refs, proposal `target`/`target_set`, and `notes.md` body links. `reorderPrinciples(setSlug, orderedSlugs)` rewrites `order` on every principle whose position changed and nothing else. `newSetSlug(existing: Set<string>)` uses `crypto.getRandomValues` over the 31-character alphabet; the fixed Set 1 slug `ps-g8xw` comes from the template, never from this function.

### 7.4 Validation

`validateSnapshot(snapshot): Issue[]` runs Schema §9 across the whole brain and tags each issue `refusal` or `warning` (order contiguity for sets and for principles within a set, `set`/`source` path agreement, undeclared or missing attachments, filed captures without a matching source, dangling grounds and grounds drift as warnings). `validateWrite(prev: BrainFile | undefined, next: BrainFile)` enforces the per-write rules, notably raw-body immutability for `human`/`ratified` sources and attachment immutability always. BrainService refuses to build a batch that fails `validateWrite`.

### 7.5 Proposals (`proposals`)

`nextProposalId(snapshot, nowUtc): string` scans `maps/proposals/` for the day's highest `<nnn>` and returns the next (Schema §3.5); a same-id race is caught by `expectedHead` and the caller re-draws. `buildProposal(params): FileWrite` writes a Schema §4.7 file from the template. `decideProposal(snapshot, id, status): CommitBatch` rewrites `status` and `updated` only, message `Decide: {id}`.

### 7.6 Filing (`filing`)

`buildFiling(snapshot, capture: BrainFile<InboxFm>, meta: SourceMeta, proposals: ProposalParams[]): CommitBatch` implements Schema §7.6 exactly: slug with collision handling; `raw.md` whose body is `capture.body` unchanged; `original.<ext>` written from the capture's attachment bytes; `notes.md` from the template; one proposal file per entry; the capture rewritten with `status: filed` and `filed_as` and nothing else changed; message `File: {slug}`. This function is the only code path that writes a `raw.md`, in the app and in any future CLI filing, so passage text can only ever be a copy.

## 8. Reasoning (`core/assembly`, `providers`, ReasoningService)

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

1. For each selected set in set `order`: emit `## Set {order}{ — name}`, the `_set.md` body, then each principle in principle `order` as `### {order}. {title}` + body + a machine-readable line `<!-- ref: principles/{set}/{slug} -->`. If the running total exceeds budget here, return `{ error: 'SETS_EXCEED_BUDGET', neededTokens }` and stop.
2. Collect grounding slugs in order of first reference across the emitted principles; for each, emit `### Passage: {title} — {author}` + `raw.md` body + ref comment, until adding the next would exceed budget. Attachments are never read or sent.
3. For remaining slugs: emit under `## Passages referenced but not included` the `notes.md` body (if any) or the source's title/author line, plus a ref comment.
4. Task B appends `## New text` + input. If it does not fit, return `{ error: 'INPUT_EXCEEDS_BUDGET' }`.

The **system prompt** is a fixed template per task (A, B, D, free-form) shipped in `assembly/prompts/*.md`, and includes: the curation rules the model must respect (proposal-only for principles); the citation instruction (cite as `[[ref]]` using the ref comments); the precedence rule (within a set, the numbered order is precedence: name any tension, resolve it in favor of the lower number only if answering requires it, and say that precedence was invoked); and, when more than one set is selected, the requirement to reason per set before comparing, to attribute every claim, and never to apply one set's precedence to another. The `_set.md` body is placed in the user turn as context by default; `settings.setDescriptionPlacement` flips it into the system prompt for evaluation (Proposal §9.3).

`AssemblyResult` also returns `included: ref[]`, `excluded: ref[]`, and `tokensUsed`, which the UI shows before sending.

### 8.4 Citations

Responses are scanned for `[[path]]` refs that resolve into the snapshot; each becomes a tappable link. Unresolvable refs are rendered as plain text with a subtle marker so hallucinated citations are visible rather than hidden.

### 8.5 Filing through the app (Task C)

Filing via the PWA is a structured-output completion, not free chat. The system prompt asks for a strict JSON object per capture: source metadata (`title`, `author`, `work?`, `year?`, `locator?`, `origin?`, `tags?`) and an array of proposals (`kind`, `title`, `target_set?`, `target?`, `grounds?`, `rationale`). The prompt carries the capture's text and note, never the attachment. The app validates the JSON against `SourceMeta` and `ProposalParams`, then calls `core/filing.buildFiling` (§7.6), which copies the body and attachment itself and commits one batch per capture. The model proposes metadata and proposals; it never produces the passage text. This structurally satisfies Schema §4.2 immutability even if the model is careless.

## 9. Ratification and rejection

- **Ratify(filingSha):** `compare(parent(filingSha), filingSha)` → for every added file of `type: source` or `type: notes` with `curated: agent-proposed`, rewrite to `ratified` (touching `curated` and `updated` only); proposal files and the capture are left as the filing wrote them; regenerate indexes; one commit `Ratify: {slug}`.
- **Reject(filingSha):** `revert(filingSha, "Reject: {slug}")`. The revert removes the source folder and the filing's proposal files and restores the capture to `status: unfiled` without `filed_as`. On `RevertConflictError` (the curator edited `notes.md`, or decided one of the filing's proposals), the UI lists the conflicting paths and offers per-file manual actions.
- **Review view:** built from `compare` output — added markdown files rendered in full from their blob, an added attachment shown as name and size, the modified capture showing its `+` patch lines only.

Filing commits are recognized by message prefix `File: ` and by containing at least one added `raw.md`; the Inbox screen lists them from `history({limit: 50})`.

## 10. Application layer (`app`)

### 10.1 Structure

```
app/src/
├── lib/
│   ├── stores/        # runes-based state: session, snapshot, settings, reasoning
│   ├── services/      # BrainService, ReasoningService, OnboardingService, KeyringService
│   ├── router.ts      # hash-based router; routes: /capture /browse/* /inbox /proposals /sets /reason /settings /onboarding
│   └── components/    # reusable: MarkdownView, LinkChip, SetPicker, BudgetBar, CommitReview, AttachmentView
├── routes/            # one Svelte component per screen (Proposal §6)
├── sw/                # service worker config (vite-plugin-pwa)
└── main.ts
```

Hash routing is used deliberately: GitHub Pages cannot rewrite paths to `index.html`, and hash routes survive refresh and home-screen launch without a 404 fallback hack.

### 10.2 State

- `session`: `{ driver: StorageDriver | null, unlocked: boolean }` — rebuilt from IndexedDB at launch.
- `snapshot`: `BrainSnapshot | null` plus `stale: boolean`; every driver `commit` success replaces it with the new head; every `HeadMovedError` sets `stale`. Attachment bytes are fetched on view and cached in memory by blob SHA for the session only.
- `settings`: git connection, providers, budget percent, `setDescriptionPlacement: 'context' | 'system'`, theme; persisted via `idb-keyval`.
- `reasoning`: current selected sets (persisted), task, transcript, streaming state.

Stores are Svelte 5 `$state` objects exported from modules; services mutate them. No global event bus.

### 10.3 On-device storage schema (IndexedDB via `idb-keyval`)

| Key | Value | Notes |
|---|---|---|
| `git.token` | string | Fine-grained PAT. |
| `git.repo` | `{ owner, name }` | |
| `provider.anthropic.key`, `provider.openrouter.key` | string | |
| `prefs` | object | Theme, budget percent, last selected sets, capture defaults, set-description placement. |
| `enc.deviceKey` | non-extractable `CryptoKey` | Only if "remember on this device". |
| `enc.wrappedKey` | ArrayBuffer | Brain key wrapped under `enc.deviceKey`. |

No brain content — markdown or attachment — is ever written to IndexedDB, localStorage, or the Cache API. iOS may evict this store after seven days of non-use; the app treats a missing token as "signed out" and re-onboards to the token step only.

### 10.4 Capture path (US-1 budget)

Launch → Capture screen is the default route, rendered before the snapshot loads. The screen has the paste target, the note field, and an attach control (`<input type="file">`, which on iOS offers Files, Photos, and the camera). Save builds the capture locally — stem per Schema §3.4, attachment written as `inbox/<stem>.<ext>` with the extension lowercased — and issues one `commit` with `expectedHead` = last known head; on `HeadMovedError` it refetches head and retries once automatically (a capture cannot conflict with anything). Attachments over the §6.2 limit are refused before upload with the size shown. Snapshot refresh happens after the commit resolves, off the critical path.

## 11. PWA and service worker

- Manifest: `display: standalone`, `start_url: {base}/#/capture`, maskable icons at 192/512, `theme_color` matching the app.
- Workbox `generateSW` with `globPatterns` for the app shell; `navigateFallback` to `index.html`; **no runtime caching routes** — requests to `api.github.com`, `api.anthropic.com`, `openrouter.ai` bypass the worker entirely.
- Update strategy: `registerType: 'prompt'`; the app shows a "new version — reload" toast rather than auto-reloading mid-edit.
- iOS: no install prompt API; onboarding shows the Share → Add to Home Screen steps with the actual icons. `apple-mobile-web-app-*` meta tags set.

## 12. Onboarding service

1. Token walkthrough (annotated screenshots bundled as assets; steps differ for classic vs fine-grained).
2. Validate token: `GET /user` and permission probe.
3. Create-from-template: `createRepo` (with `auto_init`) → one commit on top that writes the `template/` tree, Set 1 at `ps-g8xw` included, and deletes the auto-generated README. Nothing is generated per user.
4. Or connect-existing: `list()` → `readMany` → validate layout (Schema §2) and content (Schema §9) → offer to add each missing scaffold item as its own commit; show refusals and warnings; never modify an existing file.
5. Privacy screen; optional encryption enablement (Phase 4) placed here so the choice is made before content exists.
6. Swap to a single-repo token (guided, optional).

## 13. Template repository and CLI

`template/` contains the scaffold exactly as Schema §2 describes it: `AGENTS.md`, `README.md`, `templates/*`, `principles/ps-g8xw/_set.md`, the two generated-empty index files, `inbox/`, `sources/`, `maps/` with empty-directory keepers, and a `.gitignore` for editor and OS cruft only (attachments are tracked, so no binary extensions are ignored). No `package.json`, no scripts.

`packages/cli` is published to npm as **`gnomon-cli`** with the binary **`gnomon`**; a clone runs `npx gnomon-cli <command>`, an installed user runs `gnomon <command>`. It composes `core` with a working-tree driver (reads and writes the local filesystem; makes no commits — the agent or the user commits). Commands:

- `gnomon validate` — Schema §9 over the working tree; prints refusals and warnings; nonzero exit on refusals.
- `gnomon index` — regenerate both index files (same code as the app); writes only if changed.
- `gnomon status` — counts: unfiled captures, sources by curation state, sets and principles, open proposals; uncommitted changes; a one-line nudge (what to run next). Read-only.
- `gnomon encrypt` / `gnomon decrypt` — Phase 4; same format as §6.4; passphrase via prompt or `GNOMON_PASSPHRASE`.

AGENTS.md instructs agents to run `npx gnomon-cli validate && npx gnomon-cli index` before the final push of a session. Requires Node 20+; the README says so and names the app-side regeneration as the fallback for users without Node.

## 14. Error handling and offline

All driver errors are typed: `AuthError`, `HeadMovedError`, `RevertConflictError`, `RateLimitError`, `NetworkError`, `ValidationError`, `AttachmentTooLargeError`, `LockedError` (encrypted brain, no key). Screens map these to specific recoveries rather than generic toasts: `AuthError` → token step; `HeadMovedError` → refresh banner with retry; `LockedError` → unlock sheet; `AttachmentTooLargeError` → the size and the limit, with the capture kept in the form. Offline: the app shell loads; Capture accepts text and queues **one** pending text-only capture in memory (not persisted — see §10.3) with a clear "will save when online" state; attachments are not queued; everything else shows the read-only cached snapshot if present.

## 15. Security considerations

- Content Security Policy via meta tag: `default-src 'self'; connect-src 'self' https://api.github.com https://api.anthropic.com https://openrouter.ai; script-src 'self' 'wasm-unsafe-eval'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'`. No third-party scripts, no analytics.
- Markdown rendering: `markdown-it` with `html: false`; links to non-brain origins open in a new tab with `rel="noopener noreferrer"`.
- Attachments: images are previewed inline from a `blob:` URL; PDFs are opened in a new tab from a `blob:` URL; HTML attachments are **never rendered** — they are shown as source text or downloaded — so a captured page can never run script in the app's origin.
- Keys never appear in URLs, logs, or error reports. There are no error reports; errors stay on device.
- Dependencies pinned with lockfile; `npm audit` in CI; libsodium and yaml pinned to exact versions.
- Subresource integrity is not applicable (same-origin bundle), but the Pages deploy is from a protected branch only.

## 16. Performance targets

Cold start to interactive Capture screen < 1.5 s on a mid-range phone over LTE; text capture commit round-trip < 3 s; snapshot load for a 500-file brain < 4 s (one tree call plus at most six GraphQL batches, attachments untouched); assembly for a 40-principle set < 50 ms; Argon2id unlock 1–3 s on phone hardware (by design). These are measured in Phase 1 against the reference brain, and §20.1 is decided from the measurement.

## 17. Testing

- **Unit (Vitest):** `core` at high coverage — parse/serialize round-trips, canonical serialization determinism, index generation golden files (including "unchanged brain produces identical bytes"), set operations (delete-and-renumber, dangling-reference reports), principle operations (create appends at N+1, reorder rewrites only moved files, delete renumbers), proposal id sequencing, filing batch construction (body and attachment are copies, capture gains exactly two fields), assembly against synthetic brains at various budgets and with precedence-ordered output, encrypted body encrypt/decrypt including AAD path-binding failure, validation rules one by one with refusal/warning classification, grounds drift detection.
- **Driver contract tests:** a single suite run against `MemoryDriver` and, in CI with a disposable token, against a scratch GitHub repo: `expectedHead` rejection, multi-file atomic commit including a binary write, `readMany` batching over 100 paths, `revert` conflict detection, and **reject of an earlier filing after a later filing has landed succeeds**.
- **Flows (Playwright, against `MemoryDriver` in a test build):** capture with and without an attachment; connect-existing showing validation results and adding a missing template; create Set 2, rename, reorder principles, delete Set 1, verify labels and links; file via mocked provider, review (attachment shown by name and size), ratify, reject; reason from two sets with a mocked provider and verify citations resolve and precedence numbering appears.
- **Fixtures:** the reference brain in `packages/core/fixtures/` is built from `template/` plus a few sources, principles, and proposals, so tests and onboarding share one scaffold; `gnomon validate` over the raw `template/` must pass with zero issues in CI.

## 18. Build and deploy

GitHub Actions on push to `main`: install, typecheck, unit tests, `gnomon validate` over `template/`, build `app` with `VITE_BASE=/gnomon/`, deploy to Pages via `actions/deploy-pages`. Contract tests against real GitHub run on a nightly schedule, not on every push. Releases tag the repo; the tag workflow publishes `gnomon-cli` to npm with the same version, and the app shows its version (from `package.json`) in Settings. Index files carry no version (Schema §4.8).

## 19. Phase mapping

| Phase | This spec's deliverables |
|---|---|
| 1 | `core` schema/links/index/sets/proposals/filing/validation; `storage` interface, GitHub (REST + GraphQL) + Memory drivers, **Encrypting driver interface, body format, and unit tests with a stub keyring**; `gnomon-cli` validate/index/status published to npm; `template/` finalized and validated in CI; app shell, router, Capture with attachment, Browse with attachment view, Settings, PWA; onboarding connect-existing. |
| 2 | Sets screen with principle reorder; `providers` both drivers; assembly + Reason screen (Tasks A, B, D); filing (Task C), review, ratify/reject; proposals screen with decide; editors with curation enforcement and grounds sync. |
| 3 | Onboarding create-from-template, token walkthrough, privacy screen; polish. |
| 4 | Encrypting driver wired to real keyring, unlock UI, enable/disable/passphrase-change flows; `gnomon encrypt/decrypt`; attachment-encryption decision; second storage driver. |

## 20. Open technical decisions

1. **Snapshot persistence across launches.** Currently none (brain content never touches device storage). A Cache-API-free option is to persist only the tree listing (paths + blob SHAs, no content) to speed cold start; decide after measuring §16 targets with the GraphQL loader.
2. **Anthropic context-window table maintenance.** Bundled table vs. a `/models` field if one becomes available; revisit at each release.
3. **Argon2id parameters.** `MODERATE` (256 MB) may be too slow on older phones; measure on the oldest supported iPhone and decide whether to default to `INTERACTIVE` with a user-raisable setting.
4. **Multiple pending offline captures.** Deliberately capped at one, text only; revisit if real usage shows loss.
5. **Set description placement** (context vs. system) — evaluate with real prompts in Phase 2 before removing the flag.
6. **Attachment encryption** in Phase 4 — cleartext with disclosure in the first release; decide whether to encrypt bytes under the same key and format (marker as a sidecar, since binaries have no comment line).
7. **Attachment size limit** — 20 MB is a starting point; tune from capture round-trip measurements on LTE.
