# Gnomon — working notes for Claude Code

Gnomon is a portable, model-agnostic second brain: a folder of plain markdown
in the user's own git repo, plus a bring-your-own-AI companion PWA and a
small desktop CLI. This repo is the monorepo.

## Read first

- `docs/gnomon-schema.md` (v0.2) — the on-disk brain format. Normative; when
  anything disagrees with it, the schema wins.
- `docs/gnomon-technical-spec.md` (v0.2) — how the code is built. Module
  boundaries, interfaces, and algorithms are defined there; implement to it.
- `docs/gnomon-proposal.md` (v0.3) — what and why.
- `docs/security.md` — the tamper-evidence claim, threat model, and
  assumptions (Phase 5); Schema §11 is its format. Any change to sealing
  keeps the three in agreement.
- `docs/alignment-review.md` — twenty decisions made 2026-09-05 with
  rationale. They are settled; do not reopen them without the user.
- `docs/phase-<n>-tracker.md` — the current phase's block list and progress
  (Phase 4 as of 2026-09-11).

## Where we are (2026-10-09)

Done: Phases 1, 2, and 3. Version 0.2.0; the app is live at
`https://gdfekaris.com/gnomon/` (GitHub Pages from main), `gnomon-cli@0.2.0`
is on npm (a release is a pushed `vX.Y.Z` tag, trusted publishing), the
nightly is green, and every Playwright flow runs on Chromium and on WebKit
as an iPhone.

Phase 4 (`docs/phase-4-tracker.md`): blocks 1 to 5 done (encryption), 6
deferred (a second storage driver), 7 and 8 (local models, the custom
endpoint) built and waiting on the maintainer's own test. It closes after
that: delete the tracker, write `docs/phase-5-tracker.md`.

**Current work: tamper-evident captures, Phase 5's first feature.** The
plan and its block list are `docs/tamper-evidence-proposal.md` §8 (the
working tracker until the Phase 5 tracker exists); the claim and threat
model are `docs/security.md`; the format is Schema §11 and §7.20; the code
plan is Technical Specification §6.5. Decided by the maintainer: only what
the user captures is protected (metadata is not), the desktop signs with
a YubiKey touch, agents run in a separate OS account with a brain-only
deploy key, a 24-word recovery phrase is the root, and decisions D1 to D6
as recommended.

- Done: A1 (one commit vocabulary; `core/test/vocabulary.test.ts`), S1
  (the docs), S2 (`packages/core/src/seal`, the attack table T1 to T22,
  FIDO checked against OpenSSH), S3 (keys on the phone; the maintainer
  sealed brain-1 from the iPhone with an Ed25519 key on 2026-10-06).
- Built, not ticked: **S4** (seals on every capture, verdicts, banner,
  ratify and filing rules, Reason without broken passages, "Seal existing
  captures"; `5f2b87e`, CI green). Waiting on the maintainer's check on
  brain-1: Seal existing captures, the "sealed since" marks, a new
  capture marked "sealed", no red banner. Ask for that result first.
- Next: **S5**, the CLI (`gnomon keys request|trust`, `capture`, `seal`,
  `verify`) with the YubiKey; then S6 (the agent account, the
  maintainer's setup), S7 (independent Python verifier), S8 (the commit
  audit as hygiene, Appendix A), S9 (outside review), S10 (optional signed
  releases). `security.md`'s status line says the claim does not hold
  until S6; keep that line true as blocks land.

## Conventions

- TypeScript strict, pinned to 5.9 (spec says 5.x; TS 7 exists; upgrading
  is a deliberate decision). Svelte 5 runes, Vite 8, Vitest 5.
- `packages/core` has zero DOM or Node runtime dependencies. Its tsconfig
  sets `types: []` to enforce it.
- Every brain operation is one commit through `StorageDriver.commit` with
  `expectedHead`. The app never moves a file. Agents never write `human`
  files except the two clerical inbox fields in a filing commit.
- Commit messages in a brain are fixed vocabulary (schema §7): `Capture:`,
  `File:`, `Ratify:`, `Reject:`, `Decide:`, `Add principle:`, `Add
  proposal:`, `Derive:`, `Relate:`, `Keep:`, `Decline:`, `Reserve
  principle:`, `Place principle:`, `Delete principle:`, `Reorder
  principles:`, `Edit principle:`, `Edit source:`, `Edit notes:`,
  `Clear:`, `Encrypt:`, `Decrypt:`, `Change passphrase`, `Scaffold:`,
  `Index`, `Create principle set:`, `Update principle set:`, `Delete
  principle set:`, `Reorder principle sets`. A new message goes into
  schema §7 first; `core/test/vocabulary.test.ts` fails otherwise.
- Other repositories are off limits. Agents touch only `gdfekaris/gnomon`
  and the nightly's scratch repositories (`gnomon-scratch`, and the
  `gnomon-scratch-<run>` ones it creates and deletes itself). Never read,
  write, create, delete, or change settings on any other repository, even
  when the credential at hand allows it; the local `gh` login and the
  `GNOMON_TEST_TOKEN` secret both reach every repo the maintainer owns.
  Settings changes on this repo (visibility, Pages, secrets, branch rules)
  happen only when the maintainer asks for that change in the current
  session. The maintainer's own brain, `~/Desktop/main/geo-brain-2`, has no
  remote; never push it anywhere.
- The custom model endpoint (`VITE_CUSTOM_ENDPOINT`, repository variable
  `GNOMON_CUSTOM_ENDPOINT`) is opt-in for forks and self-hosters. Never set
  it on `gdfekaris/gnomon`: the app at gdfekaris.com stays strict.
- Files never move (schema §1 rule 1). A principle changes set by copy
  then delete, never by a path change; the app offers exactly that.
- Never `fetch` an imported `?url` asset: a production build inlines small
  ones as `data:` URLs and the CSP's connect-src has no `data:`. Decode
  inline ones (see the demo loader). Only the built Playwright projects
  (`pwa`, `pwa-webkit`) can catch this.
- Errors render next to the control that failed, never at the foot of a
  screen. Settings → About carries diagnostics; ask for that line before
  guessing at a device problem.
- Styling: the app is a late-1980s GUI in four skins, each light or dark
  (`data-skin` and `data-theme` on `<html>`, one Look picker, Monochrome
  dark default, the OS never consulted), all tokens and shared element
  styles in `packages/app/src/app.css`. Screens carry layout only, never a raw
  color; use the tokens (`--ink`, `--paper`, `--edge`, `--raise`, ...) and
  the shared classes (`.primary`, `.chip`, `.panel`, `.state`, notices).

## Commands

```
npx npm@latest install         # npm 11.1 (bundled with Node 23) crashes on this tree
npm run typecheck
npm test                       # the index cross-check test needs python3 + pyyaml
VITE_BASE=/gnomon/ npm run build
npm run build:cli              # bundles packages/cli/dist/gnomon.js
npm run validate:template      # the CLI over template/ (build:cli first)
npm run validate:fixture       # the CLI over packages/core/fixtures/brain
node packages/cli/dist/gnomon.js validate ~/Desktop/main/geo-brain-2   # or index, status
npm run validate:reference     # the Python reference checker, tools/gnomon-check.py
npm run dev -w packages/app
npx playwright install chromium webkit && npm run e2e -w packages/app   # app flows, Chromium and WebKit-as-iPhone
```

Commit as you go and push to `origin main` (public repo
`gdfekaris/gnomon`, renamed from `gnomon-dev` on 2026-09-07 and made public
on 2026-09-10; never create a new repo under the old name or the redirect
breaks). CI runs typecheck, unit tests, CLI validation of the template and
fixture, the app build, and the Playwright flows on every push, then
deploys the app to GitHub Pages from main (served at
`gdfekaris.com/gnomon/`). A `v<version>` tag runs `publish.yml`, which
publishes `gnomon-cli` through npm trusted publishing (no token stored);
bump `packages/cli/package.json` first, the tag must match it. The nightly
(`nightly.yml`) runs the storage contract against real GitHub.
