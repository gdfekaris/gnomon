# Phase 1 tracker

Working document for Phase 1 (technical spec §19, row 1). One block at a
time, in this order. Each block ends in a green commit with its own tests
and a "done when" you can check without reading code. Tick a block when
it is committed and CI is green. Delete this file when Phase 1 is complete
and write `docs/phase-2-tracker.md` from a fresh breakdown.

Started 2026-09-06. Resume a session by finding the first unticked block.

## Blocks

Blocks 1–12 are the core library and CLI; all testable offline against the
three golden brains (`template/`, `packages/core/fixtures/brain/`, and
`~/Desktop/main/geo-brain-2`). Blocks 13 onward touch the network and the
browser.

- [x] **1. Reference brain fixture** (S) — `packages/core/fixtures/brain/`:
  the template plus a few sources (one with an attachment), principles
  across two sets, and proposals in each status. Done when
  `npm run validate:fixture` reports zero refusals, zero warnings, indexes
  up to date. *Done 2026-09-06; CI validates it alongside the template.*
- [x] **2. `parseFile` / `serializeFile`** (M) — `packages/core/src/schema`,
  spec §5. Done when every frontmatter-bearing file in the three golden
  brains round-trips byte-identical, and bad YAML or missing frontmatter
  throws a typed `ValidationError`. *Done 2026-09-06. Template and fixture
  round-trip byte for byte; geo-brain-2 round-trips semantically and
  idempotently, differing only in three double-quoted titles that the
  canonical form writes plain.*
- [x] **3. Snapshot builder** (S) — build `BrainSnapshot` from a
  path→text map plus tree entries. Done when `sets` and `principlesOf`
  are sorted by `order` and `byType` works for every type. *Done
  2026-09-06. `buildSnapshot` in `core/schema/snapshot.ts`; files that
  fail to parse are reported in `snapshot.issues` (an additive extension
  to spec §5) and left out, so a brain with one broken file still loads.
  `TreeEntry` now lives in core and storage re-exports it.*
- [x] **4. `validateSnapshot`** (M) — spec §7.4, schema §9. Done when it
  reproduces every refusal and warning of `tools/gnomon-check.py` on the
  golden brains and on hand-broken variants, one test per rule, each
  tagged `refusal` or `warning`. *Done 2026-09-06. Also `validateLayout`
  (schema §2 scaffold, needs the raw tree because empty folders hold only
  `.gitkeep`) and `hasRefusals`. Goes beyond the Python checker with:
  undeclared attachments, attachment naming, notes without raw, principle
  folders without `_set.md`, proposal `target`/`target_set`/`from_source`
  dangling, stale `inbox_ref`, unknown fields, stray files (warning). The
  links module is seeded with `linkedSourceSlugs` for grounds drift.*
- [x] **5. `validateWrite`** (S) — spec §7.4. Done when it refuses a
  `raw.md` body change in `human` or `ratified` state and any attachment
  change, and allows everything else. *Done 2026-09-06. Per schema §5 the
  raw body is immutable in every state, not only `human`/`ratified`. Also
  refuses `created` changes, curation transitions outside §5, and edits to
  a capture's body, note, or attachment. `validateBatch(snapshot, batch)`
  applies these plus attachment immutability and source deletion to a
  whole `CommitBatch`; `applyBatch` computes the resulting snapshot in
  memory. `CommitBatch`/`FileWrite` moved into core (storage re-exports).*
- [x] **6. Links module** (S) — spec §7.1: `parseLinks`, `renderDualLink`,
  `backlinks`, `groundsDrift`. Done when geo-brain-2's heading-anchored
  links parse and the drift warning matches the Python checker. *Done
  2026-09-06. `parseLinks(body, fromPath)` takes the referencing path so
  relative links resolve; a dual link whose halves disagree carries a
  `mismatch`. `renderDualLink` defaults the label from the target (raw,
  notes, set, principle, proposal, capture, file) and reproduces the
  reference generator's output. `backlinks` ignores index files and adds
  proposal `target_set` and `grounds` to the spec's list. `relativePath`
  and `resolveRelative` are exported for block 7.*
- [x] **7. `generateIndexes`** (M) — spec §7.2. Done when output is
  byte-identical to both `_index.md` files in `template/` and geo-brain-2,
  and to the Python checker's output on the fixture; regenerating an
  unchanged brain yields no diff. *Done 2026-09-06. Byte-identical on all
  three golden brains, and a test runs `tools/gnomon-check.py` on four
  mutated fixture variants and compares (CI installs PyYAML before
  `npm test` for this). `indexWrites(snapshot)` returns only the index
  files whose text differs, for the commit that carries them. Sorting is
  by codepoint via `cmpCodepoint`. Digit-only tags must be quoted
  (`"2026"`) or YAML reads them as integers.*
- [x] **8. Sets and principles** (M) — spec §7.3, schema §7.1–7.4, §7.9.
  Done when create/rename/reorder/delete produce `CommitBatch` values with
  correct renumbering, `reorderPrinciples` rewrites only moved files, and
  delete returns the dangling-reference report. *Done 2026-09-06.
  `core/sets`: `newSetSlug`, `createSet`, `updateSet` (rename, description,
  remove name), `reorderSets`, `deleteSet`, `slugify`,
  `uniquePrincipleSlug`, `createPrinciple`, `updatePrinciple`,
  `reorderPrinciples`, `deletePrinciple`. Every batch carries the index
  files it changes via `withIndexWrites` (in `core/index`). Commit
  messages beyond the schema's vocabulary: `Update principle set:`,
  `Reorder principle sets`, `Reorder principles: Set N`, `Edit principle:`,
  `Delete principle:`. Dangling reports cover `related`, proposal
  `target`/`target_set`, and body links in every file.*
- [ ] **9. Proposals and filing** (M) — spec §7.5, §7.6. Done when
  `nextProposalId` sequences within a day, `decideProposal` touches only
  `status` and `updated`, and `buildFiling` copies body and attachment
  byte for byte and changes exactly two capture fields.
- [ ] **10. Encrypted body format** (S) — spec §6.4 pure functions with a
  stub keyring. Done when encrypt/decrypt round-trips, AAD path binding
  fails on the wrong path, and unmarked bodies pass through as plaintext.
- [ ] **11. `MemoryDriver` + driver contract suite** (M) — spec §6.3, §17.
  Done when the suite passes: `expectedHead` rejection, atomic multi-file
  commit with a binary write, `readMany` over 100+ paths, revert conflict
  detection, and reject-of-an-earlier-filing-after-a-later-one succeeds.
- [ ] **12. Working-tree driver + CLI `validate` / `index` / `status`** (M)
  — spec §13. Done when the CLI runs on `template/` and geo-brain-2 and
  agrees with the Python checker, and CI's template check uses the CLI
  instead of the Python script.
- [ ] **13. `GitHubDriver`** (L) — spec §6.2, REST writes + GraphQL reads,
  no Octokit. Done when it passes the block 11 contract suite against a
  scratch repo. **Needs a disposable token and scratch repo from the
  maintainer.**
- [ ] **14. App shell: stores, BrainService, snapshot load** (M) — spec
  §10.1–10.2. Done when the app loads geo-brain-2 through the GitHub
  driver and shows its file list with `stale` handling on `HeadMovedError`.
- [ ] **15. Capture screen with attachment** (M) — spec §10.4. Done when a
  capture with a PDF lands as one `Capture:` commit that validates, the
  size limit is enforced before upload, and the head-moved retry works.
- [ ] **16. Browse screen with attachment view** (L) — proposal §6. Done
  when sets show in order and principles in precedence order with labels,
  markdown renders with dual links collapsed to one element, backlinks
  show, and attachments preview (image) or open (PDF); HTML is never
  rendered.
- [ ] **17. Settings + connect-existing** (M) — spec §12 step 4, US-15.
  Done when token and repo can be entered and persisted in IndexedDB,
  validation results are shown, and each missing scaffold item is offered
  as its own commit.
- [ ] **18. PWA polish + Pages deploy** (S) — spec §11, §18. Done when the
  app installs on iPhone, shows the update toast, and CI deploys to Pages.
- [ ] **19. Publish `gnomon-cli`** (S) — spec §18. Done when a tagged
  release publishes to npm and `npx gnomon-cli validate` works in a fresh
  brain clone. **The maintainer runs the publish.**

## Decisions made during Phase 1

- **CLI and the raw-body immutability rule.** The CLI reads only the
  working tree and makes no commits, but schema §9's "byte-identical to
  its previous committed version" needs the last commit. The CLI reads the
  previous version via `git show HEAD:<path>` when a `.git` directory is
  present and skips that one rule otherwise, saying so in its output.
- **Python checker retires at block 12.** Once the CLI validates the
  template in CI, `tools/gnomon-check.py` stays in the repo as the
  historical reference implementation and is no longer run.

## Notes for whoever resumes

- Spec's Phase 1 row is broader than CLAUDE.md's five-step list; this
  tracker follows the spec.
- Known serialization traps from geo-brain-2: date-only `created` beside
  full datetimes, double-quoted titles containing quotes, principles that
  omit `related` and `tags` entirely while the template writes `[]`.
  Round-trip fidelity means preserving what the file has.
- Canonical form quotes any string that YAML would read as something else
  (`locator: "4.3"`, `title: "true"`); the fixture had `locator: 4.3` and
  the serializer caught it. Per-file schema §9 rules live in `parseFile`
  under stable rule ids (`field.required`, `path.set-mismatch`, ...);
  cross-file rules are block 4.
- Block 7 must match the Python reference byte for byte. The reference
  was corrected 2026-09-06 to put a blank line between one author's source
  list and the next `### Author` heading in `maps/_index.md`.
- The tracker is the only place Phase 1 progress is recorded. Update it
  in the same commit as the block it ticks.
