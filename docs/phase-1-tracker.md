# Phase 1 tracker

Working document for Phase 1 (technical spec §19, row 1). One block at a
time, in this order. Each block ends in a green commit with its own tests
and a "done when" you can check without reading code. Tick a block when
it is committed and CI is green. Delete this file when Phase 1 is complete
and write `docs/phase-2-tracker.md` from a fresh breakdown.

Started 2026-09-06. Resume a session by finding the first unticked block.

## Blocks

Blocks 1–12 are the core library and CLI; all testable offline against the
three golden brains (`template/`, `packages/core/fixtures/brain/`, and
`~/Desktop/main/geo-brain-2`). Blocks 13 onward touch the network and the
browser.

- [x] **1. Reference brain fixture** (S) — `packages/core/fixtures/brain/`:
  the template plus a few sources (one with an attachment), principles
  across two sets, and proposals in each status. Done when
  `npm run validate:fixture` reports zero refusals, zero warnings, indexes
  up to date. *Done 2026-09-06; CI validates it alongside the template.*
- [x] **2. `parseFile` / `serializeFile`** (M) — `packages/core/src/schema`,
  spec §5. Done when every frontmatter-bearing file in the three golden
  brains round-trips byte-identical, and bad YAML or missing frontmatter
  throws a typed `ValidationError`. *Done 2026-09-06. Template and fixture
  round-trip byte for byte; geo-brain-2 round-trips semantically and
  idempotently, differing only in three double-quoted titles that the
  canonical form writes plain.*
- [x] **3. Snapshot builder** (S) — build `BrainSnapshot` from a
  path→text map plus tree entries. Done when `sets` and `principlesOf`
  are sorted by `order` and `byType` works for every type. *Done
  2026-09-06. `buildSnapshot` in `core/schema/snapshot.ts`; files that
  fail to parse are reported in `snapshot.issues` (an additive extension
  to spec §5) and left out, so a brain with one broken file still loads.
  `TreeEntry` now lives in core and storage re-exports it.*
- [x] **4. `validateSnapshot`** (M) — spec §7.4, schema §9. Done when it
  reproduces every refusal and warning of `tools/gnomon-check.py` on the
  golden brains and on hand-broken variants, one test per rule, each
  tagged `refusal` or `warning`. *Done 2026-09-06. Also `validateLayout`
  (schema §2 scaffold, needs the raw tree because empty folders hold only
  `.gitkeep`) and `hasRefusals`. Goes beyond the Python checker with:
  undeclared attachments, attachment naming, notes without raw, principle
  folders without `_set.md`, proposal `target`/`target_set`/`from_source`
  dangling, stale `inbox_ref`, unknown fields, stray files (warning). The
  links module is seeded with `linkedSourceSlugs` for grounds drift.*
- [x] **5. `validateWrite`** (S) — spec §7.4. Done when it refuses a
  `raw.md` body change in `human` or `ratified` state and any attachment
  change, and allows everything else. *Done 2026-09-06. Per schema §5 the
  raw body is immutable in every state, not only `human`/`ratified`. Also
  refuses `created` changes, curation transitions outside §5, and edits to
  a capture's body, note, or attachment. `validateBatch(snapshot, batch)`
  applies these plus attachment immutability and source deletion to a
  whole `CommitBatch`; `applyBatch` computes the resulting snapshot in
  memory. `CommitBatch`/`FileWrite` moved into core (storage re-exports).*
- [x] **6. Links module** (S) — spec §7.1: `parseLinks`, `renderDualLink`,
  `backlinks`, `groundsDrift`. Done when geo-brain-2's heading-anchored
  links parse and the drift warning matches the Python checker. *Done
  2026-09-06. `parseLinks(body, fromPath)` takes the referencing path so
  relative links resolve; a dual link whose halves disagree carries a
  `mismatch`. `renderDualLink` defaults the label from the target (raw,
  notes, set, principle, proposal, capture, file) and reproduces the
  reference generator's output. `backlinks` ignores index files and adds
  proposal `target_set` and `grounds` to the spec's list. `relativePath`
  and `resolveRelative` are exported for block 7.*
- [x] **7. `generateIndexes`** (M) — spec §7.2. Done when output is
  byte-identical to both `_index.md` files in `template/` and geo-brain-2,
  and to the Python checker's output on the fixture; regenerating an
  unchanged brain yields no diff. *Done 2026-09-06. Byte-identical on all
  three golden brains, and a test runs `tools/gnomon-check.py` on four
  mutated fixture variants and compares (CI installs PyYAML before
  `npm test` for this). `indexWrites(snapshot)` returns only the index
  files whose text differs, for the commit that carries them. Sorting is
  by codepoint via `cmpCodepoint`. Digit-only tags must be quoted
  (`"2026"`) or YAML reads them as integers.*
- [x] **8. Sets and principles** (M) — spec §7.3, schema §7.1–7.4, §7.9.
  Done when create/rename/reorder/delete produce `CommitBatch` values with
  correct renumbering, `reorderPrinciples` rewrites only moved files, and
  delete returns the dangling-reference report. *Done 2026-09-06.
  `core/sets`: `newSetSlug`, `createSet`, `updateSet` (rename, description,
  remove name), `reorderSets`, `deleteSet`, `slugify`,
  `uniquePrincipleSlug`, `createPrinciple`, `updatePrinciple`,
  `reorderPrinciples`, `deletePrinciple`. Every batch carries the index
  files it changes via `withIndexWrites` (in `core/index`). Commit
  messages beyond the schema's vocabulary: `Update principle set:`,
  `Reorder principle sets`, `Reorder principles: Set N`, `Edit principle:`,
  `Delete principle:`. Dangling reports cover `related`, proposal
  `target`/`target_set`, and body links in every file.*
- [x] **9. Proposals and filing** (M) — spec §7.5, §7.6. Done when
  `nextProposalId` sequences within a day, `decideProposal` touches only
  `status` and `updated`, and `buildFiling` copies body and attachment
  byte for byte and changes exactly two capture fields. *Done 2026-09-06.
  `core/proposals`: `nextProposalId` (accepts ids drawn earlier in the
  same batch), `buildProposal` (validates kind-conditional fields),
  `decideProposal` (carries the `maps/_index.md` change since the open
  list moves). `core/filing`: `proposeSourceSlug` (surname + title
  fragment), `uniqueSourceSlug`, `buildFiling` (no index writes per
  schema §7.6; the capture's `updated` is left alone since only `status`
  and `filed_as` may change; a `tag` proposal without a target targets
  the new source). Ratify and reject are spec §9, Phase 2.*
- [x] **10. Encrypted body format** (S) — spec §6.4 pure functions with a
  stub keyring. Done when encrypt/decrypt round-trips, AAD path binding
  fails on the wrong path, and unmarked bodies pass through as plaintext.
  *Done 2026-09-06. `core/crypto`: `encryptBody`, `decryptBody`,
  `decryptIfEncrypted`, `isEncryptedBody`, `isEncryptablePath`,
  `importBodyKey` (non-extractable, zeroes the input), dependency-free
  base64, and the `EncryptionConfig` type for `.gnomon/encryption.json`.
  Payload is one base64 line; decoding accepts wrapped input. The stub
  keyring is 32 fixed bytes through `importBodyKey`.*
- [x] **10b. `EncryptingDriver`** (S) — spec §6.4 wrapper, spec §19. Done
  when the block 11 contract suite passes through
  `EncryptingDriver(MemoryDriver, stubKeyring)`, reads return plaintext
  with a per-file `encrypted` flag, writes to encryptable paths store
  ciphertext, unchanged plaintext keeps its ciphertext, and
  non-encryptable paths pass through untouched. *Done 2026-09-06.
  `storage/encrypting.ts` and `storage/keyring.ts` (`Keyring` interface,
  `StaticKeyring` in-memory holder, also the stub). The key is fetched
  lazily, so a locked keyring still reads a plaintext or mixed brain.
  Ciphertext reuse is per body: a rewrite whose plaintext body equals the
  stored one keeps the stored ciphertext even when frontmatter changes,
  so a filing's capture diff is its two frontmatter lines. `compare`
  patches describe stored bytes (a body change shows as a ciphertext
  line); recomputing plaintext patches needs blob reads by SHA at both
  commits, a Phase 4 decision for the review view on encrypted brains.*
- [x] **11. `MemoryDriver` + driver contract suite** (M) — spec §6.3, §17.
  Done when the suite passes: `expectedHead` rejection, atomic multi-file
  commit with a binary write, `readMany` over 100+ paths, revert conflict
  detection, and reject-of-an-earlier-filing-after-a-later-one succeeds.
  *Done 2026-09-06. `storage/memory.ts` with git-compatible blob SHAs
  (`gitBlobSha`) so revert conflicts behave as on GitHub, an injectable
  clock, `createRepo` in auto_init shape, and `linePatch` for compare
  output. `storage/snapshot.ts` `loadSnapshot(driver)` is the one
  list→readMany→buildSnapshot path for the CLI and the app. The contract
  suite is `storage/test/contract.ts` `driverContract(name, factory)`;
  blocks 10b and 13 run it. `ReadResult` (core) carries the optional
  per-file `encrypted` flag into `buildSnapshot`. `NotFoundError` added.
  Storage tests get their own tsconfig with Node types like core's.*
- [x] **12. Working-tree driver + CLI `validate` / `index` / `status`** (M)
  — spec §13. Done when the CLI runs on `template/` and geo-brain-2 and
  agrees with the Python checker, and CI's template check uses the CLI
  instead of the Python script. *Done 2026-09-06. `cli/src/worktree.ts`
  `WorkingTreeDriver` implements `StorageDriver` over the filesystem
  (`commit` writes files, no git commit; history/compare/revert throw).
  In a git checkout the file list is `git ls-files -co
  --exclude-standard` so ignored files are not part of the brain, the
  head is `HEAD`, and `validate` compares every modified tracked file
  against `git show HEAD:` for the byte-identical rules; outside git it
  says those rules were skipped. `validate` also prints a NOTE when an
  index is stale. `npm run build:cli` bundles with esbuild (a
  `createRequire` banner is needed for the `yaml` package's CJS build).
  CI builds the CLI and runs `validate:template` and `validate:fixture`
  through it; `validate:reference` still runs the Python checker by hand
  and the block 7 cross-check test keeps it honest.*
- [x] **13. `GitHubDriver`** (L) — spec §6.2, REST writes + GraphQL reads,
  no Octokit. Done when it passes the block 11 contract suite against a
  scratch repo. *Done against a fake 2026-09-06: `storage/github.ts`
  passes the contract suite through `storage/test/fake-github.ts`, an
  in-memory model of the git object store and every endpoint the driver
  uses, served as a `fetch`. Also tested: header set, one tree call plus
  at most six GraphQL batches for a 500-file brain, the five-step commit
  sequence, a head that moves between the ref check and the ref update
  (the `force: false` guard), binary-blob fallback, error mapping (401
  AuthError, 403 with `x-ratelimit-remaining: 0` or 429 RateLimitError,
  thrown fetch NetworkError, 404 NotFoundError), and `createRepo`
  retargeting the driver.*
- [ ] **13b. `GitHubDriver` against real GitHub** (S) — needs a disposable
  fine-grained token (Contents read/write) and a scratch private repo
  from the maintainer. Done when the contract suite passes against it on
  the nightly schedule (spec §18). Things the fake assumes that the real
  run must confirm: a `POST /git/trees` entry with `sha: null` for a path
  absent from `base_tree` is a 422 (the driver relies on it for atomic
  failure); the ref PATCH with `force: false` returns 422 on a non-fast-
  forward; `/compare` file statuses are `added`/`modified`/`removed` with
  `patch` for text; blob `size` is present in recursive tree listings;
  `auto_init` makes the ref available immediately or within the driver's
  ten retries.
- [x] **14. App shell: stores, BrainService, snapshot load** (M) — spec
  §10.1–10.2. Done when the app loads the demo brain (the reference
  fixture through `MemoryDriver`) and lists its contents, the same
  `BrainService` path is wired to `GitHubDriver` behind Settings, and
  `HeadMovedError` sets `stale` with a refresh banner. *Done 2026-09-06.
  Stores: `settings` (idb-keyval under the spec §10.3 keys; `$state`
  proxies must be `$state.snapshot`-ed before IndexedDB), `session`,
  `snapshot`. `services/brain.ts` `BrainService` is framework-free and
  unit-tested: connect, refresh, validateBatch refusal before the driver,
  local `applyBatch` at the new head then background refresh, stale on
  `HeadMovedError`. `demo/fixture.ts` bundles the fixture via
  `import.meta.glob`. Playwright is set up (`npm run e2e -w packages/app`,
  dev server, Chromium, 390×844) with three shell flows; CI installs
  Chromium and runs them after the build. The GitHub path is verified in
  block 13b.*
- [x] **15. Capture screen with attachment** (M) — spec §10.4. Done when a
  Playwright flow captures text with and without a PDF into the demo
  brain as one `Capture:` commit that validates, the size limit is
  enforced before upload, and a unit test covers the head-moved retry.
  *Done 2026-09-06. `core/capture` (`newInboxStem`, `attachmentExtension`,
  `buildCapture`) so a desktop `/capture` command can reuse the rule;
  `randomAlphabet` in identifiers now serves stems and set slugs. The app's
  `services/capture.ts` `captureToInbox` refuses an oversized attachment
  before any upload, commits once, and on `HeadMovedError` refreshes and
  retries once. The screen keeps the capture in the form on error and
  shows the stem on success. Still open from spec §14: the single pending
  offline text capture, deferred to block 18 (PWA polish).*
- [x] **16. Browse screen with attachment view** (L) — proposal §6. Done
  when a Playwright flow over the demo brain shows sets in order and
  principles in precedence order with labels, opens a file with markdown
  rendered and dual links collapsed to one element, shows backlinks, and
  opens an attachment (image preview, PDF in a new tab); HTML is never
  rendered. *Done 2026-09-06. `lib/markdown.ts` (unit-tested): markdown-it
  with `html: false`, dual links collapsed through core's `parseLinks`
  spans into one `#/browse/<path>#<anchor>` link labelled with the
  target's title, external links `target=_blank rel=noopener`, GitHub-
  style heading ids so anchors land. `lib/attachments.ts`: blob URLs
  cached by SHA for the session; images inline, PDFs via `window.open` in
  a new tab, HTML served as `text/plain` and shown in a `<pre>`, others
  as a download. `routes/FileView.svelte` shows frontmatter, body,
  backlinks (`core.backlinks`), and the attachment link; `Browse.svelte`
  gains a tag filter (`?tag=`). `lib/route.ts` holds rune-free route
  parsing (`#/name/path?query#anchor`) so it is unit-testable. Links
  inside fenced code blocks are rewritten too; bodies are prose, noted.*
- [x] **17. Settings + connect-existing** (M) — spec §12 step 4, US-15.
  Done when token and repo can be entered and persisted in IndexedDB,
  validation results are shown, each missing scaffold item is offered as
  its own commit, and a Playwright flow exercises connect-existing against
  a demo brain with a scaffold item removed. *Done 2026-09-06.
  `lib/scaffold.ts` bundles `template/**/*.md` (Phase 3 reuses it).
  `services/connect.ts` (unit-tested): `inspectBrain` returns refusals,
  warnings, one `Scaffold: <path>` offer per missing scaffold item (a
  folder as its `.gitkeep`), `Add Set 1` on `sets.none`, and an `Index`
  offer when the generated files are stale; `applyOffer` commits one and
  re-inspects, so every offer carries the current head. Index
  regeneration is offered, never automatic. `ValidationPanel.svelte`
  lists refusals with Add buttons or "fix by hand", then warnings.
  Settings adds provider keys, budget, set-description placement, theme
  (`data-theme` + `color-scheme`), the who-can-see-what text, and the
  version. `describeError` maps AuthError/NotFoundError/RateLimitError/
  NetworkError to sentences. Test affordance: `#/settings?demo-omit=a,b`
  drops paths from the demo brain. Local Settings fields sync once
  on-device settings load, since they arrive after first render. The
  mocked-401 flow caught a real driver bug: `GitHubDriver` called the
  stored global `fetch` as a method, which browsers reject as an illegal
  invocation; it is now called unbound.*
- [ ] **18. PWA polish + Pages deploy** (S) — spec §11, §18. Done when the
  app installs on iPhone, shows the update toast, and CI deploys to Pages.
- [ ] **19. Publish `gnomon-cli`** (S) — spec §18. Done when a tagged
  release publishes to npm and `npx gnomon-cli validate` works in a fresh
  brain clone. **The maintainer runs the publish.**

## Decisions made during Phase 1

- **CLI and the raw-body immutability rule.** The CLI reads only the
  working tree and makes no commits, but schema §9's "byte-identical to
  its previous committed version" needs the last commit. The CLI reads the
  previous version via `git show HEAD:<path>` when a `.git` directory is
  present and skips that one rule otherwise, saying so in its output.
- **Python checker retires at block 12.** Since block 12 the CLI validates
  the template and fixture in CI. `tools/gnomon-check.py` stays as the
  reference implementation: the block 7 index cross-check test still runs
  it on fixture variants, and `npm run validate:reference` runs it by hand.

## Notes for whoever resumes

- Spec's Phase 1 row is broader than CLAUDE.md's five-step list; this
  tracker follows the spec.
- Known serialization traps from geo-brain-2: date-only `created` beside
  full datetimes, double-quoted titles containing quotes, principles that
  omit `related` and `tags` entirely while the template writes `[]`.
  Round-trip fidelity means preserving what the file has.
- Canonical form quotes any string that YAML would read as something else
  (`locator: "4.3"`, `title: "true"`); the fixture had `locator: 4.3` and
  the serializer caught it. Per-file schema §9 rules live in `parseFile`
  under stable rule ids (`field.required`, `path.set-mismatch`, ...);
  cross-file rules are block 4.
- Block 7 must match the Python reference byte for byte. The reference
  was corrected 2026-09-06 to put a blank line between one author's source
  list and the next `### Author` heading in `maps/_index.md`.
- The tracker is the only place Phase 1 progress is recorded. Update it
  in the same commit as the block it ticks.
