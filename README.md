# gnomon

Monorepo for **Gnomon**, a portable, model-agnostic second brain: a folder
of plain markdown in your own git repo, plus a bring-your-own-AI companion
PWA and a small desktop CLI. Phases 1 to 3 are built: the brain format and
library, the storage and provider drivers, the CLI, and the app with
onboarding, capture, browse, sets, editors, reasoning, filing review,
proposals, and a late-1980s GUI in four skins. Phase 4 has added
optional client-side encryption, in the app and in the CLI. Version 0.2.0.

## Who it's for

Gnomon is built by one person for their own use, and shared for anyone who
thinks the same way. It suits a curator: someone who wants every captured
passage kept word for word, every AI suggestion reviewed before it counts,
their own principles written in their own words and ranked, and the whole
brain in a git repository they own, readable without the app. That means
steps: a capture waits in the inbox, a filing waits for your review, a
suggestion waits for your decision. If that sounds like too much ceremony
for what you want, it probably is, and a lighter notes app will serve you
better. To see for yourself without an account, open the app at
`https://gdfekaris.com/gnomon/` and choose "Try the demo brain."

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

## Your own model (for forks and self-hosters)

The app can reason with a model you run yourself (Ollama, or anything with
an OpenAI-style API), but only in a copy of the app you build with the
feature switched on. It is **off by default**, and it stays off in the app
at `gdfekaris.com/gnomon/`: turning it on adds your endpoint to the
address list the app's security policy allows, so it is a choice for
whoever deploys a copy. To opt in:

- **A fork deployed to GitHub Pages:** in your fork, Settings → Secrets
  and variables → Actions → Variables, add `GNOMON_CUSTOM_ENDPOINT` with
  either `self` (the model is served from the same server as the app) or
  an https origin such as `https://model.example.com`. Enable Pages with
  "GitHub Actions" as the source, then push or re-run the `ci` workflow.
- **A build by hand:**
  `VITE_CUSTOM_ENDPOINT=self VITE_BASE=/ npm run build`, then serve
  `packages/app/dist`.

Then Settings → AI providers → "Your own model" takes the endpoint's
address, an optional key, and its context window, and Reason and Inbox
offer "Your model". Settings → About says what a build allows. Recipes,
including one server for both the app and the model:
`docs/local-models.md`.

## Where things stand

Phases 1 to 3 of the technical spec (§19) are done: the app is live at
`https://gdfekaris.com/gnomon/`, `gnomon-cli` 0.1.0 is on npm, and a
nightly runs the storage contract against real GitHub. Phase 4 (client-
side encryption, a second storage driver, local-model documentation) is
in progress; `docs/phase-4-tracker.md` is its block list and carries the
items left open from Phase 3. `docs/local-models.md` sets up a desktop session with a local model, so
no AI provider sees the brain. `docs/moving-your-brain.md` says how to move a brain to
another git host or your own server, and what follows it.
`docs/smoke-checklist.md` is the live human
test on a real phone.
