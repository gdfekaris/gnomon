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
- `docs/alignment-review.md` — twenty decisions made 2026-09-05 with
  rationale. They are settled; do not reopen them without the user.
- `docs/phase-<n>-tracker.md` — the current phase's block list and progress
  (Phase 4 as of 2026-09-11).

## Where we are (2026-09-11)

Done: Phases 1, 2, and 3, each green in CI. Version 0.1.0. The app is
live at `https://gdfekaris.com/gnomon/` (GitHub Pages from main, HTTPS
enforced); `gnomon-cli@0.1.0` is on npm; the nightly runs the storage
contract against real GitHub and is green; every Playwright flow runs on
Chromium and on WebKit as an iPhone. The maintainer's live iPhone test
(install, create a brain, capture, file, ratify, editors) is done and its
findings are fixed; what it left open is carried in the Phase 4 tracker.

**Next: Phase 4, `docs/phase-4-tracker.md`**, block 1 (the passphrase
keyring). Encryption was designed in spec §6.4 and the body format,
wrapper driver, and keyring interface already exist; Phase 4 wires a real
keyring, the flows, the CLI commands, decides attachment encryption, adds
a second storage driver, and documents local models. The tracker's
"Carried from Phase 3" list holds the maintainer's items (npm trusted
publishing once a security key arrives, the rest of the smoke checklist).
When the pass is done: delete the tracker, break down Phase 5, and write
`docs/phase-5-tracker.md`; that is the working process for every phase.

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
  proposal:`, `Scaffold:`, `Index`, plus the set procedures' own messages.
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
- Files never move (schema §1 rule 1). A principle changes set by copy
  then delete, never by a path change; the app offers exactly that.
- Never `fetch` an imported `?url` asset: a production build inlines small
  ones as `data:` URLs and the CSP's connect-src has no `data:`. Decode
  inline ones (see the demo loader). Only the built Playwright projects
  (`pwa`, `pwa-webkit`) can catch this.
- Errors render next to the control that failed, never at the foot of a
  screen. Settings → About carries diagnostics; ask for that line before
  guessing at a device problem.
- Styling: the app is a late-1980s GUI in three skins (`data-skin` on
  `<html>`, Monochrome default), all tokens and shared element styles in
  `packages/app/src/app.css`. Screens carry layout only, never a raw
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
