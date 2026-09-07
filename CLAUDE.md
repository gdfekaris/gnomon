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
- `docs/phase-<n>-tracker.md` — the current phase's block list and progress.

## Where we are (2026-09-06)

Done: the three documents are aligned; `template/` is the canonical empty
brain and validates clean; the maintainer's real brain
(`~/Desktop/main/geo-brain-2`, branch `main`, no remote) is migrated to the
format; the monorepo is scaffolded and CI is green.

**Next: Phase 1 (spec §19).** Progress lives in `docs/phase-1-tracker.md`:
nineteen blocks in dependency order, each with a "done when". Resume by
finding the first unticked block. Tick a block in the same commit that
completes it. When the phase is done, delete the tracker, break down the
next phase, and write `docs/phase-2-tracker.md`; that is the working
process for every phase.

## Conventions

- TypeScript strict, pinned to 5.9 (spec says 5.x; TS 7 exists; upgrading
  is a deliberate decision). Svelte 5 runes, Vite 8, Vitest 5.
- `packages/core` has zero DOM or Node runtime dependencies. Its tsconfig
  sets `types: []` to enforce it.
- Every brain operation is one commit through `StorageDriver.commit` with
  `expectedHead`. The app never moves a file. Agents never write `human`
  files except the two clerical inbox fields in a filing commit.
- Commit messages in a brain are fixed vocabulary (schema §7): `Capture:`,
  `File:`, `Ratify:`, `Reject:`, `Decide:`, `Add principle:`, `Index`.

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

Commit as you go and push to `origin main` (private repo
`gdfekaris/gnomon`, renamed from `gnomon-dev` on 2026-09-07; never create a
new repo under the old name or the redirect breaks). CI runs typecheck, unit tests, CLI validation of the
template and fixture, the app build, and the Playwright flows on every push; the Pages deploy and npm publish jobs are
still TODO in `.github/workflows/ci.yml`.
