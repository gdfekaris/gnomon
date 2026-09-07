# gnomon

Monorepo for **Gnomon**, a portable, model-agnostic second brain: a folder
of plain markdown in your own git repo, plus a bring-your-own-AI companion
PWA and a small desktop CLI. Design documents are aligned and the code is
scaffolded; no feature is implemented yet.

## Layout

| path | what it is |
|---|---|
| `docs/gnomon-proposal.md` | what and why: users, stories, architecture, delivery plan (v0.3) |
| `docs/gnomon-schema.md` | the on-disk brain format; the contract every tool shares (v0.2) |
| `docs/gnomon-technical-spec.md` | how the app, shared library, and CLI are built (v0.2) |
| `docs/alignment-review.md` | the decisions that aligned the three, with rationale |
| `template/` | the canonical empty brain: AGENTS.md, Set 1, templates, commands, empty indexes |
| `packages/core` | `@gnomon/core`: schema types, links, index, sets, proposals, filing, assembly, crypto. Framework-free. |
| `packages/storage` | `@gnomon/storage`: `StorageDriver`, GitHub, Memory, Encrypting drivers |
| `packages/providers` | `@gnomon/providers`: `ProviderDriver`, Anthropic, OpenRouter |
| `packages/app` | the Svelte 5 + Vite PWA |
| `packages/cli` | published as `gnomon-cli`, binary `gnomon` |
| `tools/gnomon-check.py` | Python reference implementation of `gnomon validate` and `gnomon index` (needs PyYAML); the CLI is tested against it |

## Working on it

```
npx npm@latest install      # npm 11.1 (bundled with Node 23) crashes on this tree; any npm >= 12 works
npm run typecheck
npm test                    # python3 + pyyaml for the index cross-check
VITE_BASE=/gnomon/ npm run build
npm run build:cli && npm run validate:template && npm run validate:fixture
npm run dev -w packages/app
```

Node 20 or newer. CI runs the same steps on every push.

## Where things stand

1. ~~Fill the Decision lines in `alignment-review.md`.~~ Done 2026-09-05.
2. ~~Rewrite the three documents and `template/` so they agree.~~ Done 2026-09-05.
3. ~~Migrate geo-brain-2 by hand into the new format.~~ Done 2026-09-05.
4. ~~Scaffold the monorepo described in the technical spec §3.~~ Done 2026-09-05.
5. Phase 1 (technical spec §19): `core` schema parse/serialize and validation, index generation matching `template/`, the GitHub and Memory drivers, `gnomon-cli` validate/index/status, the app's Capture, Browse, and Settings screens.
