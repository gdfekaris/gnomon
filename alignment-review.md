# Gnomon — Alignment Review

**Contradictions and open questions across the proposal, the schema, the technical spec, and the template**

Version 0.1 — Pre-code review
September 2026

---

## How to use this document

Every item below has an ID, a question, and a menu of options with one marked
← recommended. **Decide by writing a letter (or free text) on the Decision
line.** Once every Decision line is filled, the three design documents and the
template get rewritten in one pass so that they agree, and this file becomes
the changelog for that pass.

Items are grouped:

- **§1 Settled — template must follow.** No decision needed. The proposal and
  schema already decided these; the template still encodes the old
  geo-brain-2 format. Listed so the size of the rewrite is visible.
- **§2 Dropped silently.** Things the template does that the new documents
  neither keep nor reject. These are product decisions.
- **§3 Contradictions inside the new documents.** Places where proposal,
  schema, and spec disagree with each other or with themselves.
- **§4 Naming.**
- **§5 Mechanical drift.** Fixed without a decision during the rewrite pass.
- **§6 Open questions carried from the proposal (§9.3) and spec (§20).**

Section references use P (proposal v0.2), S (schema v0.1), T (technical spec
v0.1), A (template/AGENTS.md), R (template/README.md).

---

## §1 Settled by the new documents — the template must be rewritten to match

The template under `template/` is the geo-brain-2 scaffolding. Every file in
it predates the schema. None of the following needs a decision; each is a
place where the template contradicts a rule the proposal or schema already
made explicit.

| # | Template today | Schema / proposal | Where |
|---|---|---|---|
| 1.1 | `principles/<slug>.md`, flat | `principles/<set-slug>/_set.md` + `<principle-slug>.md`; no `templates/set.md` or `templates/inbox.md` exist yet | S §2, §4.4 |
| 1.2 | Frontmatter: `grounded-in`, `grounding`, `drafted-by`, `url`, `accessed`, `captured`, `source: "[[SLUG]]"`; no `type`, `created`, `updated` | snake_case: `grounds`, `origin`, `locator`, `inbox_ref`, bare `source: <slug>`; `type`, `created`, `updated` required on every file | S §4 |
| 1.3 | `templates/source-raw.md`, `source-notes.md`, blank fields with comments | `templates/raw.md`, `notes.md`, `principle.md`, `set.md`, `inbox.md`, `{{double_brace}}` placeholders | S §4.9 |
| 1.4 | Notes stub is `curated: human` | Notes stub is `agent-proposed`, becomes `human` on first curator edit | S §4.3 |
| 1.5 | Agents maintain both `_index.md` files (A rule 3, A Task D, R) | Generated only; agents never edit; desktop runs the CLI | P §9.1 decision 4, S §4.8, §10 |
| 1.6 | `principles/_index.md` is a hand-kept reading list with In force / Provisional / Scoped / Retired | Generated list of sets and principles | S §4.8 (but see §2.1, §2.2 below) |
| 1.7 | `/capture` writes `inbox/YYYY-MM-DD-<slug>.md` with no frontmatter | `inbox/<YYYYMMDD>-<HHMMSS>-<3 chars>.md` with `type: inbox` frontmatter | S §3.4, §4.6 |
| 1.8 | Proposals: `### P3 · rule change · AGENTS.md` with Question / Options / Decision; agent executes decided items and deletes them | Structured entries with `kind`, `target_set`, `status`; never deleted; only app or curator changes status | S §4.7 (but see §2.6, §3.2) |
| 1.9 | Dual link is `[[slug]] (../sources/slug/raw.md)`; frontmatter may hold `[[slug]]` | `[[sources/slug/raw]] ([raw](../../sources/slug/raw.md))`; frontmatter holds bare slugs, never links | S §6 |
| 1.10 | No commit discipline; R says "this brain stays local — no remote is configured"; branch `master`; orphan `skeleton` branch | Pull at session start, commit and push at session end; `File: <slug>` one commit per inbox item; everything on `main`; agents never branch | P §4.5, US-11, S §7.6, §10 |
| 1.11 | A rule 1: `raw.md` passages may be added or struck while `agent-proposed`, by the curator or at their direction | While `agent-proposed` the only permitted change is rejection (revert) | S §4.2 |
| 1.12 | A rule 2: agents may maintain bookkeeping frontmatter (`tags`, `grounding`, `grounded-in`, `source`) on `human` files and repair links after a move | Agents never write a `human` file; files never move, so there is nothing to repair | S §1, §5, §10 |
| 1.13 | A Task A: precedence order, skip Provisional/Retired/Scoped | Every principle in the selected set, verbatim, per the fill order; no A/B/C/D budget rules in AGENTS.md at all | S §8 (restated in AGENTS.md per S §8 — currently absent) |
| 1.14 | A Task D = "Reconcile the indexes" | Task D = "Compare principle sets"; reconcile becomes `validate` in the CLI | P US-19, T §13 |
| 1.15 | A intro: rules hold "unless explicitly instructed otherwise" | No escape hatch; the app flags violating commits for mandatory review | S §5, §10 |
| 1.16 | `bin/brain` is a bash status script that assumes flat `principles/` | `bin/brain` installs the Node CLI (`index`, `validate`) | T §13 (see §3.8 for naming) |
| 1.17 | `tools/export-skeleton.sh`, `templates/skeleton-*`, A "Publishing the Skeleton", R "Publishing the scaffolding" | Not mentioned. They exist to publish scaffolding *out of* a live brain; in this repo `template/` *is* the scaffolding. Vestigial; remove. | — |
| 1.18 | `.claude/commands/*` reference `original.md`, `grounded-in:`, `[[slug]] §N`, In force, Task D = reconcile | Rewrite each against the new AGENTS.md | — |
| 1.19 | `template/README.md` is titled `geo-brain-2` and duplicates `templates/skeleton-README.md` | One README for the scaffold | S §2 |

Consequence: `template/` is a rewrite, not an edit. Every file changes.

---

## §2 Dropped silently — product decisions the new documents never made

### 2.1 · precedence order among principles

**Question:** The template's strongest idea is "order is precedence": when two
in-force principles conflict, the earlier one governs and the agent must say
so (A Task A step 3, R). The schema gives principles no ordering at all; the
spec sorts them by title for the index (T §7.2) and leaves prompt order
unspecified (S §8 step 1, T §8.3). Does a set have an order?

**Options:**
- **a** — Add `order` to principle frontmatter: positive integer, contiguous 1..N
  within the set, maintained by the app exactly as set `order` is (S §4.4). The
  index, prompt assembly, and the Task A system prompt all honor it: earlier
  governs on conflict and the model says it invoked precedence. Agents never
  touch it. Desktop users edit the number by hand. ← recommended
- **b** — No ordering. Principles are unordered within a set; the model names
  tensions but never resolves them by rank.
- **c** — Ordering lives in `_set.md` as a `principles:` list of slugs.
  Rejected on the schema's own grounds: it duplicates set membership in two
  places.

**Decision:**

### 2.2 · principle statuses (In force / Provisional / Scoped / Retired)

**Question:** The template's reading list distinguishes four states; the
schema has none. Principle sets subsume *Scoped* (a scoped domain is a set).
*Retired* becomes deletion, which git history preserves. *Provisional* has no
analog. Keep any status?

**Options:**
- **a** — No status field. A principle in a set is in force. Provisional
  thinking stays in the proposals queue until the curator writes it; a retired
  principle is deleted and lives in history. ← recommended
- **b** — Add `status: active | retired` to principles; `retired` files stay in
  place (files never move), are excluded from assembly and from the in-force
  index section, and are listed under a Retired heading. Costs one field and
  one assembly filter.
- **c** — Full four-state model from the template, as a `status` field.

**Decision:**

### 2.3 · one passage per capture, `original.md`, and §-numbered passages

**Question:** Three template features stand or fall together. (i) A `raw.md`
holds several `## §1`, `## §2` passages, cited as `[[slug]] §N`. (ii) A capture
the curator owns is retained whole as `sources/<slug>/original.md`, so a
capture never survives only as an agent's selection (A rule 4, Task C step 3).
(iii) Bulk formats (PDF, HTML) pass through `inbox/` as transport and are
gitignored. The schema instead says one source folder holds one passage (S
§3.1), the inbox body becomes the `raw.md` body verbatim and the app copies it
without the model in the loop (S §7.6, T §8.5), and the inbox file itself is
kept in place after filing (S §3.4, §4.6). Under that model nothing is ever
lost by selection, because there is no selection: `raw.md` *is* the capture.
The proposal lists "multiple passages per capture" as open (P §9.3).

**Options:**
- **a** — Schema model. One passage per capture, `raw.md` body equals the
  inbox body byte for byte, no `original.md`, no `§N`. Five passages from one
  book are five captures sharing `author` and `work`, and the index groups
  them. Sub-passage citation uses heading anchors (S §6) or `locator`. The
  bulk-transport paragraph leaves AGENTS.md; the binary rules in `.gitignore`
  stay as hygiene. ← recommended
- **b** — Keep multi-passage `raw.md` with `§N` headings and `original.md` for
  curator-owned captures. Requires: reinstating the selection step in Task C,
  a model-in-the-loop passage picker in the PWA (T §8.5 must change), an
  `original.md` entry in the schema, and `§N` in the link grammar.

**Decision:**

### 2.4 · the `rule change` proposal kind

**Question:** The template lets agents propose changes to AGENTS.md itself
(R "Deciding proposals" example: `P3 · rule change · AGENTS.md`). The schema's
`kind` enum is `principle | link | tag | amendment`. In Gnomon, AGENTS.md is a
product artifact versioned with the app, not a per-brain document.

**Options:**
- **a** — Drop it. Agents do not propose protocol changes inside a brain;
  protocol issues go to this repo. ← recommended
- **b** — Add `kind: note` as a catch-all for anything the agent wants the
  curator to see that fits no other kind.

**Decision:**

### 2.5 · who records a proposal decision on desktop

**Question:** S §4.7 says only the app or the curator changes a proposal's
`status`. On desktop the curator acts through an agent (`/proposals`), and the
template's command has the agent record and execute decisions. Under the
schema, accepting a `principle` proposal means the curator writes the
principle by hand; there is nothing for an agent to execute.

**Options:**
- **a** — An agent may set `status` on a proposal only in a session where the
  curator explicitly decided that item, and records nothing else. Accepting a
  `principle` or `amendment` still means the curator writes the file. Stated
  as an explicit carve-out in S §4.7 and AGENTS.md. ← recommended
- **b** — Desktop users edit `status` by hand; agents never touch it.

**Decision:**

### 2.6 · `package.json` inside every brain

**Question:** T §13 ships `package.json` and `bin/brain` in the template so
that `npx brain …` works in a clone. That puts a Node manifest, a lockfile, and
a `node_modules/` ignore rule into a repository whose pitch is "plain markdown
in your own git repo".

**Options:**
- **a** — Publish the CLI to npm (name per 3.8); AGENTS.md and the README
  say `npx gnomon-cli validate`. The template stays pure markdown with no
  `package.json`. ← recommended
- **b** — Keep `package.json` + `bin/` in the template as specified.

**Decision:**

---

## §3 Contradictions inside the new documents

### 3.1 · who marks an inbox item filed, and `filed_commit` cannot exist

**Question:** Three statements conflict. S §7.6: the *filing* commit sets the
inbox item to `status: filed`, `filed_as`, `filed_commit`. S §5 and P US-3: the
*ratification* commit marks the inbox item filed. S §4.6 and §5: inbox items
are always `curated: human`, and agents never write `human` files, so an agent
may not touch the inbox item at all. Separately, `filed_commit` is the SHA of
the commit being created; a commit's SHA depends on its tree, so it cannot be
written into that tree. T §9 then says reject "returns the item to unfiled
because the revert restores its pre-filing frontmatter", which only works if
the filing commit did touch it.

**Options:**
- **a** — The filing commit sets `status: filed` and `filed_as`; this is a
  named exception to the human-file rule (these two fields are clerical, the
  body is untouchable). Drop `filed_commit`; the app finds the filing commit
  from the history of `sources/<filed_as>/raw.md`. Ratification only flips
  `curated`. Reject reverts the item to `unfiled` for free. Fix S §4.6, §5,
  §7.6, P US-3, T §9. ← recommended
- **b** — The filing commit never touches the inbox item. Ratification sets
  `status: filed`, `filed_as`, `filed_commit` (known by then). Agents detect
  "unfiled" as: `status: unfiled` and no `raw.md` carries a matching
  `inbox_ref`. Reject leaves the item untouched.

**Decision:**

### 3.2 · a single `_proposals.md` makes every filing after the first un-rejectable

**Question:** T §6.2 `revert` refuses when any touched path's current blob
differs from the target commit's blob. Every filing appends to
`maps/_proposals.md`. So after two filings, rejecting the first always hits
`RevertConflictError`, and P §9.1 decision 2's "revisit only if agents produce
multi-commit filings" is reached on the second inbox item. Also,
`from_commit` in each entry has the same impossibility as `filed_commit` (3.1).

**Options:**
- **a** — One file per proposal: `maps/proposals/P-20260905-003.md` with
  frontmatter `type: proposal`, `kind`, `target_set`, `from_source: <slug>`,
  `status`, `title`, `grounds`, `curated: agent-proposed`, `created`,
  `updated`; body is the rationale. A filing adds files and modifies only the
  inbox item, so revert conflicts only when something real happened.
  `maps/_proposals.md` goes away (the index lists open proposals). ← recommended
- **b** — Keep the single file; exclude it from the revert conflict check and
  have reject rewrite the rejected filing's entries to `status: declined`.
  Replace `from_commit` with `from_source`.

**Decision:**

### 3.3 · index frontmatter defeats determinism and minimal commits

**Question:** S §4.8 puts `generated: <datetime>` and `generator: <app
version>` in index frontmatter, and S §4.8 also promises "two devices
regenerating from the same commit produce byte-identical output". T §7.2 says
regenerated indexes are committed "only if they differ". With a timestamp they
always differ, and two app versions never agree.

**Options:**
- **a** — Index frontmatter is `type: index` only. No timestamp, no version, no
  `curated`, no `created`/`updated`; `type: index` is exempt from the common
  required fields (S §4.1). The banner comment stays. ← recommended
- **b** — Keep the fields; compare bodies only when deciding whether to commit;
  accept that different app versions disagree on the header.

**Decision:**

### 3.4 · the template cannot be a valid brain if Set 1's slug is per-user

**Question:** S §2 says a brain is valid only with at least one set. T §12 step
3 generates the Set 1 slug "per user, not fixed in the template". So `template/`
in this repo is never a valid brain, a desktop user who clones it gets an
invalid brain, and every test fixture needs its own generation step. Slugs
only need uniqueness within one repository (S §3.2), so a fixed slug shared by
every fresh brain collides with nothing.

**Options:**
- **a** — The template ships `principles/<fixed-slug>/_set.md` at `order: 1`.
  Pick one four-character slug from the alphabet and never change it. ← recommended
- **b** — Keep per-user generation; add a `gnomon init` CLI step for desktop
  clones and document that the raw template is not a brain.

**Decision:**

### 3.5 · the stated purpose of `principles/_index.md` is contradicted by the fill order

**Question:** S §4.8 says `principles/_index.md` exists "so that prompt
assembly for reasoning tasks fetches one file". S §8 and T §8.3 assemble from
`_set.md` and every principle file directly; the index is never read. Its real
job is the desktop agent's one-file entry point for finding sets and
principles (Task A on desktop).

**Options:**
- **a** — Keep the file, correct the rationale to "navigation entry point for
  desktop agents; never part of a prompt". ← recommended
- **b** — Drop it; `maps/_index.md` is the only index.

**Decision:**

### 3.6 · the flat-principles migration serves nobody

**Question:** S §7.8 step 2, P US-15, P §8 Phase 1, T §12 and T §17 all build a
one-time "move flat principles into Set 1" repair, described as the only move
the app ever performs. The only brain with flat principles is geo-brain-2,
whose format differs from the schema in far more than layout (§1 above):
field names, link grammar, multi-passage `raw.md`, `original.md`, an inbox
without frontmatter, hand-kept indexes. The move alone would leave it invalid.
geo-brain-2 today holds 2 sources, 1 principle, and 1 inbox item.

**Options:**
- **a** — Delete the repair from all four documents. The app never moves a
  file, without exception. Migrate geo-brain-2 by hand: re-capture the two
  passages through the new flow and rewrite the one principle. ← recommended
- **b** — Keep the repair as specified and accept that it does not finish the
  job for the one brain that needs it.

**Decision:**

### 3.7 · lazy body loading contradicts validate-on-read and regenerate-on-write

**Question:** T §6.2 loads bodies lazily to keep request counts low. But S §9
validates on every read, and T §7.2 regenerates both indexes on every write
from the frontmatter of *every* file. Frontmatter lives inside the file, so
every file must be fetched before any write. At six parallel requests per
host on LTE, a 500-file brain (T §16 target: under 4 s) takes on the order of
ten seconds through the REST contents endpoint. The spec also forbids caching
brain content on the device (T §10.3), so this cost is paid on every cold
start.

**Options:**
- **a** — Load the whole snapshot eagerly through the GitHub GraphQL API,
  which returns many blobs per request (`object(expression: "<sha>:<path>")`
  batched, still plain `fetch`, no Octokit). Writes stay on the REST Git Data
  API. Keep "no brain content on device". Measure against T §16 and revisit
  T §20.1 (persist the tree listing only) if needed. ← recommended
- **b** — Persist blobs by SHA in IndexedDB as a content-addressed cache,
  relaxing "no brain content on device" to "no brain content on device unless
  the brain is encrypted".
- **c** — Keep the spec as written and lower the T §16 target.

**Decision:**

### 3.8 · the desktop CLI is named after an existing npm package

**Question:** T §13 has agents run `npx brain validate`. On npm, `brain` is a
deprecated placeholder that npm itself holds "to avoid malicious use", and
`gnomon` is already taken by an unrelated package (v1.5.0). `gnomon-cli` and
`gnomon-brain` were unclaimed on 2026-09-05. Interacts with §2.6 and §4.

**Options:**
- **a** — Publish the package as `gnomon-cli` with its binary named `gnomon`,
  so a clone runs `npx gnomon-cli validate` and an installed user runs
  `gnomon validate`. Claim the npm name now. The bash status script's counts
  fold into `gnomon status`; the bash file goes. ← recommended
- **b** — Keep a dependency-free bash `bin/status` in the template alongside
  the Node CLI, for users without Node.

**Decision:**

### 3.9 · Appendix A is a second copy of the schema and has already drifted

**Question:** P Appendix A reproduces the schema verbatim "also maintained as a
standalone document". The two copies already disagree (proposal entry heading
is `###` in Appendix A, `##` in the schema; section numbering differs). Two
normative copies will keep drifting.

**Options:**
- **a** — Appendix A becomes a one-paragraph pointer to the schema document.
  The schema is the only normative copy. ← recommended
- **b** — Keep both and add a check to the rewrite pass.

**Decision:**

### 3.10 · minor internal contradictions (decide once, apply everywhere)

Each of these has one sensible reading; the decision is to confirm it.

- **3.10.1** P §4.1 calls the PWA "the sole generator of the two index files"
  and, two sentences later, ships "a small script that regenerates the index
  files". Reading: one generator (`brain-core/index`), two entry points (app,
  CLI). Rewrite the sentence.
- **3.10.2** P §4.3 names the storage interface `list, read, write, commitBatch,
  history, compare, revert, createRepo`; T §6.1 names it `head, list, read,
  commit, history, compare, revert, createRepo?`. Reading: the spec wins; the
  proposal's list is updated.
- **3.10.3** P §4.4 names the provider interface `complete(messages, model,
  options)` + `contextWindow(model)`; T §8.1 has `listModels()` +
  streaming `complete(req)`. Reading: the spec wins.
- **3.10.4** S §4.7 gives `_proposals.md` `curated: agent-proposed` but it
  never ratifies and the curator edits it. Reading: proposals are exempt from
  the §5 state machine (moot under 3.2a, where each proposal file has its own
  state and is never ratified either; say so).
- **3.10.5** S §3.4 "3 random chars" names no alphabet. Reading: the §3.2
  alphabet.
- **3.10.6** T §6.4 introduces `.brain/encryption.json`; S §2 and §10 never
  reserve a hidden folder. Reading: reserve `.gnomon/` for app metadata in S
  §10 and list it in S §2.
- **3.10.7** T §12 step 3 commits "the template tree as the initial commit"
  through the Git Data API, which needs an existing ref. Reading: create the
  repo with `auto_init` and commit on top of the generated initial commit.
- **3.10.8** S §4.6 keeps `captured` as a duplicate of `created` "for
  readability". Reading: drop `captured`; one timestamp.

**Decision:**

---

## §4 Naming

**Question:** The product is Gnomon. Every document, the monorepo path, the
Pages base path, and every identifier still says Second Brain: `second-brain/`
(T §3), `VITE_BASE=/second-brain/` (T §18), `<!-- sb-enc v1 -->` (T §6.4),
`SB_PASSPHRASE` (T §13), the KDF check constant `second-brain-ok` (T §6.4),
"GENERATED by the Second Brain app" (S §4.8), the three filenames.

**Options:**
- **a** — Rename everything now, before code: documents become
  `gnomon-proposal.md`, `gnomon-schema.md`, `gnomon-technical-spec.md` (version
  stays in the header); identifiers become `gnomon-enc v1`,
  `GNOMON_PASSPHRASE`, `gnomon-ok`, `.gnomon/`, base path `/gnomon/`, CLI
  package `gnomon-cli` with binary `gnomon` (3.8), monorepo `gnomon/`. "Second Brain" survives only as the generic
  phrase in the summary paragraph. ← recommended
- **b** — Rename the product name in prose only; keep `sb-` identifiers.

**Decision:**

---

## §5 Mechanical drift — fixed in the rewrite pass without a decision

- Task letters: the AGENTS.md rewrite uses A (reason), B (relate), C (file
  inbox), D (compare sets) per the proposal; reconcile is `gnomon validate`.
- AGENTS.md gains, per P §8 Phase 1: session pull/push rules, the S §10
  forbidden list, Tasks A–D, the S §8 fill order and budget, the S §9
  validation list, and the `File: <slug>` commit message rule.
- Order of principles inside a set in assembly and index follows 2.1.
- `principles/.gitkeep` is redundant beside `principles/_index.md`; remove.
- `template/.gitignore` and `templates/skeleton-gitignore` are byte-identical;
  keep one.
- The scaffold README links to AGENTS.md (S §2) and stops describing the
  skeleton branch and `master`.
- `.claude/commands/*` rewritten against the new AGENTS.md; `/reconcile`
  becomes a wrapper around `gnomon validate`; `/proposals` follows 2.5.
- S §4.7 "append-only" becomes "agents only append" (status lines change).
- S §5 diagram gains the notes-stub path (`agent-proposed` → `human` on first
  edit is drawn; `ratified` → `human` on edit is stated but not drawn).
- Proposal §3.1 US-2 "agents never touch the generated index files" and S §7.6
  agree; AGENTS.md says the same.
- Fixture brain (T §17) is built from the rewritten template so tests and
  onboarding share one scaffold.

---

## §6 Open questions carried forward

From P §9.3, with a recommendation each:

- **6.1** `_set.md` body as system-level instruction or ordinary context.
  T §8.3 already makes it a settings flag defaulting to context. Keep the flag;
  decide after Phase 2 evaluation. No action now.
- **6.2** Task D with a new text. Recommend no for v1: Task B with several
  sets selected already labels each set's reading of the text (S §8
  "Multiple sets"). Note the overlap in the proposal and close the question.
- **6.3** Multiple passages per capture. Resolved by 2.3.
- **6.4** Auto-populate `grounds` from dual links in a principle body.
  Recommend: `gnomon validate` and the app editor warn when the body links to a
  source absent from `grounds` or vice versa, and the editor offers a one-tap
  sync. Frontmatter stays the machine surface (S §1 rule 2); the warning keeps
  the two from drifting without making the body authoritative.

From T §20, unchanged and correctly left open: snapshot persistence (revisit
with 3.7), the Anthropic context-window table, Argon2id parameters, the
single pending offline capture.

---

## §7 What happens after the Decision lines are filled

1. Rewrite the schema first (it is the contract), then the proposal (pointer
   Appendix, interface names, US-3/US-15 wording), then the spec.
2. Rewrite `template/` from the schema: layout, `AGENTS.md`, `README.md`,
   templates, commands, fixed Set 1, generated-empty indexes.
3. Migrate geo-brain-2 by hand into the new format as the first real brain,
   which doubles as the acceptance test for the template.
4. Only then scaffold the monorepo per T §3.
