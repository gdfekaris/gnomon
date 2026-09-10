# gnomon

Monorepo for **Gnomon**, a portable, model-agnostic second brain: a folder
of plain markdown in your own git repo, plus a bring-your-own-AI companion
PWA and a small desktop CLI. Phases 1 to 3 are built: the brain format and
library, the storage and provider drivers, the CLI, and the app with
onboarding, capture, browse, sets, editors, reasoning, filing review,
proposals, and a late-1980s GUI in three skins. Version 0.1.0.

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

Phases 1 to 3 of the technical spec (§19) are done; `docs/phase-3-tracker.md`
carries the remaining deferred items (the real-GitHub contract run, the
Pages deploy, the npm publish, live provider calls) and the gaps noted
along the way. `docs/smoke-checklist.md` is the live human test that
precedes the first release. Phase 4 is client-side encryption.
