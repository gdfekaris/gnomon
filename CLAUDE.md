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

## Where we are (2026-09-05)

Done: the three documents are aligned; `template/` is the canonical empty
brain and validates clean; the maintainer's real brain
(`~/Desktop/main/geo-brain-2`, branch `main`, no remote) is migrated to the
format; the monorepo is scaffolded and CI is green.

**Next: Phase 1 (spec §19), in this order.**
1. `packages/core/src/schema`: `parseFile` / `serializeFile` (spec §5) and
   `validateSnapshot` / `validateWrite` (spec §7.4, schema §9).
2. `packages/core/src/index`: `generateIndexes` (spec §7.2). Must reproduce
   `template/principles/_index.md` and `template/maps/_index.md` byte for
   byte; `tools/gnomon-check.py` is the reference implementation of the
   format and the migrated geo-brain-2 is a second golden case.
3. `packages/storage`: `MemoryDriver` (spec §6.3), then `GitHubDriver`
   (spec §6.2, REST writes + GraphQL batched reads).
4. `packages/cli`: real `validate`, `index`, `status` over a working tree.
5. `packages/app`: Capture, Browse, Settings screens (spec §10).

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
npm test
VITE_BASE=/gnomon/ npm run build
npm run validate:template      # python3 + pyyaml; tools/gnomon-check.py
python3 tools/gnomon-check.py ~/Desktop/main/geo-brain-2   # add --write to regenerate indexes
npm run dev -w packages/app
```

Commit as you go and push to `origin main` (private repo
`gdfekaris/gnomon-dev`). CI runs typecheck, test, template validation, and
the app build on every push; the Pages deploy and npm publish jobs are
still TODO in `.github/workflows/ci.yml`.
