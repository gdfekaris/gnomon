# Proposal: commit audit

2026-10-05. Proposed by the maintainer; corrected and worked through in a
Claude Code session the same day. Part 1 is the proposal as corrected.
Part 2 is that session's answer to the five-step kickoff: the rule table,
the open questions, placement, fixtures, and a draft spec section and
tracker blocks. The maintainer accepted V1 to V5 on 2026-10-05 and block
A1 put them into the schema and AGENTS.md; the rest of Part 2 stays a
draft until its own block moves it into the spec.

---

# Part 1 — the proposal

A check that reads a brain's git history and flags any commit whose diff
changes something its declared operation does not allow. Today agents are
kept out of `human` files by AGENTS.md; this makes that rule something the
curator can verify.

This is not new scope. Schema §5 and §10 already say the app "flags such
commits for mandatory review" (alignment-review 1.15), and AGENTS.md
repeats it under Hard rules. Nothing implements it. The audit pays that
debt.

## Goal and threat model

The audit makes tampering visible after the fact; it does not prevent it.
The adversary is an agent with write access to the brain that ignores
AGENTS.md, by mistake or by design.

In scope, the audit flags:

- a commit whose diff goes beyond what its declared operation allows (a
  `File:` commit that edits more than `status` and `filed_as` on the
  capture, for example);
- a commit whose message is in no operation's vocabulary;
- a moved file (schema §1 rule 1);
- a merge commit, which no procedure produces (schema §7: one commit on
  `main`).

Out of scope, stated as known limits:

- an agent that labels its commit with an operation whose allowance covers
  the edit (impersonation, §2.2 Q1); the audit lists such operations for
  the curator to confirm, it cannot tell who made them;
- changes never committed;
- history rewritten before the first audit (later rewrites are caught by
  the anchor, §2.2 Q5).

## The frame: shape, not author

Who made a commit does not decide whether it is allowed. Agents
legitimately write `Capture:`, `File:`, `Decide:`, `Derive:`, `Relate:`,
and `Index` (AGENTS.md session discipline, schema §7.12, §7.15,
alignment-review 2.5a); the app writes `File:` too. Each operation has an
allowance on the diff (which paths may be added, modified, or deleted,
which fields may change, whether bodies may change) and the audit
compares the diff to it. Authorship enters only as a list: the operations
no agent ever emits, which the curator confirms.

## Behavior

1. **Range.** From the anchor (the last audited head, stored outside the
   repo) to `HEAD`; with no anchor, from a baseline the curator names
   (`--since <rev>`), since real brains carry history from before the
   format (geo-brain-2) or a host's initial commit before `Scaffold:`.
2. **Parse the message** to one operation. No match is an
   *unrecognized* finding: the curator's own hand edits land here by
   design (schema §4.5 expects `order` edited by hand), so it is
   acknowledged, not treated as tampering.
3. **Compute the change set:** paths added, modified, deleted; for
   markdown, frontmatter field by field and the body as a whole.
4. **Compare** against the operation's allowance (§2.1).
5. **Report** one line per finding (commit, operation, path, what fell
   outside), `--json` for CI, nonzero exit on any violation or
   unrecognized commit, then the list of curator-only operations in range.

Where it runs: the CLI (`gnomon audit`), the brain's CI if the curator
wants it, and the app when it loads new commits (the §5 promise). A check
inside the app's write path alone would miss an agent writing straight to
git.

---

# Part 2 — the design session

## 2.0 Vocabulary gaps — decide these first

The code commits messages the schema does not list, and the schema names
operations the code does not have. The rule table needs one vocabulary.
None of these reopens a decision in `alignment-review.md`.

| # | Gap | Recommendation |
|---|---|---|
| V1 | The app commits `Edit principle: <title>`, `Edit source: <slug>`, `Edit notes: <slug>`, `Update principle set: <label>`, `Reorder principles: <label>`, `Reorder principle sets`, `Delete principle: <title>` (core `sets`, app `services/edit.ts`). Schema §7.2, §7.3, §7.9 say "one commit" with no message; edits have no procedure at all. | Adopt the code's messages into schema §7 as they stand; they are already in real brains. Add a short §7 entry for the three edits. |
| V2 | AGENTS.md's message list (session discipline, rule 2) omits `Relate:`, though §7.15 lets a desktop agent run Task F. | Add `Relate: <n> proposals for <set label>` to the list. |
| V3 | Schema §4.6 says the app deletes a capture "when the curator explicitly clears it". No code does, and no message exists. | Name it now, `Clear: <stem>` (deletes `inbox/<stem>.md` and its attachment, only when filed and ratified or unfiled after a rejection), so the audit has a rule the day it is built. Or strike the sentence. |
| V4 | AGENTS.md says `git pull`. A desktop session that races the phone then makes a merge commit. | `git pull --rebase`. The audit reports merges; this keeps sessions from making them. |
| V5 | Commits outside every vocabulary: the host's initial commit, the curator's hand edits on desktop, GitHub web edits. | An *unrecognized* finding, acknowledged by moving the anchor past it (`gnomon audit --ack`). Not a violation, but it still fails the exit code until acknowledged, so nothing slips by unseen. |

## 2.1 Operation rules

Universal rules, applied to every commit before the operation's own:

| # | Rule | Source |
|---|---|---|
| U1 | `principles/_index.md` and `maps/_index.md` may change only to equal `generateIndexes` of the tree after the commit. `Capture:`, `File:`, and the three encryption operations change neither. | §1 rule 3, §4.8, §7.5, §7.6 last line, §7.17; spec §7.2 |
| U2 | `created` never changes; `updated` may change on any modified file. | §4.1 |
| U3 | `raw.md` body of a `human` or `ratified` source never changes; `original.<ext>` never changes. | §4.2, §9 |
| U4 | Nothing under `.gnomon/` changes except in the encryption operations. | §10, §7.17 |
| U5 | No operation allows deleting a path and adding one with the same content, so a move is always a violation, reported as "moved" when blobs match. | §1 rule 1 |
| U6 | A merge commit is reported; its non-merge parents are audited on their own, and a conflict resolution (a merge diff equal to neither side) is a violation. | §7 preamble, §10 |
| U7 | On an encrypted brain, a changed body ciphertext is a changed body. Holds because the wrapper and `gnomon encrypt` keep ciphertext when plaintext is unchanged. | spec §6.4 (review view paragraph); `cli/src/crypt.ts` |

Per operation. "Agent" in *Emitted by* means AGENTS.md permits it; every
operation without "agent" is curator-only and goes on the confirm list.
"+ idx" means indexes may change under U1.

| Operation (message) | Emitted by | Add | Modify | Delete | Source |
|---|---|---|---|---|---|
| `Capture: <stem>` | app, agent | `inbox/<stem>.md` (`type: inbox`, `curated: human`, `status: unfiled`); optionally `inbox/<stem>.<ext>` | — | — | §7.5, §4.6 |
| `File: <slug>` | app, agent | `sources/<slug>/raw.md` (`agent-proposed`, `inbox_ref` = the capture, body byte-identical to the capture's); `notes.md` (`agent-proposed`); optionally `original.<ext>` byte-identical to the capture's attachment; any number of `maps/proposals/P-*.md` with `kind: principle`, `target_set: _reserve`, `from_source: <slug>`, `<slug>` in `grounds`, `agent-proposed`, `open` | the one capture named by `inbox_ref`: `status` unfiled → filed and `filed_as: <slug>`, nothing else (not `updated`; the code leaves it) | — | §7.6, §4.6, §4.2; spec §7.6 |
| `Ratify: <slug>` | curator | — | `sources/<slug>/raw.md` and/or `notes.md`: `curated` agent-proposed → ratified, `updated`; at least one | — + idx | §5, §7.7; spec §9 |
| `Reject: <slug>` | curator | exactly the inverse of the latest `File: <slug>` diff | | | §5, §7.7; spec §9 |
| `Decide: <id>` | app, agent (curator's decision) | — | `maps/proposals/<id>.md`: `status` open → accepted or declined, `updated` | — + idx | §7.10, §4.7, alignment 2.5a |
| `Keep: <n> proposals in reserve` | curator | n principles in `principles/_reserve/` (`set: _reserve`, no `order`, `human`) | n proposals with `kind: principle`, `target_set: _reserve`: open → accepted | — + idx | §7.16 |
| `Decline: <n> proposals` | curator | — | n proposals: open → declined | — + idx | §7.16 |
| `Add proposal: <id>` | curator | one proposal, `curated: human`, `status: open` | — | — + idx | §7.11 |
| `Derive: <n> proposals for <label>` | app, agent | n proposals: `kind: principle`, `target_set` = the set, `grounds` ≥ 1, no `from_source`, `agent-proposed`, `open` | — | — + idx | §7.12 |
| `Relate: <n> proposals for <label>` | app, agent (V2) | n proposals: `kind` link, amendment, or principle; `target_set` = the set; no `from_source`; `agent-proposed`, `open` | — | — + idx | §7.15 |
| `Add principle: <title>` | curator | one principle in a set at `order` = count + 1, or in the reserve with no `order`; `human` | — | — + idx | §7.9, §7.14 |
| `Reserve principle: <title>` | curator | one principle in `principles/_reserve/` | — | — + idx | §7.14 |
| `Place principle: <title> in <label>` | curator | one principle in the set at count + 1 | — | — + idx | §7.14 |
| `Delete principle: <title>` (V1) | curator | — | `order` only, on principles of the same set below it | one principle file + idx | §7.9 |
| `Reorder principles: <label>` (V1) | curator | — | `order` (and `updated`) on principles of one set; result 1..N | — + idx | §7.9 |
| `Edit principle: <title>` (V1) | curator | — | one principle: `title`, `grounds`, `related`, `tags`, body; never `set`, `order`, `curated` | — + idx | §4.5; also the second commit of accepting a link proposal |
| `Create principle set: <label>` | curator | `principles/<slug>/_set.md`, `order` = N + 1, `human` | — | — + idx | §7.1 |
| `Update principle set: <label>` (V1) | curator | — | one `_set.md`: `name`, body | — + idx | §7.2 |
| `Reorder principle sets` (V1) | curator | — | `order` on `_set.md` files; result 1..N | — + idx | §7.3 |
| `Delete principle set: <label>` | curator | — | `order` − 1 on every later set | one set folder, every file in it + idx | §7.4 |
| `Edit source: <slug>` (V1) | curator | — | one `raw.md`: `title`, `author`, `work`, `year`, `locator`, `origin`, `tags`; `curated` → human; body unchanged | — + idx | §4.2, §5 |
| `Edit notes: <slug>` (V1) | curator | — | one `notes.md`: body; `curated` → human | — + idx | §4.3, §5 |
| `Scaffold: template` | app | the template tree, onto a host commit | — | — | §7.1 last paragraph |
| `Scaffold: <path>` | app | that path (a folder as its `.gitkeep`) | — | — | §7.8 |
| `Index` | app, agent | — | the index files only (U1) | — | AGENTS.md rule 3, §7.8 step 3, §7.13 |
| `Encrypt: <n> files` | curator | `.gnomon/encryption.json` | n bodies to ciphertext; frontmatter byte-identical | — | §7.17; spec §6.4 |
| `Decrypt: <n> files` | curator | — | n bodies to plaintext; frontmatter byte-identical | `.gnomon/encryption.json` | §7.17 |
| `Change passphrase` | curator | — | every body re-sealed; `.gnomon/encryption.json`; frontmatter byte-identical | — | §7.17 |
| `Clear: <stem>` (V3) | curator | — | — | `inbox/<stem>.md` and its attachment | §4.6 |

Where the schema is silent or ambiguous:

- **Proposal counts.** §7.6 says "at most four", §7.12 "at most twenty",
  §7.15 "at most ten". These read as guidance to the model; the app does
  not enforce them. Recommendation: a warning, not a violation.
- **`updated` on the filed capture.** §4.1 says `updated` is "rewritten on
  every content change"; `buildFiling` leaves it alone and §4.6 says the
  two fields are the only ones an agent may write. The rule follows §4.6:
  `updated` must not change. Worth a line in §4.6.
- **Byte-identical `raw.md` on an encrypted brain.** The ciphertext is
  bound to its path (AAD), so the inbox and source ciphertexts always
  differ. Without the key the audit cannot prove the copy; it says so in
  one note, as `validate` does (§9 last paragraph). With
  `GNOMON_PASSPHRASE` it can.
- **Edits on desktop.** The schema lets the curator edit by hand
  (`order`, notes) but gives no message; V5 covers these.

## 2.2 Open questions

**Q1. Impersonation.** An agent can write `Ratify:` or `Edit principle:`
with a diff that fits, and git's author field proves nothing.
Recommendation: accept the gap and say so, with one mitigation: every
report ends with the curator-only operations in range ("12 commits since
your last audit were curator operations: Ratify: aurelius-…, Edit
principle: …"), and the app shows the same list. The curator confirms
what they recognize; an agent wearing a curator label becomes "a change I
don't remember making", which is the most the evidence can support.
Tradeoff: the claim is "every commit fits its label, and you saw every
curator-labelled one", not "no agent did a curator's act". Signing would
close the gap, at a price: a signing key the app holds in the browser
(IndexedDB, beside the remembered passphrase key) and a GitHub commit
path that accepts a signature, a key on every desktop the curator hand-
edits from, and a rule that agents never get it. That is a lot of
ceremony for one person's brain, and it can come later without changing
the rule table. Reopens nothing.

**Q2. Ownership.** Settled: the `curated` field, read with `type`
(§4.1, §5). `principle`, `principle-set`, `inbox` are always `human`;
sources and notes move agent-proposed → ratified → human; proposals are
outside the machine. Ownership changes only in `Ratify:` and the two edits.

**Q3. The clerical fields.** Settled: `status` (unfiled → filed) and
`filed_as` (the slug the same commit adds), §4.6, §7.6 step 6.

**Q4. Encrypted brains.** No passphrase needed for almost everything:
frontmatter stays cleartext, and U7 makes ciphertext comparison a valid
body comparison. The one exception is the byte-identical copy above.
Tradeoff: none worth stating; confirmed in code.

**Q5. Rewritten history.** In scope, cheaply: the anchor is the last
audited head, kept outside the repo (CLI: the user's config directory,
keyed by the brain's root commit; app: IndexedDB per brain). If the
anchor is no longer an ancestor of `HEAD`, the audit fails with "history
was rewritten since <date>". Must not live in `.gnomon/`, which an agent
can write. Tradeoff: a fresh clone or a new device starts without an
anchor and needs `--since`.

**Q6. History shape.** Merges: U6, plus V4 to prevent them. Reverts:
only `Reject:`, checked as an exact inverse; any other revert is
unrecognized. Empty commits: unrecognized unless the message matches,
and then allowed (an `Index` that changed nothing is harmless; the app
never makes one).

**Q7. Command surface.** A separate `gnomon audit`. `validate` is a
point-in-time check that every agent runs before every push; one old
violation in history would fail it forever, and history needs a range and
an anchor that `validate` has no use for.

**Q8. Reference parity.** Yes. `tools/gnomon-check.py --audit <rev>`
reads the same rule table (JSON, §2.3) and implements the named checks
itself. The cross-check test already runs both over the fixture; it runs
both over every fixture history too.

**Q9. Placement.** §2.3.

**Q10. Phase.** Phase 5. Phase 4's last blocks (7 and 8) are waiting only
on the maintainer's AWS test; folding a medium-sized new feature into it
would keep it open for no reason. The audit is a natural first block of
Phase 5.

## 2.3 Where the code lives

**Core, `core/audit`** (pure, no Node, no DOM):

- `rules.json`: the operation table of §2.1 as data (message pattern,
  emitters, add/modify/delete path patterns, allowed fields per type,
  body allowed or not, index allowed or not, and the name of any extra
  check). JSON so that TypeScript imports it and the Python reference
  reads it; core's tsconfig takes `resolveJsonModule`.
- Named checks for what a table cannot say: `rejectIsInverse`,
  `keepPairsProposals`, `orderContiguous`, `rawCopiesCapture`,
  `indexesRegenerate`.
- `auditCommit(commit, before, after): Finding[]` and
  `auditRange(source, range): AsyncIterable<Finding>`.

The interface core needs, beside `FileChange` and `CommitInfo` in
`schema/types`:

```ts
export interface HistorySource {
  /** Commits after `since` (exclusive) up to `until`, oldest first, with parents. */
  commits(since: string | null, until: string): AsyncIterable<{ sha: string; parents: string[]; message: string }>;
  /** Paths added, modified, deleted between a commit and its parent; renames as delete + add. */
  changes(parent: string | null, sha: string): Promise<FileChange[]>;
  /** File contents at a commit; absent paths are missing from the map. */
  readAt(sha: string, paths: string[]): Promise<Map<string, string | Uint8Array>>;
  /** Every path at a commit, for U1's regeneration. */
  listAt(sha: string): Promise<string[]>;
  isAncestor(a: string, b: string): Promise<boolean>;
}

export interface Finding {
  sha: string;
  op: string | null;          // null when unrecognized
  kind: 'violation' | 'unrecognized' | 'merge' | 'warning';
  path?: string;
  detail: string;             // what fell outside the allowance
}
```

U1 is the expensive rule: it needs every frontmatter at each commit. It
runs only on commits that touch an index file, and the CLI reads with
`git cat-file --batch`, so a brain of a few thousand files stays seconds.

**Implementations:**

- CLI: a `GitHistory` beside `WorkingTreeDriver` (`git rev-list`,
  `git diff-tree --no-renames`, `git cat-file --batch`,
  `git merge-base --is-ancestor`).
- `packages/storage`: the GitHub driver already has `history` and
  `compare`; `readAt` needs `readMany` to take a ref, which its GraphQL
  query already expresses (`"<sha>:<path>"`). `MemoryDriver` keeps its
  commits so unit tests can audit what core builders produced.

**CLI:** `gnomon audit [--since <rev>] [--ack] [--json]`. Anchor in
`$XDG_CONFIG_HOME/gnomon/audit.json`. `--ack` moves the anchor to `HEAD`
after printing.

**Reference:** `tools/gnomon-check.py --audit <since>`, reading
`packages/core/src/audit/rules.json` and shelling to git.

**App:** after loading new commits, audit from the stored anchor; a
flagged commit gets the "needs your review" treatment §5 promises, next to
the commit in the Inbox's history list, and the curator-only list is
shown in Settings → About or a small Audit panel. Errors next to the
control, per the conventions.

## 2.4 Fixtures

Fixtures are histories, not trees: each is a short script (start from
`packages/core/fixtures/brain`, apply commits) that a test helper replays
into a temporary git repo for the CLI and the reference, and into
`MemoryDriver` for core. `template/` and the fixture brain have no brain
history of their own (they live in the monorepo), so they are starting
points, not clean histories.

**Seeded violations, one bad commit each, exactly one finding expected:**

1. `File:` that edits the capture's body.
2. `File:` that writes the capture's `note`.
3. `File:` that also edits a principle.
4. `File:` whose `raw.md` body differs from the capture's by one byte.
5. `File:` whose `original.<ext>` differs from the capture's attachment.
6. `File:` that writes a proposal with `target_set` other than `_reserve`.
7. `Index` that touches a note.
8. `Index` whose index file is not the generator's output.
9. `Capture:` that also changes an index file.
10. An unrecognized message ("fix stuff").
11. A moved file (`git mv` a principle into another set).
12. A reserve done as one commit that moves the file.
13. `Ratify:` that also edits a principle body (a curator label over an
    agent's change set).
14. `Ratify:` that flips `curated` on a principle.
15. `Decide:` that also rewrites the proposal's title.
16. `Decline:` that touches a principle.
17. `Reject:` that is not the inverse of its filing (leaves `notes.md`).
18. `Derive:` that writes a principle file.
19. `Edit source:` that changes a ratified `raw.md` body.
20. `Keep: 2 proposals` that accepts two but writes one principle.
21. `Reorder principles:` that leaves a gap.
22. `Encrypt:` that changes frontmatter.
23. A non-encryption commit that writes `.gnomon/encryption.json`.
24. A change to `created`.
25. A merge commit with a conflict resolution.
26. Encrypted brain: `File:` whose capture body ciphertext changed.
27. Anchor no longer an ancestor (history rewritten after the audit).

**Clean, zero findings expected:**

- C1. Every core builder replayed in sequence on `MemoryDriver`: capture,
  file, ratify, reject, decide, keep, decline, add proposal, derive,
  relate, add/reserve/place/edit/reorder/delete principle,
  create/update/reorder/delete set, edit source and notes, scaffold,
  index. A failure here is a bug in the table or in the app.
- C2. C1 on an encrypted brain, plus encrypt, change passphrase, decrypt.
- C3. A desktop session in git: `Capture:`, `File:`, `Decide:`,
  `Derive:`, `Relate:`, `Index`, each wrapped by `gnomon encrypt` as
  AGENTS.md asks on an encrypted brain.
- C4. The brains the Playwright flows produce, audited at the end of each
  flow.
- C5. A legacy prefix (free-form commits) before `--since` is ignored.
- C6. The maintainer's brain-1, locally, from a baseline they choose.
  Never pushed anywhere by the agent; geo-brain-2 is all pre-format and
  is not a useful clean case.

**Parity:** the CLI and the reference report the same findings, by sha,
kind, and path, on every fixture above except C4.

**CI:** fixtures 1–27 and C1–C3, C5 run in the existing unit and
cross-check jobs; C4 in the Playwright jobs.

## 2.5 Draft spec section (for review; not yet in the spec)

To become technical spec §9.1, "Commit audit", once §2.0 is decided, with
the vocabulary changes landing in schema §7 and AGENTS.md first.

> **§9.1 Commit audit.** `core/audit` checks that every commit in a range
> fits the operation its message declares (Schema §7). The operations and
> their allowances are data, `core/audit/rules.json`, read by core and by
> the reference checker. For each commit: parse the message to an
> operation (none: an *unrecognized* finding); list the change set from
> `HistorySource.changes`; apply the universal rules (indexes equal the
> generator's output, `created` and immutable bodies and attachments
> unchanged, `.gnomon/` only in encryption operations, no move, no merge)
> and the operation's allowance, field by field on frontmatter and whole
> on bodies; run the operation's named checks. On an encrypted brain a
> changed ciphertext is a changed body (§6.4); the one rule that needs
> plaintext, `raw.md` copying its capture, stands aside without the key
> and says so.
>
> The audit cannot tell who made a commit. It reports, after the
> findings, every commit in range whose operation no agent may emit, for
> the curator to confirm. The anchor (last audited head) lives outside the
> brain, in the CLI's config directory and the app's IndexedDB; an anchor
> that is no longer an ancestor of `HEAD` fails the audit.
>
> Entry points: `gnomon audit [--since <rev>] [--ack] [--json]` (exit 1
> on any violation, merge, or unacknowledged unrecognized commit); the
> app, on loading new commits, which marks a flagged commit for review
> (Schema §5, §10); `tools/gnomon-check.py --audit`.

## 2.6 Draft tracker blocks (Phase 5)

- [x] **A1. Vocabulary** (S) — done 2026-10-05. V1–V5 in schema §7
  (§7.2, §7.3, §7.8, §7.9, §7.13, new §7.18 edits and §7.19 `Clear:`, the
  §7 preamble on commits outside the vocabulary) and §4.6 (`updated`
  stays); AGENTS.md in the template and the fixture (`Relate:`,
  `git pull --rebase`). Core's batch decide declined only: its unused
  `Accept: <n> proposals` had no schema operation (a batch accept is
  `Keep:`), so it is now `declineProposals`. `core/test/vocabulary.test.ts`
  checks every message the code builds, and every one AGENTS.md gives an
  agent, against the heads named in schema §7.
- [ ] **A2. Core audit** (M) — `core/audit`, `rules.json`, the named
  checks, `HistorySource`; `MemoryDriver` keeps commits. Done when C1 and
  C2 pass and fixtures 1–24 and 26 each yield exactly their finding in
  unit tests.
- [ ] **A3. `gnomon audit`** (M) — `GitHistory`, the anchor, `--since`,
  `--ack`, `--json`, the curator-only list; fixture histories replayed
  into temporary git repos. Done when all fixtures pass in CI and the
  maintainer runs it on brain-1 from a baseline with zero violations (or
  each one explained). Release as `gnomon-cli` 0.3.0.
- [ ] **A4. Reference parity** (S) — `gnomon-check.py --audit` over
  `rules.json`; the cross-check test compares findings. Done when CI
  compares the two on every fixture.
- [ ] **A5. The app** (M) — `readMany` at a ref in the GitHub driver,
  audit from the IndexedDB anchor on refresh, flagged commits marked for
  review in the Inbox history, the curator-only list; Playwright C4 on
  both engines. Done when a flagged commit planted in the demo brain
  shows on the iPhone project, and the maintainer sees the curator list
  for brain-1 on the phone.

Order: A1, then A2; A3 and A4 in either order; A5 last and optional (the
CLI alone delivers the check; the app keeps the schema's promise). Cost
overall: medium, about the size of Phase 4 block 4.
