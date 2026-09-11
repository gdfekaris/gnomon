# Phase 3 tracker

Working document for Phase 3 (technical spec §19, row 3; proposal §8):
onboarding for other people and polish. One block at a time, in this
order. Each block ends in a green commit with its own tests and a "done
when" you can check without reading code. Tick a block when it is
committed and CI is green. Delete this file when Phase 3 is complete and
write `docs/phase-4-tracker.md` from a fresh breakdown.

Started 2026-09-08. All six blocks were ticked by 2026-09-10 (version
0.1.0, CI green at da6bcf8). **Resume with the end-of-phase pass:** the
Deferred list and the open gaps (G3, G4) below, handled together per the
maintainer's decision of 2026-09-09; then delete this file and write
`docs/phase-4-tracker.md`.

## Blocks

Blocks 1–6 are the app; block 1 is library-shaped and tested over the fake
GitHub, the rest end in Playwright flows over the demo brain or a mocked
GitHub. Block 4 is the design pass, taken up now that every screen exists.

- [x] **1. Onboarding service** (M) — spec §12 steps 2–4, US-14, US-15.
  `services/onboarding.ts`: `validateToken` (`GET /user` and a permission
  probe, mapping a rejected or under-privileged token to a sentence);
  `createFromTemplate` (`createRepo` with `auto_init`, then one commit on
  top that writes the bundled `template/` tree from `lib/scaffold.ts`,
  Set 1 at `ps-g8xw` included, and deletes the auto-generated README;
  nothing generated per user); connect-existing reuses block P1-17's
  `inspectBrain`. Done when, over `storage/test/fake-github.ts`, a fresh
  repository ends up as the template with Set 1 and both index files in
  one commit and validates clean, and a bad token is explained.
- [x] **2. Onboarding screens** (L) — spec §12 steps 1, 5, 6; US-14,
  US-16; spec §11 iOS steps. `routes/Onboarding.svelte` on `#/onboarding`,
  the first screen when no brain is connected: the token walkthrough
  with annotated steps (classic and fine-grained differ), create-from-
  template or connect-existing, the who-can-see-what privacy screen
  (GitHub as host; the chosen provider during reasoning; nobody else),
  the optional swap to a single-repo token, and Add to Home Screen steps
  for iPhone. Done when a flow over a mocked GitHub walks from nothing to
  a connected, valid brain and lands on Capture, and a second flow
  connects an existing one showing its validation results.
- [x] **3. Non-technical polish** (M) — proposal §8 Phase 3, US-14. First-
  run empty states on every screen; plain-language errors everywhere
  (audit `describeError` callers); a "what next" nudge on Capture and
  Browse mirroring the CLI's status line (unfiled captures, filings
  awaiting review, open proposals, stale indexes); loading and stale
  states reviewed on a slow connection. Done when a flow over a fresh
  template brain sees the nudges and empty states and a flow over the
  fixture sees the right nudge at each step of the loop.
- [x] **4. The design pass** (L) — spec §1 ("a separate design pass"),
  proposal §8 Phase 3 polish. A mobile-first visual system across every
  screen: Capture, Browse and the file view, Sets, the editors, Reason,
  Inbox, Proposals, Settings, and the onboarding screens from block 2.
  First a design canvas of the screens for the maintainer to review and
  adjust; then the styling lands as shared tokens and components, real
  icons replace the `tools/make-icons.mjs` placeholders, and dark mode is
  checked. Done when the maintainer has approved the canvas, every screen
  uses the shared system, the manifest icons are the real ones, and every
  existing Playwright flow still passes unchanged.
- [x] **5. Save as proposal** (S) — carried from Phase 2 (not in the spec's
  row; kept by the maintainer 2026-09-08). A Relate answer's proposal
  section can be saved as a `curated: human` proposal file (schema §4.7)
  targeting the selected set, one `Add proposal:` commit, with the kind
  and target chosen in a small form pre-filled from the answer. Done when
  a flow relates a text with the demo model and saves its proposal, and
  the Proposals screen lists it as open and yours.
- [x] **6. Release readiness** (S) — spec §18, proposal §10. The CLI
  package gets `repository`, a README, and version `0.1.0`; the app shows
  its version (already in Settings) and the two match; a smoke checklist
  for the live human test (install on iPhone, capture with a photo,
  connect an existing brain, file and ratify, reason from two sets,
  desktop round trip through Claude Code with `npx gnomon-cli validate`).
  Done when `npm pack --dry-run` for the CLI lists only `dist/`, the
  README, and `package.json`, and the checklist is in `docs/`.

## Gaps noted (2026-09-09)

Found while orienting for Phase 3. Those marked *block 1* are inside
its scope because its "done when" cannot be met without them; the rest
are handled with the deferred items when Phase 3 is finished.

- [x] **G1. The fake GitHub has no `GET /user`** and no way to model an
  under-privileged token. *Done in block 1:* `GET /user` with an optional
  `X-OAuth-Scopes` header, `GET /repos/<owner>/<name>` with `permissions`,
  and the `readOnly`, `canCreate`, and `scopes` switches.
- [x] **G2. `SCAFFOLD` misses the template's dot-files.** The glob was
  `**/*.md`, so `.gitignore`, `.gitkeep` keepers, and `.claude/commands/`
  were absent; connect-existing never noticed because it writes its own
  keepers and offers only markdown. *Done in block 1:* the glob is
  `**/*` with `exhaustive: true`, and a test holds it equal to the tree
  on disk.
- [x] **G3. Cross-package test import.** App unit tests reach only
  `@gnomon/storage`'s public entry; block 1's test imports
  `storage/test/fake-github.ts` by relative path. *Done 2026-09-10:*
  `@gnomon/storage/testing` (`storage/test/testing.ts`) exports
  `FakeGitHub`, `FIXTURE`, and `readBrainBytes`; the app's tests and the
  Playwright bridge import it by name and no relative cross-package
  import remains.
- [x] **G4. `Scaffold:` is not in schema §7's commit vocabulary** but
  connect-existing has used it since Phase 1 and block 1 uses it for the
  template commit; block 5 adds `Add proposal: <id>` for a proposal the
  curator saves from a Relate answer, also unlisted. *Done 2026-09-10,
  both names kept (maintainer's call):* `Scaffold: template` in §7.1,
  `Scaffold: <path>` in §7.8, and a new §7.11 "Save a proposal" with
  `Add proposal: P-<date>-<nnn>`; CLAUDE.md's list updated. `AGENTS.md`
  is unchanged because agents use neither.
- [x] **G5. `describeError`'s auth sentence assumes Settings** ("on this
  repository"); onboarding needs different wording per step. Block 1
  gave `validateToken` its own sentences. *Done in block 3:*
  `describeError` moved to `services/errors.ts`, covers every storage,
  provider, and core error class with one sentence each, and every
  screen and service routes through it; the auth sentence points at
  Settings from wherever it appears.
- [x] **G6. `#/onboarding` renders the "later block" placeholder** and the
  shell launches to Capture when nothing is connected. *Done in block 2:*
  the default route redirects to `#/onboarding` once launch has settled
  with nothing to reconnect; the flow ends on Capture.

## Deferred

Carried over unchanged from Phase 1 and Phase 2; each needs something
from the maintainer or a later phase. The live human test at the end of
this phase is the natural moment for the first three and P2-live.

- [x] **P1-13b. `GitHubDriver` against real GitHub** (S) — *done
  2026-09-11, first fully green run 34556068934 (18 of 18, four
  minutes):* `.github/workflows/nightly.yml` (04:17 UTC daily and on
  demand) runs `storage/test/github-live.test.ts`, which is skipped unless
  `GNOMON_TEST_TOKEN` and `GNOMON_TEST_REPO` are set. It resets
  `gdfekaris/gnomon-scratch` to the reference fixture before each contract
  test, runs the whole driver contract, then checks the fake's assumptions
  directly: `sha: null` for a path absent from `base_tree` is a 422; a
  non-fast-forward ref PATCH with `force: false` is a 422; `compare`
  statuses and text patches; blob `size` in recursive listings; `GET
  /user` has no `X-OAuth-Scopes` for a fine-grained token; `permissions.push`
  true; `auto_init` exposes the ref within the retries; the template lands
  in one commit on top of `Initial commit`; a name collision is a generic
  422. Each run seeds the scratch repository with a root commit (no
  parents) and force-moves main to it before every test, so history
  assertions see only that run's commits. Temporary repositories are
  `gnomon-scratch-<run id>` and are deleted
  at the end (leftovers from a dead run too). The first run (34541866671)
  found two things the fake never modelled, both fixed in the driver and
  now modelled by the fake's `staleRefReads` and `dropNext` switches:
  real GitHub can serve the previous sha from `GET /git/ref` for a moment
  after a successful `PATCH` (the driver now rereads until it sees its
  own update, `REF_SETTLE`), and a connection can drop mid-sequence (the
  driver retries every call except `POST /user/repos`, `RETRY_DELAYS_MS`,
  and names the cause). The second run (34542662832) hit the secondary
  rate limit: GitHub allows 80 content-generating requests a minute and
  500 an hour per token, and answers a 403 with `Retry-After`, which the
  driver had read as an AuthError. The driver now paces those requests
  under the per-minute cap (`CONTENT_RATE`, a constructor option so the
  fake-backed tests run unpaced) and maps that 403 to RateLimitError. One
  nightly run costs roughly 260 of the hourly 500, so never dispatch it
  twice within an hour. *Still unconfirmed, needing
  tokens we do not keep:* a Contents-read-only token reports `push: false`
  and gets 403 on writes; a fine-grained token without Administration gets
  a 403 (not 404 or 422) from `POST /user/repos`. The secret is a
  fine-grained token with a short expiry; when it lapses, the nightly
  fails on `GET /user` and a new token is the whole fix.
- [x] **P1-18b. Pages deploy** (S) — *done 2026-09-10:* the maintainer
  made `gdfekaris/gnomon` public; Pages is enabled with Source = GitHub
  Actions; `ci.yml` uploads `packages/app/dist` on every run and a
  `deploy` job (`actions/deploy-pages`) publishes it on pushes to main.
  The base path is `/gnomon/`; because the maintainer's user site has a
  custom domain, GitHub serves the app at `gdfekaris.com/gnomon/` and
  `gdfekaris.github.io/gnomon/` redirects there. "Enforce HTTPS" was off
  on the repository's Pages settings, so the maintainer's first iPhone
  visit was plain http (no service worker, no install); turned on
  2026-09-11 and http now 301s to https. Still to do on a real device, in
  the smoke checklist: the iPhone install and the update toast.
- [x] **P1-19. Publish `gnomon-cli`** (S) — *done 2026-09-11:*
  `gnomon-cli@0.1.0` is on npm, published from the maintainer's machine
  with a granular token (bypass-2FA; npm's second factor is WebAuthn and
  the maintainer is ordering a key). Verified cold: `npx gnomon-cli@0.1.0
  validate` over the fixture is clean. `.github/workflows/publish.yml`
  publishes on a `v<version>` tag through npm trusted publishing (OIDC,
  `id-token: write`, provenance; no token anywhere) after checking the
  tag equals the package version. *Maintainer step still open:* on
  npmjs.com, gnomon-cli → Settings → Trusted Publisher → GitHub Actions
  with owner `gdfekaris`, repository `gnomon`, workflow `publish.yml`, no
  environment, with "Allow npm publish" checked; then delete the
  granular token and its line in `~/.npmrc`. *Blocked 2026-09-11:* npm
  demands interactive two-factor (WebAuthn) to save a trusted publisher,
  and the maintainer has no key yet (one is ordered; an iPhone passkey
  would also do). Until then a tag run fails at the publish step, and a
  release is published from the maintainer's machine with the token, as
  0.1.0 was. Do not put the token in a CI secret. Release flow once
  configured: bump the version, commit, `git tag v0.1.1`, `git push --tags`.
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
- **Three skins, one switch** (Phase 3, block 4, 2026-09-09): the visual
  system is a late-1980s application GUI in three selectable skins,
  Monochrome (default), Gray bevel, and Four-color workbench, chosen in
  Settings → Appearance and persisted in prefs beside the theme. Every
  screen is composed from one component set; a skin is one token set
  (type, ink, paper, field, bevel or border, pattern, accent, state)
  plus those components. The canvas is `docs/design/` (working files;
  `canvas.json` lays them out) and the artifact linked from the session.
- **Create-from-template is not pre-probed** (Phase 3, block 1): GitHub
  has no endpoint that lists a fine-grained token's permissions, so a
  token that cannot create a repository is explained when `POST
  /user/repos` is refused, which leaves nothing behind. Classic tokens
  get an early warning from the scopes header. Block 2 returns to the
  token step with the sentence shown and the token kept.
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
  Since 2026-09-11 every flow also runs on WebKit as an iPhone 14
  (`webkit` and `pwa-webkit` projects; CI installs both browsers). The
  first WebKit run caught one thing: reading a chosen file fails under
  WebKit when offline, so Capture refuses an attachment before the read.
- The demo brain accepts `#/settings?demo-omit=a,b` to drop paths. Its
  git history is one seed commit, so the fixture's own pending filing
  does not appear in the Inbox's filing list.
- Proposal ids and timestamps use the real clock; tests that assert ids
  must be date-agnostic.
- Source slugs are the author's surname plus the first four words of the
  title fragment (`unknown-the-only-way-to`).
- Onboarding (block 2) is one component, `routes/Onboarding.svelte`, with
  a step state machine: welcome → token → check → privacy → swap (create
  path only) → install. The token walkthrough is text that names GitHub's
  exact labels, one list per token kind and intent; spec §12 step 1's
  annotated screenshots are not bundled and belong to the design pass
  (block 4) if wanted at all. The privacy text there and in Settings
  should be kept in step by hand.
- The "what next" nudge is `services/status.ts` (`brainStatus`, `nudge`)
  rendered by `components/Nudge.svelte` on Capture and Browse, in the
  CLI's order: refusals, unfiled, awaiting review, open proposals, stale
  indexes, all clear. Every app commit regenerates the indexes on the
  way, so "stale indexes" only ever follows a desktop session; the flow
  covers it with a demo that omits an index file. Screens show
  `components/ConnectionNotice.svelte` (not connected, loading by name,
  or a load error with a retry) whenever there is no snapshot; Capture
  keeps its form without a snapshot only while offline, so the queued
  capture of spec §14 still works.
- The visual system (block 4) lives in `packages/app/src/app.css`: three
  token sets under `:root[data-skin=mono|bevel|workbench]`, each with a
  dark redefinition under `data-theme=dark` and `prefers-color-scheme`,
  and shared element styles (window, title bar, `nav.tabs`, headings,
  buttons with `.primary` `.quiet` `.small`, fields, `.chip`, `[role=tab]`,
  `.state`/`.kind` badges, notices, `.panel`, `.bar`). Screens keep only
  layout rules in their own `<style>` and never a raw color; new UI uses
  the tokens. `applyTheme(theme, skin)` stamps both attributes; the skin
  is `prefs.skin`. Fonts are self-hosted latin subsets in
  `src/assets/fonts/` (OFL, see LICENSE.md there) so the PWA stays
  offline-capable inside its CSP. Icons: `components/Icon.svelte` for the
  16 px pixel set; `tools/make-icons.mjs` draws the manifest icons and
  `public/icons/icon.svg`. The design canvas working files stay in
  `docs/design/` (regenerate the seeded page from them if the canvas
  needs changing).
- Settings persistence is `services/persist.ts`: IndexedDB (idb-keyval,
  the spec §10.2 keys) with a localStorage mirror written first on every
  save and read when IndexedDB throws, hangs (four-second cap, three
  tries), or answers empty. Added 2026-09-11 after the maintainer's
  installed iPhone app relaunched on the Welcome screen every time; the
  cause on the device is not yet confirmed, so Settings → About now shows
  diagnostics (settings source, last storage failure, persistence, brain
  head or load error, service worker) and the Welcome screen names a
  storage failure. If the mirror alone proves reliable, dropping IndexedDB
  is a spec §10.2 change for the maintainer.
- Vite inlines assets under 4 KB as `data:` URLs in a production build,
  and the CSP's connect-src has no `data:`, so never `fetch` an imported
  `?url` asset: decode it when it is inline (the demo loader does). The
  dev server serves assets as files, so only a flow over the built app
  (the `pwa` Playwright project) catches this; the maintainer's iPhone did.
- `e2e/github-fake.ts` serves `storage/test/fake-github.ts` to the
  browser through `page.route`, so a flow can drive the real
  `GitHubDriver` end to end (create-from-template, commits, snapshot
  loads) without a hand-rolled mock. Flip the fake's switches
  (`canCreate`, `readOnly`, `scopes`) from the test between clicks; the
  returned bridge's `latencyMs` slows every answer for loading-state
  checks, and `gh.externalCommit` models another device for stale-state
  checks.
