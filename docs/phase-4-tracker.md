# Phase 4 tracker

Working document for Phase 4 (technical spec §19, row 4; proposal §8
"Privacy options"): the encrypting driver wired to a real keyring, unlock
and enable/disable/passphrase-change flows, `gnomon encrypt/decrypt`, the
attachment-encryption decision, a second storage driver, and local-model
documentation. One block at a time, in this order. Each block ends in a
green commit with its own tests and a "done when" you can check without
reading code. Tick a block when it is committed and CI is green. Delete
this file when Phase 4 is complete and write `docs/phase-5-tracker.md`
from a fresh breakdown.

Started 2026-09-11, after Phase 3 closed the same day (version 0.1.0 on
npm, the app live at `gdfekaris.com/gnomon/`, the nightly green against
real GitHub, the maintainer's iPhone test through capture, file, ratify,
and the editors).

## What already exists (Phase 1)

Spec §6.4 was designed up front and partly built: `core/crypto` has the
body format (`<!-- gnomon-enc v1 -->` marker, AES-256-GCM, nonce ‖
ciphertext ‖ tag, AAD = repo path), `isEncryptablePath`, `encryptBody` /
`decryptBody`, `importBodyKey` (non-extractable), and the
`EncryptionConfig` shape for `.gnomon/encryption.json`;
`storage/encrypting.ts` is the transparent wrapper and passes the driver
contract around `MemoryDriver`; `storage/keyring.ts` has the `Keyring`
interface and `StaticKeyring` (in-memory holder, the test stub);
`LockedError` exists and `describeError` names it. Missing: key derivation
from a passphrase, the device-wrapped "remember" key, every flow, the CLI
commands, and any UI.

## Blocks

- [ ] **1. Passphrase keyring** (M) — spec §6.4 "Key derivation", §20.3.
  Argon2id via libsodium (`libsodium-wrappers-sumo` for `crypto_pwhash`;
  WASM, runs in the browser and in Node, no DOM or Node types, so it may
  live in `core/crypto`): derive 32 bytes from passphrase + salt with the
  stored parameters, verify against `check`, import non-extractable, zero
  the raw bytes. Write and read `.gnomon/encryption.json` (schema §10
  reserves the folder; add the file to the layout rules as optional and
  never encrypted). `PassphraseKeyring` in `storage`: `unlock(passphrase,
  config)`, `lock()`, and "remember on this device": the raw key wrapped
  under a non-extractable device `CryptoKey` kept in IndexedDB, through
  the app's `services/persist.ts` pattern so a flaky IndexedDB never locks
  the user out silently. Measure Argon2id `MODERATE` on the maintainer's
  iPhone; if over ~2 s, default to `INTERACTIVE` with the parameters
  stored (§20.3), decision recorded below. Done when unit tests derive the
  same key twice from one passphrase and salt, a wrong passphrase fails
  the check without touching a file, the remembered key round-trips
  through a fake key store and a cleared store means "locked", and the
  derivation time on the maintainer's phone is written here.
- [ ] **2. Enable, disable, change passphrase** (M) — spec §6.4 "Enabling
  encryption on an existing brain". In `core`: `planEncrypt(snapshot,
  key, config)` (every eligible body rewritten as ciphertext plus
  `.gnomon/encryption.json`, one batch), `planDecrypt`, `planRekey`
  (re-derive, re-encrypt every body, rewrite salt and check), all under
  `expectedHead`. The §9 validator and the CLI over an encrypted brain
  without the key: frontmatter rules run, body rules (dual links, §6) are
  skipped for encrypted bodies with one note, indexes regenerate from
  frontmatter as before. `gnomon status` names the encrypted state. Done
  when, over `MemoryDriver`, encrypt then decrypt leaves every body
  byte-identical, rekey decrypts with the new passphrase and refuses the
  old, a head that moved mid-operation is refused with nothing written,
  `gnomon validate` over an encrypted copy of the fixture is clean with
  the note, and the driver contract still passes wrapped.
- [ ] **3. The app: unlock, toggle, disclosure** (L) — US-17, US-16, spec
  §12 step 5, §14 (`LockedError` → unlock sheet), proposal §7. Session
  composition: when `.gnomon/encryption.json` exists the driver stack is
  `EncryptingDriver(GitHubDriver, PassphraseKeyring)`; the unlock sheet
  appears on the first `LockedError`, with "Remember on this device" and
  its stated limit (an unlocked device unlocks the brain). Settings →
  Encryption: enable (the user types back "a lost passphrase loses the
  bodies"), disable, change passphrase, lock now; the disclosure verbatim
  from spec §6.4 (titles, tags, authors, structure, and attached files
  stay readable to the host; passage, notes, principle, proposal, and
  inbox text do not). Onboarding step 5 offers enablement before content
  exists. The review view on an encrypted brain: Phase 3's P4-notes said
  patches show ciphertext lines; decide here whether to recompute
  plaintext patches from blob reads at both commits (the driver has
  `readBlob` by sha) or to disclose; recommendation: recompute, since
  review is the whole point of ratification. Done when Playwright flows
  over the demo brain enable encryption, reload into the unlock sheet
  with remember off and straight into Capture with it on, refuse a wrong
  passphrase, capture and file and ratify on the encrypted brain with the
  review readable, change the passphrase, and disable; and a flow over
  the fake GitHub shows the stored blob is ciphertext and the app shows
  plaintext.
- [ ] **4. `gnomon encrypt` / `gnomon decrypt`** (M) — spec §6.4 "Desktop
  interop", §13. In `packages/cli`: passphrase from `GNOMON_PASSPHRASE` or
  a prompt; `decrypt` rewrites eligible bodies in the working tree as
  plaintext and keeps `.gnomon/encryption.json`; `encrypt` re-encrypts
  them (fresh nonces). Both refuse to run on a dirty tree unless `--force`,
  and print what they touched. AGENTS.md for encrypted brains: the session
  discipline (decrypt after pull, encrypt before push) — a template text
  change, wording confirmed with the maintainer; git-crypt documented as
  the alternative. Done when encrypt → decrypt over the fixture round-trips
  byte-identical plaintext, `validate` passes in both states, the built
  CLI does it from a scratch clone in a test, and the README documents it.
- [ ] **5. Attachment encryption decision** (S, maintainer) — spec §20.6,
  proposal §9.3. Options: keep attachments cleartext with disclosure
  (today), or encrypt bytes under the same key with the marker as a
  sidecar (binaries have no comment line) and decrypt on view.
  Recommendation for this phase: cleartext with disclosure, since the
  passage text is what the schema promotes and attachments are kept, not
  parsed; revisit when a real user asks. Done when the decision is in the
  list below and the disclosure text in Settings and onboarding says it.
- [ ] **6. Second storage driver** (L) — proposal §8 Phase 4 "pluggable-
  backend driver #2 (Forgejo or GitLab)", spec §6.1. Maintainer picks the
  host first. Both offer an atomic multi-file commit: Forgejo/Gitea
  `POST /repos/{owner}/{repo}/contents` with a `files` list, GitLab
  `POST /projects/:id/repository/commits` with `actions`; neither has
  GitHub's Git Data trees, so `commit` maps differently and `compare`,
  `history`, and `revert` need their own endpoints. A fake per host in
  `storage/test`, the contract suite over it, onboarding's host choice and
  token walkthrough, and a nightly against a real instance if the
  maintainer provides one (a Codeberg account is free for Forgejo). Done
  when the contract passes over the fake, the app connects an existing
  brain on the host end to end over the fake, and create-from-template
  either works or is explicitly "connect an existing repository" for that
  host.
- [ ] **7. Local-model documentation** (S) — US-13, US-16. `docs/local-
  models.md`: a desktop session with OpenCode or Pi against Ollama over
  the same AGENTS.md, the encrypt/decrypt discipline from block 4, and
  what stays private; linked from the CLI README and the app's privacy
  text. Done when the maintainer has run one session that way and the
  smoke checklist gains the step.

## UX block: Browse at scale (2026-09-12) — done 2026-09-12

Built the same day, all "done when" checks green on both engines.
Scoped after the maintainer asked what happens to Browse at hundreds of
sources. The whole brain is in memory, so filtering and grouping are
local and instant; the constraints are the phone screen and the tag
vocabulary. One block, one screen, its own service. Ticked when committed
and CI is green, like a phase block.

**Goal.** Browse stays a human-friendly library at hundreds of sources: a
search that finds a source by what you remember of it, tags that do not
crowd the screen, shelves by author and work, landmarks in time, and a
list that never renders more than a page at once.

**Non-goals.** Searching passage or notes text (frontmatter only, by the
maintainer's decision). Tag renaming or merging (a Tags screen with
counts and a bulk rename is its own discussion). An A–Z jump bar (wait
until authors pass about forty). Persisting search or expanded shelves
across launches.

**Where the logic lives.** `src/lib/services/browse.ts`, framework-free,
unit-tested in `test/browse.test.ts`: `normalize(text)` (lowercase, NFD,
strip combining marks, collapse whitespace), `matches(source, terms)`,
`filterSources(sources, {q, tags})`, `tagCounts(sources)`,
`topTags(counts, selected, n)`, `shelves(sources)`, `monthOf(created)`,
`page(list, shown)`. `Browse.svelte` keeps layout and state only.

### 1. Search

- A text field under the meta line and above the tags, placeholder
  "Search titles, authors, works, tags", `data-testid="browse-search"`,
  with a clear control (×, `data-testid="browse-clear"`) shown when the
  field is not empty. No search button; results update as you type.
- **Matching.** The query is split on whitespace into terms; every term
  must match. A term matches a source when it is a substring of the
  normalized `title`, `author`, `work`, any tag, or the source slug; a
  term that is all digits also matches an equal `year`. Normalization is
  case- and diacritic-insensitive: `emile` finds Émile.
- Search stacks on the tag filter and respects the sort. A count line
  above the list reads "12 of 240 sources" whenever a search or tag
  filter is active (`data-testid="browse-count"`).
- The query lives in the hash, `#/browse?q=…`, alongside `tag`, so the
  file view's "← Browse" returns to the same search; the file view keeps
  the last Browse hash in a module variable and uses it for that link.
  Nothing about the search is saved on the device.
- Empty result: "No source matches “q”." with a link that clears the
  search (and keeps the tags).

### 2. Tags with counts, fewer in view

- Counts are the number of sources carrying the tag, over the whole
  brain (not faceted by the current filter); tags carried only by notes
  or captures do not appear as chips.
- Each chip shows the tag and its count, the count small and muted:
  "stoicism 12".
- In view by default: the twelve most-used tags, ties alphabetical, plus
  every selected tag. A chip "All tags (n)" (`data-testid="all-tags"`)
  toggles the full list, alphabetical, with counts; collapsed again on
  the next visit.
- Tapping a chip toggles it. Several selected tags combine with AND. The
  "all" chip clears them. The hash carries `tag=a,b` (comma-separated);
  the single-tag links from a file view (`?tag=x`) keep working.
- The "Notes tagged x" section stays as it is, for a single selected
  tag; with several selected it lists notes carrying all of them.

### 3. Shelves (the author sort)

- Under Sort: Author the list is an outline. Each author is a heading
  with a count ("Marcus Aurelius · 5"), collapsed by default; tapping it
  expands that author. Expanded authors are remembered for the session
  (component state), not on the device.
- Inside an author with two or more sources, works are sub-headings
  ("Meditations (c. 180) · 3") in codepoint order, as the index groups
  them; sources without a `work` sit first, directly under the author.
  An author with one source shows it directly.
- With a search or tag filter active, every author that has a match is
  expanded automatically and the counts are match counts.
- `data-testid="shelf-{author-slug}"` on each heading, `aria-expanded`
  on it.

### 4. Landmarks (the date sorts)

- Under Newest and Oldest, a heading per month, "September 2026", from
  the UTC date of `created`. A month with one source still gets one.
  Headings are plain `h3`, not sticky (the tab bar is the one sticky
  thing).

### 5. Paging

- At most fifty source rows are rendered, then a button "Show 50 more
  (190 left)" (`data-testid="show-more"`); a final page shows "Show the
  last n". The page resets whenever the search, the tags, or the sort
  changes. In shelves, only expanded rows count toward the page.

### 6. Test affordance

- `connectDemo` gains `fill`: `#/settings?demo-fill=n` clones the
  fixture's four sources n times with distinct slugs, titles, authors
  drawn from a small list, works, years, months spread across a year, and
  tags drawn from a list of thirty, so a flow can browse a few hundred
  sources without a real brain. Test-only, like `demo-omit`.

### 7. Styling

- Tokens and shared classes only: the search is a normal input; chips
  are `.chip` with a `small` count inside; shelf headings are `h3` with a
  button role; the count line is `.meta`. One new shared rule at most, for
  the count inside a chip.

**Done when**, on Chromium and WebKit: typing narrows the list and the
count line says so; `emile` finds Émile; the query survives a trip into
a file and back; two tags AND together and the hash carries both; the
top twelve chips show counts and "All tags" reveals the rest; author
shelves start collapsed with counts, open on tap, and open by themselves
under a filter; Newest shows month headings; a demo brain filled to three
hundred sources renders fifty rows and pages; the unit tests cover every
function in `browse.ts`; the existing Browse flows still pass; and
proposal §6 and spec §10's Browse lines are updated in the same commit.

## Feature block: Derive principles from sources (2026-09-14) — done 2026-09-14, the maintainer's own-brain derive included

Asked for by the maintainer: pick a filed source, or several, and at the
press of a button get three to ten principles rationally derived from
it. Built as proposals, never as principles: the model derives, the
curator accepts, edits, or declines each, and a one-tap "Write it as
proposed" makes a pass over a batch fast. Principles stay the curator's
(proposal §2, schema §4.5, §10) because every one that lands was chosen
by the curator's tap on that wording. Four sub-blocks, in order, each a
green commit; tick the block when all four are in.

**Non-goals.** The model never sets `order`: accepted principles land in
the order the curator accepts them, and Sets reorders. Derive proposes
principles only, no amendments, links, or tags. Notes bodies are not
sent, passages are. No automatic derive on filing. Proposal files are
never deleted (declined ones stay, schema §4.7). Nothing runs on the
desktop without an agent: Task E is the desktop form.

### E1. Core: the task, the parser, the batch (M)

- `core/assembly/derive.ts`: `DERIVE_PROMPT` (a constant, like the
  filing prompt), `buildDerivePrompt(snapshot, sourceSlugs, targetSet,
  budgetTokens)`, `parseDeriveReply(text, snapshot, sourceSlugs)`.
- **Context, in order.** The target set's `_set.md` body and its
  existing principles (title and body, with ref comments) so the model
  avoids what the set already says; then each chosen source in full:
  `### Passage: {title} — {author}` with `work`, `year`, and the `raw.md`
  body verbatim, and its slug. Passages are the point: if they alone
  exceed the budget the result is `{ ok: false, error:
  'SOURCES_EXCEED_BUDGET', neededTokens, budgetTokens }`; the existing
  principles are trimmed from the end first, with one line saying how
  many were left out. Attachments are never read.
- **The prompt's rules.** Derive only what the passages support, in the
  curator's voice: each principle one line, a commitment stated plainly,
  no hedging, no quotation as a principle. Three to ten for one source
  by its length and richness; up to twenty for several. Every principle
  names the chosen slugs it rests on, at least one. Nothing the set
  already holds, restated. Rationale: two or three sentences that say
  which passage, and why. Answer as strict JSON:
  `{ "principles": [ { "title": "...", "rationale": "...", "grounds":
  ["slug"] } ] }`.
- **The parser** accepts one to twenty entries; refuses (with a
  `FilingReplyError`-style error naming the entry) a missing or
  multi-line title, an empty rationale, a ground outside the chosen
  slugs, and a title equal to an existing principle's in the target set
  (case-insensitive); drops exact duplicate titles within the reply.
- `core/proposals`: `buildDerive(snapshot, targetSet, entries, opts)` →
  one `CommitBatch`: one proposal file per entry, kind `principle`,
  `target_set`, `grounds` as given, `curated: agent-proposed`, `status:
  open`, ids sequential from `nextProposalId`, no `from_source` (several
  sources may be behind one principle; `grounds` says which); the body
  is the rationale; indexes ride along; message `Derive: {n} proposals
  for {set label}` (schema §7, new). `nowUtc()` for timestamps.
- Tests: the prompt refuses a budget the passages do not fit and trims
  principles before passages; the parser's every refusal; the batch's
  ids, grounds, message, and that `validateBatch` is clean over the
  fixture.

### E2. The format: schema, template, Task E (S)

- Schema §7.12 "Derive proposals": the procedure above; the message
  `Derive: {n} proposals for {set label}` joins the §7 vocabulary and
  CLAUDE.md's list. §4.7: accepting a `principle` proposal "never
  produces the file automatically" becomes: the app pre-fills the
  principle from the proposal, and the curator either edits it or
  writes it as proposed in one deliberate act; either way the result is
  `curated: human`. `from_source` is documented as optional for derived
  proposals, `grounds` carrying the sources.
- `template/AGENTS.md` and the fixture's copy gain **Task E — Derive
  principles from sources**: the same rules, the same output as
  proposal files (one per principle, kind `principle`, grounds = the
  sources, never a principle file), one commit `Derive: ...`, then
  `validate` and `index` before the push. `.claude/commands/derive.md`
  in both.
- `gnomon validate` needs no change; a derived proposal is a proposal.

### E3. One-tap accept on Proposals (S)

- `services/proposals.ts`: `writeAsProposed(brain, p)` → `Decide:` then
  `Add principle:` using the existing pre-fill (title, grounds, body with
  the grounding links and the "written from" line) through
  `createPrincipleIn`; returns the new path. Refuses when the target set
  is gone (beside the button, Decline offered) or a principle with that
  slug already exists in the set (the editor route instead, with the
  reason).
- Proposals screen: a `principle` proposal offers three controls:
  **Write it as proposed** (`data-testid="write-as-proposed"`, one tap,
  stays on Proposals, the row moves to decided with "→ written as"),
  **Accept and edit** (today's editor route, renamed), **Decline**. The
  "not written yet: Write it" affordance stays for an accepted one left
  in the editor.
- Unit tests for the two commits and both refusals; the existing flows
  updated for the new label; a flow that writes one as proposed on both
  engines.

### E4. The app: Derive on Reason, the source picker, the demo model (L)

- Reason gains the task **Derive principles** (`derive`) in the task
  list. Under it: a **source picker** (search field reusing
  `services/browse.ts` matching; results as rows with a checkbox; the
  chosen sources as chips above, removable; at least one), a **target
  set** select listing the sets plus "New set…" with an optional name
  (the set is created first, one `Create principle set:` commit, then the
  derive), the provider and model pickers as today, and the budget bar
  from `buildDerivePrompt` reading "3 passages fit the budget" or the
  refusal.
- The button **Derive** (`use:hold`, "Deriving…"): one completion, not
  streamed (as filing); parse; `buildDerive`; commit; then Proposals
  with the target set's group open and a notice, `data-testid=
  "derived"`: "8 proposals derived from Retire into thyself and Attention
  as generosity. Write each as proposed, edit it, or decline it." A
  parse refusal shows beside the button with the model's reply kept for
  a retry.
- A source page gets **Derive principles from this passage**
  (`data-testid="derive-from"`), which opens Reason with the task and
  that source picked (`#/reason?task=derive&sources=slug`); several
  slugs allowed for Browse later.
- `reasoning` store: the derive selection (sources, target) remembered
  for the session, not the device.
- Mock: `demoDeriveScript` returns three principles per chosen passage
  built from its first sentences, grounds set, so the demo brain and the
  flows exercise the path.
- Flows, both engines: derive three from one source into Set 1 and see
  them on Proposals with the notice and grounds; write one as proposed,
  edit one, decline one, and see the set hold two in accept order with
  their grounds; derive from two sources into a new set and see the set
  created and the proposals under it; the source-page shortcut lands on
  Reason with the source picked; a budget too small refuses before
  sending; a reply with a ground outside the chosen sources is refused
  beside the button. Proposal §6 and spec §8 gain the task.

**Done when** the four sub-blocks are committed green, the maintainer
has derived from a real source in their own brain, and the smoke
checklist gains the step.

## Carried from Phase 3

Open at the close of Phase 3 (2026-09-11); none blocks a Phase 4 block.

- [ ] **npm trusted publishing** — `publish.yml` is ready; saving the
  trusted publisher on npmjs.com (owner `gdfekaris`, repository `gnomon`,
  workflow `publish.yml`, "Allow npm publish") needs interactive WebAuthn
  two-factor, which the maintainer will have once a security key arrives
  (an iPhone passkey would also do). Until then releases are published by
  hand with the granular token in `~/.npmrc`; never put that token in CI.
  After it is configured: delete the token and its npmrc line.
- [ ] **Smoke checklist remainder** (`docs/smoke-checklist.md`) — done on
  the maintainer's iPhone: install, create a brain, capture with a photo,
  connect, file, ratify, the editors. Left: reason from two sets and
  relate a text with the real model, decline and accept a proposal, and
  the desktop round trip through Claude Code with `npx gnomon-cli`.
- [ ] **Storage diagnostics report** — Settings → About now says where
  settings came from at launch (IndexedDB or the localStorage mirror) and
  the last storage failure. The maintainer reports the line after a cold
  relaunch of the installed app. If the mirror is what answers on iOS,
  making localStorage the store of record is a spec §10.2 change for the
  maintainer; the mirror stays a fallback until then.
- [ ] **P2-tokens** — spec §8.2's optional `count_tokens` call when the
  estimate is within 10% of the budget. Still out; revisit only if real
  use shows budgets wrong.
- [ ] **Declined proposals** — the maintainer floated erasing them; they
  stay as files because schema §4.7 makes `status` their whole lifecycle
  and a declined one is the record that stops a re-proposal. The screen
  hides decided ones, five newest first. Reopen only as a schema question.
- [ ] **Filings list depth** — `listFilings` reads fifty commits; "Show
  all n ratified" means within that window. Raise if a brain outgrows it.
- [ ] **Snapshot persistence across launches** (spec §20.1) — none yet;
  cold start on the phone loads everything from GitHub. Measure against
  §16 once the maintainer has a real-sized brain; a tree-only cache
  (paths and shas, no content) is the candidate.
- [ ] **Read-only-token assumptions** in the nightly — a Contents-read-only
  token reports `push: false` and gets 403 on writes; a token without
  Administration gets a 403 from `POST /user/repos`. Unconfirmed; needs
  tokens we do not keep.

## Decisions carried and made

- **A mock provider ships** (Phase 2). Spec §17's flows assume one.
- **Editing a pending filing's metadata makes it yours** (Phase 2): the
  source becomes `human`, so ratify then refuses it as changed.
- **Three skins, one switch** (Phase 3): Monochrome (default), Gray
  bevel, Four-color workbench; tokens in `packages/app/src/app.css`; the
  canvas working files in `docs/design/`.
- **A fourth skin, Synthwave** (2026-09-12): drafted on the canvas as
  Skin D (the shared-pieces sheet, Capture at night and at daybreak),
  then built as one token block; night is its dark theme, daybreak its
  light one. It is the one skin with two faces, so `--font-display`
  exists for headings and the title bar and the other three echo
  `--font` into it.
- **A link proposal is a proposed ground, nothing looser** (2026-09-12):
  schema §4.7 now says so; `related` holds principles and a link
  proposal never touches it. Filing writes the new source into a link
  proposal's `grounds`, the Proposals screen says "Proposes a ground: add
  X to the grounds of Y", the filing prompt asks for links only as
  evidence. The word "relate" is reserved: a later feature may let a
  source be related to a principle as a looser tie than grounding, and
  widening `related` to source slugs is the sketched shape.
- **Links read as their targets; backlinks fold** (2026-09-13): a dual
  link whose markdown label is a kind word (`raw`, `principle`,
  `proposal`) or a bare path renders as the target's title; a label the
  author wrote stays; a notes file reads "Notes on <source title>". The
  files are untouched. A file page's backlinks are one line, "Show n
  backlinks", folded on every visit; "No backlinks yet" when none.
- **A principle proposal carries its source as a ground, and its draft is
  clean** (2026-09-13): filing writes the capture into a principle
  proposal's `grounds`; accepting pre-fills those sources (and
  `from_source`) as the new principle's grounds with their dual links;
  the draft body is the proposal's wording, the grounding passages, and
  the "written from" line, with no instruction text in the field, so an
  unedited draft saves clean. The note that it may be saved as is or
  reworded sits in the panel above the field.
- **Accepting a link proposal adds the ground** (2026-09-12): two
  commits, `Decide:` then `Edit principle:`, the second appending the
  proposal's sources to `grounds` and their dual links to the body; the
  principle's page then says what was added. A source that is a ground
  already gets the decision only; a principle that is gone refuses the
  accept beside the button; a ground that never landed (the head moved
  between the commits) shows "not added yet: Add it" in the decided
  list. The demo model now proposes a ground for the first principle it
  is shown, so the flows and the demo brain exercise it.
- **One Look picker, the OS never consulted** (2026-09-12): Settings
  offers eight looks, four skins in light and dark, Monochrome dark by
  default; "follow the system" is gone and a device that had saved it
  lands on the default theme. The look is remembered on the device.
- **Create-from-template is not pre-probed** (Phase 3): a token that
  cannot create a repository is explained when `POST /user/repos` refuses.
- **Accepting a principle proposal never writes the principle** (schema
  §4.7): the editor opens pre-filled; the draft links back.
- **Both unlisted commit messages kept** (Phase 3, G4): `Scaffold:` and
  `Add proposal:` are in schema §7.
- **Agents touch no other repositories** (CLAUDE.md, 2026-09-10): only
  `gdfekaris/gnomon` and the nightly's `gnomon-scratch*`.
- **Rejected filings and decided proposals are out of the way, not
  erased** (2026-09-11): rejected filings behind "Show n rejected";
  ratified ones five newest with show-all; decided proposals five newest
  with show-all; no Reject on a ratified filing.
- **A principle changes set by copy, not move** (2026-09-11): the editor's
  "Copy to another set" creates it there pre-filled, then offers to delete
  the original with the dangling-reference report. Two §7.9 commits;
  schema §1 rule 1 holds. A one-control move was declined.
- **Settings persistence has a localStorage mirror** (2026-09-11): written
  first, read when IndexedDB throws, hangs, or is empty; the spec's
  IndexedDB keys remain the store of record.

## Notes for whoever resumes

- Conventions still hold: every operation is one `CommitBatch` through
  `BrainService.commit`, which runs `validateBatch` first; index files
  ride along via `withIndexWrites`; `nowUtc()` for timestamps; `$state`
  proxies must be `$state.snapshot`-ed before IndexedDB; prompts are
  TypeScript constants in `core/assembly/prompts/`; an effect that writes
  what it reads must `untrack` the reads or Svelte aborts it.
- Playwright runs from `packages/app`, never the repo root, on four
  projects: `chromium` and `webkit` (iPhone 14 descriptor) over the dev
  server, `pwa` and `pwa-webkit` over a production build in
  `dist-preview/`. Only the built projects see what Vite inlines: assets
  under 4 KB become `data:` URLs, and the CSP's connect-src has no
  `data:`, so never `fetch` an imported `?url` asset (the demo loader
  decodes inline ones).
- `e2e/github-fake.ts` serves `@gnomon/storage/testing`'s `FakeGitHub` to
  the browser through `page.route`, so a flow can drive the real
  `GitHubDriver` end to end. The fake's switches: `canCreate`, `readOnly`,
  `scopes`, `rateLimited`, `secondaryLimited`, `staleRefReads`,
  `staleHistoryReads`, `dropNext`, `beforePatch`, `externalCommit`.
- The GitHub driver, after the nightly's lessons: `head()` answers with
  its own last commit while the ref read still names that commit's parent
  (`lastWrite`); after a write it waits for the commits listing
  (`REF_SETTLE`); it retries a dropped connection (`RETRY_DELAYS_MS`)
  except for `POST /user/repos`; it paces content-generating requests
  under GitHub's 80/minute secondary limit (`CONTENT_RATE`, a constructor
  option the fake-backed tests set to unlimited) and maps that 403 to
  `RateLimitError`. Every request is sent with `cache: 'no-store'`:
  GitHub answers REST reads with `max-age=60`, and a browser served the
  ref and the commits listing from its own cache for a minute, so a
  refresh after two quick commits landed on a head from before both
  (2026-09-11, the maintainer's phone: a principle written from an
  accepted proposal vanished from its set). One nightly run costs about
  260 of the hourly 500 writes: never dispatch it twice within an hour.
- The nightly (`nightly.yml`, 04:17 UTC and on demand) seeds
  `gdfekaris/gnomon-scratch` with a root commit and force-moves main to it
  before each contract test; temporary repositories are
  `gnomon-scratch-<run id>` and are deleted at the end, leftovers too.
  The secret `GNOMON_TEST_TOKEN` is a fine-grained token with Contents
  and Administration on all repositories, short expiry; when it lapses
  the run fails on `GET /user` and a new token is the whole fix.
- Settings → About lists the build commit (`__GNOMON_BUILD__` from
  `GITHUB_SHA`), where settings came from, the last storage failure,
  storage persistence, the brain's head or load error, and the service
  worker state. Ask the maintainer for that line before guessing at a
  device problem.
- Errors belong next to the control that failed, never at the foot of a
  screen: a phone never sees the foot.
- The maintainer's UX pass of 2026-09-11 (17 commits after e20fa5c) set
  three conventions that later screens must keep. The app speaks its own
  words for the schema's states: `human` is "yours", `ratified` is
  "ratified", `agent-proposed` is "awaiting review", a capture is "not
  filed" or "filed as"; the files keep the schema's words. Every action
  button carries `use:hold={busy}` (`src/lib/press.ts`), which draws it
  pressed until its work ends; a screen with one busy flag across several
  controls remembers which was pressed. Inside `.content` any token may
  break and grid or flex items may shrink, but a button never does. The
  Browse tab is sources only; sets, captures, and proposals live on their
  own tabs. The icon is the "Titanium dial" from `tools/make-icons.mjs`
  (2026-09-12, a rendered cybernetic sundial chosen from four drafts on
  the canvas's Tile page; it replaced the one-bit "Noon" mark). The Inbox
  review panel carries the edit links for a pending filing's source and
  notes (2026-09-12): an editor opened with `?back=<in-app hash>` returns
  there on Save and on Back, and `#/inbox?filing=<slug>` shows that filing
  open on arrival; the edit still makes the file yours, as decided in
  Phase 2.
- The demo brain accepts `#/settings?demo-omit=a,b` to drop paths. Its
  git history is one seed commit, so the fixture's own pending filing
  does not appear in the Inbox's filing list. Proposal ids and timestamps
  use the real clock; tests that assert ids must be date-agnostic.
