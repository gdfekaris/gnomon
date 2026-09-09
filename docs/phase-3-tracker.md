# Phase 3 tracker

Working document for Phase 3 (technical spec §19, row 3; proposal §8):
onboarding for other people and polish. One block at a time, in this
order. Each block ends in a green commit with its own tests and a "done
when" you can check without reading code. Tick a block when it is
committed and CI is green. Delete this file when Phase 3 is complete and
write `docs/phase-4-tracker.md` from a fresh breakdown.

Started 2026-09-08. Resume a session by finding the first unticked block.

## Blocks

Blocks 1–6 are the app; block 1 is library-shaped and tested over the fake
GitHub, the rest end in Playwright flows over the demo brain or a mocked
GitHub. Block 4 is the design pass, taken up now that every screen exists.

- [ ] **1. Onboarding service** (M) — spec §12 steps 2–4, US-14, US-15.
  `services/onboarding.ts`: `validateToken` (`GET /user` and a permission
  probe, mapping a rejected or under-privileged token to a sentence);
  `createFromTemplate` (`createRepo` with `auto_init`, then one commit on
  top that writes the bundled `template/` tree from `lib/scaffold.ts`,
  Set 1 at `ps-g8xw` included, and deletes the auto-generated README;
  nothing generated per user); connect-existing reuses block P1-17's
  `inspectBrain`. Done when, over `storage/test/fake-github.ts`, a fresh
  repository ends up as the template with Set 1 and both index files in
  one commit and validates clean, and a bad token is explained.
- [ ] **2. Onboarding screens** (L) — spec §12 steps 1, 5, 6; US-14,
  US-16; spec §11 iOS steps. `routes/Onboarding.svelte` on `#/onboarding`,
  the first screen when no brain is connected: the token walkthrough
  with annotated steps (classic and fine-grained differ), create-from-
  template or connect-existing, the who-can-see-what privacy screen
  (GitHub as host; the chosen provider during reasoning; nobody else),
  the optional swap to a single-repo token, and Add to Home Screen steps
  for iPhone. Done when a flow over a mocked GitHub walks from nothing to
  a connected, valid brain and lands on Capture, and a second flow
  connects an existing one showing its validation results.
- [ ] **3. Non-technical polish** (M) — proposal §8 Phase 3, US-14. First-
  run empty states on every screen; plain-language errors everywhere
  (audit `describeError` callers); a "what next" nudge on Capture and
  Browse mirroring the CLI's status line (unfiled captures, filings
  awaiting review, open proposals, stale indexes); loading and stale
  states reviewed on a slow connection. Done when a flow over a fresh
  template brain sees the nudges and empty states and a flow over the
  fixture sees the right nudge at each step of the loop.
- [ ] **4. The design pass** (L) — spec §1 ("a separate design pass"),
  proposal §8 Phase 3 polish. A mobile-first visual system across every
  screen: Capture, Browse and the file view, Sets, the editors, Reason,
  Inbox, Proposals, Settings, and the onboarding screens from block 2.
  First a design canvas of the screens for the maintainer to review and
  adjust; then the styling lands as shared tokens and components, real
  icons replace the `tools/make-icons.mjs` placeholders, and dark mode is
  checked. Done when the maintainer has approved the canvas, every screen
  uses the shared system, the manifest icons are the real ones, and every
  existing Playwright flow still passes unchanged.
- [ ] **5. Save as proposal** (S) — carried from Phase 2 (not in the spec's
  row; kept by the maintainer 2026-09-08). A Relate answer's proposal
  section can be saved as a `curated: human` proposal file (schema §4.7)
  targeting the selected set, one `Add proposal:` commit, with the kind
  and target chosen in a small form pre-filled from the answer. Done when
  a flow relates a text with the demo model and saves its proposal, and
  the Proposals screen lists it as open and yours.
- [ ] **6. Release readiness** (S) — spec §18, proposal §10. The CLI
  package gets `repository`, a README, and version `0.1.0`; the app shows
  its version (already in Settings) and the two match; a smoke checklist
  for the live human test (install on iPhone, capture with a photo,
  connect an existing brain, file and ratify, reason from two sets,
  desktop round trip through Claude Code with `npx gnomon-cli validate`).
  Done when `npm pack --dry-run` for the CLI lists only `dist/`, the
  README, and `package.json`, and the checklist is in `docs/`.

## Block 1 scope (2026-09-09)

Written before starting; delete this section in the commit that ticks
block 1. Spec §12 steps 2–4, US-14, US-15.

**New: `packages/app/src/lib/services/onboarding.ts`.**

- `validateToken({ token, owner?, name?, fetch? })` → `{ ok: true, login }`
  or `{ ok: false, reason }`. Always `GET /user`; a 401 is "GitHub
  rejected the token", a rate limit and a network failure get their own
  sentences. When `owner`/`name` are given (connect-existing) it also
  probes the repository: `GET /repos/<owner>/<name>` and reads
  `permissions.push`; a 404 is "the token cannot see this repository",
  `push: false` is "this token can read but not write". Create-from-
  template has no repository to probe, so a token that cannot create one
  is explained by `createFromTemplate` when `POST /user/repos` is refused
  with a 403. Sentences are the service's own; block 3 audits them with
  the other `describeError` callers.
- `createFromTemplate(driver, name, scaffold)` → `{ fullName, head }`.
  `driver.createRepo({ name, private: true })`, then exactly one commit
  `Scaffold: template` on top whose writes are every entry of `SCAFFOLD`
  (the template's own `README.md` replaces the auto-generated one in the
  same tree; nothing is generated per user). Set 1 and both generated-
  empty index files arrive as template files, so `indexWrites` over the
  resulting snapshot is empty. `Scaffold:` is the prefix connect-existing
  already uses (Phase 1); it is not in schema §7's list, which is a doc
  gap noted below.
- Connect-existing stays in `connect.ts` (`inspectBrain`, `applyOffer`);
  block 1 adds nothing there beyond what the scaffold change gives it.

**Changed.**

- `lib/scaffold.ts`: `SCAFFOLD` becomes the whole `template/` tree, not
  just `**/*.md`: `.gitignore`, the three `.gitkeep`s, and
  `.claude/commands/*.md`. A test asserts its key set equals the on-disk
  file list under `template/`, so the glob cannot silently drift again.
- `storage/src/github.ts`: two small public methods that `validateToken`
  uses so error mapping stays in one place: `whoami()` (`GET /user`) and
  `repository()` (`GET /repos/<owner>/<name>` with `permissions`). They
  are GitHub-only and not on `StorageDriver`; the contract suite is
  untouched.
- `storage/test/fake-github.ts`: serve `GET /user` (`{ login }`) and
  `GET /repos/<owner>/<name>` (`{ full_name, default_branch, permissions:
  { pull, push } }`), plus two switches: `readOnly` makes `push: false`,
  and `canCreate = false` makes `POST /user/repos` a 403. Both added to
  the P1-13b list of assumptions to confirm against real GitHub.

**Tests.** `app/test/onboarding.test.ts` over the fake: a fresh repository
ends as exactly the template file list with two commits (`Initial
commit`, `Scaffold: template`), validates with zero issues, has Set 1 at
`ps-g8xw`, and needs no index write; a wrong token, a read-only token on
an existing repository, and a refused creation each produce their
sentence. `storage/test/github.test.ts` covers the two new methods.

**Not in block 1.** Any screen or route (block 2), the privacy and token-
swap steps (block 2), the token swap's single-repo re-validation (block
2 reuses `validateToken` with `owner`/`name`), Settings changes, and the
real-GitHub confirmation of the fake's new endpoints (P1-13b).

## Gaps noted (2026-09-09)

Found while orienting for Phase 3. Those marked *block 1* are inside
its scope because its "done when" cannot be met without them; the rest
are handled with the deferred items when Phase 3 is finished.

- [ ] **G1. The fake GitHub has no `GET /user`** and no way to model an
  under-privileged token. *Block 1.*
- [ ] **G2. `SCAFFOLD` misses the template's dot-files.** The glob is
  `**/*.md`, so `.gitignore`, `.gitkeep` keepers, and `.claude/commands/`
  are absent; connect-existing never noticed because it writes its own
  keepers and offers only markdown. *Block 1.*
- [ ] **G3. Cross-package test import.** App unit tests reach only
  `@gnomon/storage`'s public entry; block 1's test imports
  `storage/test/fake-github.ts` by relative path. Decide later whether
  to publish it as a `@gnomon/storage/testing` subpath. *After Phase 3.*
- [ ] **G4. `Scaffold:` is not in schema §7's commit vocabulary** but
  connect-existing has used it since Phase 1 and block 1 uses it for the
  template commit. Add it to the schema (and CLAUDE.md's list) or rename.
  *After Phase 3; schema change, needs the maintainer.*
- [ ] **G5. `describeError`'s auth sentence assumes Settings** ("on this
  repository"); onboarding needs different wording per step. Block 1
  gives `validateToken` its own sentences; the audit is block 3.
- [ ] **G6. `#/onboarding` renders the "later block" placeholder** and the
  shell launches to Capture when nothing is connected. That is block 2's
  work, listed here so nobody reads it as a bug.

## Deferred

Carried over unchanged from Phase 1 and Phase 2; each needs something
from the maintainer or a later phase. The live human test at the end of
this phase is the natural moment for the first three and P2-live.

- [ ] **P1-13b. `GitHubDriver` against real GitHub** (S) — needs a
  disposable fine-grained token (Contents read/write) and a scratch
  private repo. Done when the storage contract suite passes against it on
  a nightly schedule (spec §18). The fake's assumptions to confirm: a
  `POST /git/trees` entry with `sha: null` for a path absent from
  `base_tree` is a 422; the ref PATCH with `force: false` returns 422 on a
  non-fast-forward; `/compare` statuses are `added`/`modified`/`removed`
  with `patch` for text; blob `size` is present in recursive tree
  listings; `auto_init` exposes the ref within the driver's ten retries.
  Since Phase 2, the fake also serves onboarding (`POST /user/repos`), so
  the real run should cover create-from-template too.
- [ ] **P1-18b. Pages deploy** (S) — deferred until the live human test.
  Pages does not publish from a private repository on a Free plan: make
  `gdfekaris/gnomon` public, deploy to a separate public repository, use
  another static host, or confirm a paid plan; then enable Pages with
  Source = GitHub Actions and add the `actions/deploy-pages` job. The base
  path is settled: the site is `gdfekaris.github.io/gnomon/` and CI already
  builds with `VITE_BASE=/gnomon/`. Then check the iPhone install and the
  update toast on a real device.
- [ ] **P1-19. Publish `gnomon-cli`** (S) — on hold with 18b. `gnomon-cli`
  was free on npm on 2026-09-07. Needs an npm account with 2FA, then a
  local `npm login` for the first release or a granular publish token as a
  repository secret for a tag-triggered workflow. Before the first
  publish: add `repository` and a package README, set a real version,
  dry-run the tarball (block 6 does this part). A published package is
  public even though this repository is private; it contains only the
  built CLI.
- [ ] **P2-live. Live provider calls** — Anthropic and OpenRouter are
  wired and tested against fakes; only the maintainer's real keys can
  exercise them, from the Reason and Inbox screens. Part of the live
  human test.
- [ ] **P2-tokens. Token-count refinement** — spec §8.2's optional
  `POST /v1/messages/count_tokens` when the estimate is within 10% of the
  budget. Deliberately left out; the estimate is conservative and the bar
  is a bar, not a number. Revisit only if real use shows budgets being
  wrong.
- [ ] **P4-notes. For Phase 4 (encryption)** — the encrypting driver's
  `compare` patches describe stored bytes, so a body change on an
  encrypted brain shows as a ciphertext line in the review view;
  recomputing plaintext patches needs blob reads by SHA at both commits.
  Attachment encryption is an open decision (spec §20.6). Enabling,
  disabling, and passphrase change are single commits per spec §6.4.

## Decisions made so far

- **A mock provider ships** (Phase 2). Spec §17's flows assume one, and it
  lets the demo brain file and reason without a key.
- **Editing a pending filing's metadata makes it yours** (Phase 2, block
  6): the source becomes `human`, so ratify then refuses it as changed.
- **Accepting a principle proposal never writes the principle** (schema
  §4.7): the decision is one commit, the editor opens pre-filled, and the
  draft body links back to the proposal so the screen can show what it
  became.

## Notes for whoever resumes

- Conventions still hold: every operation is one `CommitBatch` through
  `BrainService.commit`, which runs `validateBatch` first; index files
  ride along via `withIndexWrites`; `nowUtc()` for timestamps; `$state`
  proxies must be `$state.snapshot`-ed before IndexedDB; prompts are
  TypeScript constants in `core/assembly/prompts/`.
- Playwright runs from `packages/app` (`npm run e2e -w packages/app`),
  never from the repo root. The `pwa` project builds into `dist-preview/`.
- The demo brain accepts `#/settings?demo-omit=a,b` to drop paths. Its
  git history is one seed commit, so the fixture's own pending filing
  does not appear in the Inbox's filing list.
- Proposal ids and timestamps use the real clock; tests that assert ids
  must be date-agnostic.
- Source slugs are the author's surname plus the first four words of the
  title fragment (`unknown-the-only-way-to`).
