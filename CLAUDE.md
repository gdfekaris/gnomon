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
  (Phase 3 as of 2026-09-08).

## Where we are (2026-09-10)

Done: Phases 1, 2, and all six blocks of Phase 3 (spec §19), each green in
CI. Version 0.1.0. On top of the Phase 1 and 2 list: onboarding (token
walkthrough, create-from-template, connect-existing, privacy, token swap,
install steps), the what-next nudge and plain-language errors everywhere,
the design pass (a late-1980s application GUI in three selectable skins,
Monochrome default; tokens in `packages/app/src/app.css`; the design
canvas working files in `docs/design/`), save-as-proposal from a Relate
answer, the CLI README and `--version`, and `docs/smoke-checklist.md`.

**Next: the end-of-phase pass in `docs/phase-3-tracker.md`.** The six
blocks are ticked; what remains there is the "Deferred" list (real-GitHub
contract run, Pages deploy, npm publish, live provider calls, token-count
refinement, Phase 4 notes) and the open gaps G3 and G4. The maintainer
decided (2026-09-09) that these are handled together after the blocks,
not in between. Several need the maintainer: a disposable token and
scratch repo, a Pages hosting decision, an npm account, provider keys. G3
and G4 can be done alone; G4 edits the schema's commit vocabulary, so
confirm the wording first. When that pass is done: delete the tracker,
break down Phase 4 (encryption, spec §6.4), and write
`docs/phase-4-tracker.md`; that is the working process for every phase.

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
npx playwright install chromium && npm run e2e -w packages/app   # app flows over the demo brain
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
