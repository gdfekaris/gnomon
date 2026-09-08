# Phase 2 tracker

Working document for Phase 2 (technical spec §19, row 2): the full loop.
One block at a time, in this order. Each block ends in a green commit with
its own tests and a "done when" you can check without reading code. Tick a
block when it is committed and CI is green. Delete this file when Phase 2
is complete and write `docs/phase-3-tracker.md` from a fresh breakdown.

Started 2026-09-07. Resume a session by finding the first unticked block.

## Blocks

Blocks 1–4 are library work, testable offline. Blocks 5–9 are screens; each
ends in a Playwright flow over the demo brain with the mock provider, so no
API key is needed. Real keys matter only for trying the Reason screen live.

- [x] **1. Assembly** (M) — spec §8.2–§8.4, schema §8. `core/assembly`:
  `assemble(snapshot, task, selectedSets, input, budgetTokens)` returning
  `AssemblyResult` (`included`, `excluded`, `tokensUsed`, or the
  `SETS_EXCEED_BUDGET` / `INPUT_EXCEEDS_BUDGET` errors); the four system
  prompts in `assembly/prompts/*.md` (Task A, B, D, free-form) carrying the
  curation rules, citation instruction, precedence rule, and the multi-set
  rules; `estimateTokens` (moves here from providers, which re-exports);
  `parseCitations(text, snapshot)` for `[[path]]` refs (§8.4). Done when
  synthetic brains at several budgets produce the §8.3 output byte for
  byte in tests: sets are never truncated, grounding passages fill in
  order of first reference, overflow lands under "Passages referenced but
  not included", Task B appends the new text last, `setDescriptionPlacement`
  flips the `_set.md` body between context and system prompt. *Done
  2026-09-07. Prompts are TypeScript constants in `assembly/prompts/`
  (Task type: `reason` | `relate` | `compare` | `free`). Decisions beyond
  the spec text: the input is reserved before passages fill, so passages
  can never crowd out the question or text (Task A gets `## Question`,
  free-form `## Message`, Task D none); the "not included" section counts
  as mandatory material, at minimum one title line per passage, so
  `SETS_EXCEED_BUDGET` reports the true floor and a successful assembly
  never exceeds the budget; that section carries notes bodies only when
  they fit; an `EMPTY_SET` error refuses a selected set with no
  principles (AGENTS.md: reasoning without premises). Passages sit under
  a `## Grounding passages` heading. `parseCitations` wraps
  `parseLinks`. `estimateTokens` lives here; providers re-exports it.*
- [x] **2. Provider drivers** (L) — spec §8.1. `providers`: a `MockProvider`
  that replays scripted responses (for tests and the demo brain; not in
  the spec but assumed by §17); `AnthropicDriver` (`/v1/messages` with the
  browser CORS header, SSE streaming, `listModels` from `/v1/models` with a
  bundled context-window table and a conservative default); `OpenRouterDriver`
  (`/api/v1/chat/completions`, `Authorization: Bearer`, `HTTP-Referer` and
  `X-Title`, SSE, `listModels` with `context_length`). Done when both real
  drivers pass one shared streaming contract against a fake fetch (text
  deltas, done with usage, abort via `AbortSignal`, auth and rate-limit
  errors typed) and the mock replays a script deterministically. *Done
  2026-09-07. Plain `fetch` per the spec (the bundled Claude API skill
  defaults to the official SDK; the spec's no-vendor-SDK rule wins).
  `providers/src`: `errors.ts` (`ProviderAuthError` 401/403,
  `ProviderRateLimitError` 429 with retry-after, `ProviderUnavailableError`
  5xx/529, `ProviderNetworkError`), `sse.ts` (chunk-safe reader, re-checks
  the abort signal after a cancelled read), `anthropic.ts` (version
  header `2023-06-01`, browser-access header, `message_start`/
  `content_block_delta`/`message_delta` parsing, `stopReason` on done so
  a `refusal` is visible, paged `/v1/models` using `max_input_tokens`
  when reported and a family table otherwise; spec §20.2 is settled in
  favour of the API field with the table as fallback), `openrouter.ts`
  (bearer, referer, title, `usage.include`, `[DONE]`), `mock.ts`
  (`demoScript` cites the ref comments it was given and names precedence).
  The contract suite (`test/contract.ts`) is scenario-based; each
  provider's test file serialises scenarios in its wire format, cutting
  the SSE bytes at 1, 3, 7, and 1024 bytes so multi-byte characters split
  across reads. Live calls are the maintainer's to try from the Reason
  screen (block 7).*
- [x] **3. Ratify and reject** (S) — spec §9, schema §5, §7.7. `core`:
  `buildRatify(snapshot, changes: FileChange[])` rewrites `curated` and
  `updated` only on the filing's added `source` and `notes` files, message
  `Ratify: <slug>`, indexes carried; `isFilingCommit(info, changes)`
  (message prefix `File: ` plus at least one added `raw.md`); reject is
  `driver.revert(sha, 'Reject: <slug>')`. Done when, over the memory
  driver, ratify touches exactly the two files, reject after a later
  filing succeeds, and a conflict lists the paths. *Done 2026-09-07.
  `core/review`: `filingSlug`, `isFilingCommit`, `filingState` (pending /
  ratified / rejected / changed), `reviewFiling` (added files, attachments
  by name and size, the capture's `+` lines), `buildRatify` (refuses a
  non-filing, an already ratified filing, and a rejected one).
  `storage/filings.ts`: `listFilings` (history then compare per `File:`
  commit), `changesOf`, `rejectFiling` (revert). `CommitInfo` and
  `FileChange` moved into core. The review view renders added files from
  the snapshot at head, not from the filing commit's blobs: if a later
  commit changed them, ratify and reject are refused anyway and the
  state shows as changed.*
- [x] **4. Filing through the app** (M) — spec §8.5. `core/assembly`: the
  Task C system prompt asking for one strict JSON object per capture;
  `parseFilingReply(text): { meta: SourceMeta; proposals: ProposalParams[] }`
  validating shape, kinds, and conditional fields and refusing anything
  else; the capture's text and note go in the prompt, never the
  attachment. Done when a scripted reply files a capture end to end
  through `buildFiling` over the memory driver and a malformed reply is
  refused before any commit. *Done 2026-09-07. `core/assembly/filing.ts`:
  `FILING_PROMPT` (one strict JSON object, no fences, leave optional
  fields out rather than guess, only listed slugs and refs),
  `buildFilingPrompt(snapshot, capture, budget)` (sets with principle
  refs and bodies, existing source slugs, the note, the capture text; an
  attachment is mentioned but never shown; `CAPTURE_EXCEEDS_BUDGET`),
  `extractJson` (tolerates fences and stray prose), `parseFilingReply`
  (strict: unknown keys, wrong types, missing conditional fields, and,
  with a snapshot, any target set, principle, or grounds slug that does
  not exist are refused with a `FilingReplyError` naming the field; tags
  are lowercased and deduplicated; an optional `meta.slug` is accepted).
  The mock-provider end-to-end lands with the Inbox screen (block 8).*
- [x] **5. Sets screen** (M) — proposal §6, US-18, US-20, spec §7.3.
  `routes/Sets.svelte`: sets with ordinal and sub-name, new set, rename,
  reorder (drag, with a keyboard fallback), delete with confirmation
  naming the principle count and the dangling report, per-set description
  editor, principle drag-reorder within a set. Done when a Playwright flow
  over the demo brain creates Set 3, names it, reorders, deletes Set 1,
  and the survivors read "Set 1 — Work" with every link intact. *Done
  2026-09-07. `services/sets.ts` (unit-tested): `newSet`, `renameSet`,
  `describeSet`, `moveSet`/`movePrinciple` (one step), `placeSet`/
  `placePrinciple` (drag target index), `planDeleteSet`/
  `planDeletePrinciple` (count, dangling report, and the commit to run
  after confirmation). `routes/Sets.svelte`: HTML5 drag-and-drop plus
  Move up/down buttons as the keyboard path (the flows drive the
  buttons); inline delete confirmation naming the principle count and
  every dangling reference; description editor; the last set's Delete
  is disabled. Principle deletion lives here too since it is the same
  screen (US-4's editors are block 6). Flows: create/rename/reorder/
  delete with survivors renumbered and paths intact, set reorder and
  description, last-set guard.*
- [x] **6. Editors with curation enforcement** (L) — US-4, US-5, US-6,
  US-7. Principle create and edit from `templates/principle.md`, with a
  link-insertion helper that writes dual links and a one-tap sync when
  body links and `grounds` drift; notes editing that turns the file
  `human`; source metadata editing (title, author, work, year, locator,
  origin, tags) with the body read-only; no editor for `raw.md` bodies or
  attachments, ever. Every save is `validateBatch`-checked. Done when
  flows write a principle from the editor, sync drifted grounds, edit a
  notes file and see it become `human`, and confirm a `raw.md` body has no
  edit affordance. *Done 2026-09-07. `services/edit.ts` (unit-tested):
  `appendGroundingLink` (adds the Grounding passages heading once and one
  dual link per call), `driftOf`, `createPrincipleIn`, `savePrinciple`,
  `saveNotes` (any state → `human`), `saveSourceMeta` (blank optional
  fields are removed; the body is never touched; the file becomes
  `human`, so editing a pending filing's metadata makes it yours and
  ratify then refuses it as changed). `routes/Editor.svelte` on
  `#/edit/<path>` and `#/sets/<slug>/new-principle`: principle form with
  grounds chips, a source picker that inserts the dual link and the
  ground together, and two one-tap syncs (grounds ← body links, body ←
  grounds); notes form; source metadata form with the passage shown
  read-only and no textarea; anything else says nothing is editable.
  FileView links Edit for principles and notes and Edit metadata for
  sources with a note that the passage is immutable.*
- [ ] **7. Reason screen** (L) — US-8, US-9, US-10, US-19, spec §8.3,
  §10.2. `routes/Reason.svelte` and `ReasoningService`: set picker chips
  (last selection remembered), task presets (reason, relate, compare,
  free-form), provider and model picker from `listModels`, budget bar
  from `assemble` before sending, streaming transcript, citations as
  links with unresolvable ones marked. Done when a flow with the mock
  provider reasons from two sets and shows set-attributed output with
  precedence named and citations that resolve into Browse.
- [ ] **8. Inbox screen** (L) — US-2, US-3, spec §9, proposal §9
  decision 3. `routes/Inbox.svelte`: captures with their status, "process
  inbox with AI" running block 4 per capture with one commit each, recent
  filing commits from `history({limit: 50})`, the review view built from
  `compare` (added files rendered in full, an attachment as name and
  size, the capture's `+` lines only), ratify and reject with the conflict
  explanation. Done when a flow files a capture through the mock
  provider, reviews it, ratifies it, files another and rejects it, and
  the inbox shows the right states throughout.
- [ ] **9. Proposals screen** (M) — US-3, schema §4.7, §7.10.
  `routes/Proposals.svelte`: open proposals grouped by target set with
  kind, title, rationale, and links; accept and decline via
  `decideProposal`; accepting a `principle` or `amendment` opens the
  block 6 editor pre-filled from the proposal. Done when a flow decides
  three proposals and writes a principle from an accepted one, and the
  proposal shows `accepted` with the new principle linked.

## Deferred from Phase 1

Carried over unchanged; each needs something from the maintainer.

- [ ] **P1-13b. `GitHubDriver` against real GitHub** (S) — needs a
  disposable fine-grained token (Contents read/write) and a scratch
  private repo. Done when the storage contract suite passes against it on
  a nightly schedule (spec §18). The fake's assumptions to confirm: a
  `POST /git/trees` entry with `sha: null` for a path absent from
  `base_tree` is a 422; the ref PATCH with `force: false` returns 422 on a
  non-fast-forward; `/compare` statuses are `added`/`modified`/`removed`
  with `patch` for text; blob `size` is present in recursive tree
  listings; `auto_init` exposes the ref within the driver's ten retries.
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
  dry-run the tarball. A published package is public even though this
  repository is private; it contains only the built CLI.

## Decisions made during Phase 2

- **A mock provider ships.** Not in the spec, but spec §17's flows assume
  one, and it lets the demo brain reason without a key.
- **The design pass waits for Phase 3.** Phase 2 screens stay functional
  and mobile-first like Phase 1's.

## Notes for whoever resumes

- Phase 1 conventions still hold: every operation is one `CommitBatch`
  through `BrainService.commit`, which runs `validateBatch` first; index
  files ride along via `withIndexWrites`; `nowUtc()` for timestamps;
  `$state` proxies must be `$state.snapshot`-ed before IndexedDB.
- Playwright runs from `packages/app` (`npm run e2e -w packages/app`),
  never from the repo root. The `pwa` project builds into `dist-preview/`.
- The demo brain accepts `#/settings?demo-omit=a,b` to drop paths.
- Prompts in `assembly/prompts/*.md` are imported as raw text; core stays
  free of Node and DOM, so the import must work under Vite and vitest
  alike (a `?raw` import is Vite-only; prefer exporting them as TypeScript
  string constants generated from the `.md` files, or keep them as `.ts`).
