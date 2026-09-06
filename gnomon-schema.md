# Gnomon — Brain Format Schema

**Repository layout, identifiers, frontmatter contract, link format, and maintenance procedures**

Version 0.2 — Companion to Product Proposal v0.2 and Technical Specification v0.1
September 2026

*Changes from 0.1, keyed to `alignment-review.md`: principles carry an `order` field (2.1); one passage per capture with an optional attached source file (2.3c); proposals are one file each under `maps/proposals/` (3.2); the filing commit marks the inbox item and `filed_commit` is gone (3.1); index frontmatter is `type: index` only (3.3); the template ships a fixed Set 1 slug (3.4); the flat-principles repair is removed and the app never moves a file (3.6); `.gnomon/` is reserved (3.10.6); `captured` is dropped (3.10.8); the desktop CLI is `gnomon-cli` and brains carry no `package.json` (2.6, 3.8); renamed to Gnomon throughout (§4).*

---

## 1. Scope and principles

This document defines the on-disk format of a brain repository. It is the contract shared by the Gnomon companion app, `AGENTS.md`, the `gnomon-cli` desktop tool, and any agent that operates on a brain. Anything not defined here is unspecified and must not be relied upon.

Three design rules govern every decision below:

1. **Files never move.** Once created, a file's path is permanent. Ordering, naming, and grouping that the user can change are expressed in frontmatter, never in paths. This keeps every link valid forever and keeps git history contiguous. The app performs no move operation, without exception.
2. **Frontmatter is the machine surface; the body is the human surface.** Every fact the app or an agent needs to act on (curation state, set membership, ordering, grounding, filing status) lives in frontmatter so it can be read without parsing prose. Bodies are for people and models.
3. **Generated files are disposable.** Anything that can be regenerated from other files is marked generated, is never hand-edited, and is never edited by agents. There is one generator (the `index` module of the shared library) with two entry points: the app, on every write, and `gnomon-cli index`, on desktop.

## 2. Repository layout

```
<brain-root>/
├── AGENTS.md                     # agent protocol (procedural enforcement)
├── README.md                     # human orientation; links to AGENTS.md
├── .gnomon/                      # RESERVED: app metadata (e.g. encryption.json); may be absent
├── inbox/
│   ├── <stem>.md                 # a capture, unfiled or filed
│   └── <stem>.<ext>              # optional: the capture's attached source file
├── sources/
│   └── <source-slug>/
│       ├── raw.md                # the captured passage, verbatim — IMMUTABLE
│       ├── notes.md              # curator marginalia — editable
│       └── original.<ext>        # optional: the attached source file — IMMUTABLE
├── principles/
│   ├── _index.md                 # GENERATED: sets and principles; desktop agents start here
│   └── <set-slug>/
│       ├── _set.md               # principle set descriptor
│       └── <principle-slug>.md   # one principle
├── maps/
│   ├── _index.md                 # GENERATED: master index of the brain
│   └── proposals/
│       └── P-<date>-<nnn>.md     # one agent suggestion per file
└── templates/
    ├── raw.md
    ├── notes.md
    ├── principle.md
    ├── set.md
    ├── inbox.md
    └── proposal.md
```

A brain is valid when `AGENTS.md`, the five top-level folders (`inbox`, `sources`, `principles`, `maps`, `templates`), and at least one principle set exist. `maps/proposals/` is created by whoever writes the first proposal and is not required for validity. The app's connect-time validator (US-15) checks exactly this list and offers to add anything missing; it never moves or rewrites existing content.

A brain contains no `package.json`, lockfile, or `node_modules/`. Desktop tooling is the published `gnomon-cli` package, run as `npx gnomon-cli <command>` (or `gnomon <command>` once installed); the brain itself stays plain markdown plus attachments.

## 3. Identifiers

### 3.1 Source slugs

`<source-slug>` is a human-readable, URL-safe slug derived from author surname and a short title fragment: lowercase ASCII letters, digits, and hyphens; 3–60 characters; no leading or trailing hyphen. Examples: `aurelius-meditations-4-3`, `didion-why-i-write`.

Uniqueness is per repository. On collision, append `-2`, `-3`, etc. The agent (or the app) proposes the slug during filing; the curator may rename **only by rejecting the filing commit** and re-filing, never by moving the folder.

One source folder holds **one capture**: whatever text was captured, whether a sentence or a whole essay, and at most one attached file. Several captures from the same work are separate folders sharing the same `work` and `author` values, which is how the index groups them.

### 3.2 Principle set slugs

`<set-slug>` is a stable, non-semantic identifier:

```
ps-<4 chars from the alphabet 23456789abcdefghjkmnpqrstuvwxyz>
```

The alphabet omits `0 1 o i l` to avoid transcription ambiguity. The app draws randomly and re-draws on collision with any existing folder under `principles/`. The slug is never displayed as the set's label; users see the set's ordinal and optional name (§4.4). The slug appears only in paths and links.

**Set 1 has a fixed slug in every brain: `ps-g8xw`.** The template ships it, so the template, every fresh brain, every test fixture, and every desktop clone is a valid brain as-is. Slugs need uniqueness only within one repository, so this collides with nothing.

Agents never create sets and therefore never generate set slugs. A user creating a set by hand on desktop follows the same pattern; the app accepts any folder under `principles/` that contains a valid `_set.md`.

### 3.3 Principle slugs

`<principle-slug>` follows the same character rules as source slugs and is derived from the principle's title. Uniqueness is **per set**; two sets may each contain `courage-before-comfort.md`. The fully qualified reference is always `<set-slug>/<principle-slug>`.

### 3.4 Inbox stems and attachment filenames

An inbox capture's stem is `<YYYYMMDD>-<HHMMSS>-<3 chars from the §3.2 alphabet>`, UTC. The capture is `inbox/<stem>.md`; its attachment, if any, is `inbox/<stem>.<ext>` where `<ext>` is the attached file's lowercase extension. Example: `inbox/20260905-143012-x7q.md` and `inbox/20260905-143012-x7q.pdf`. Inbox files are never renamed; a filed capture is marked `status: filed` and left in place.

In a source folder the attachment is always named `original.<ext>`. The name `original` is reserved (§10).

### 3.5 Proposal ids

`P-<YYYYMMDD>-<nnn>`, sequential within the UTC day across the whole `maps/proposals/` folder. Example: `P-20260905-003`. The writer scans existing files for the day's highest `<nnn>` and adds one; two devices drawing the same id at once is resolved by the commit's head check, and the loser re-draws.

## 4. Frontmatter contract

All `.md` files except `AGENTS.md`, `README.md`, and `templates/*` carry YAML frontmatter delimited by `---`. Field names are lowercase snake_case. Dates are ISO 8601 (`2026-09-05` or `2026-09-05T14:30:12Z`). Lists use YAML flow or block syntax; the app writes block syntax. Attachments carry no frontmatter; they are opaque bytes.

### 4.1 Common fields

| Field | Required | Values | Notes |
|---|---|---|---|
| `type` | yes | `source`, `notes`, `principle`, `principle-set`, `inbox`, `proposal`, `index` | Discriminator; the app dispatches on it. |
| `curated` | yes except `index` | `human`, `agent-proposed`, `ratified` | See §5. |
| `created` | yes except `index` | datetime | Set once at creation. |
| `updated` | yes except `index` | datetime | Rewritten on every content change. |
| `tags` | no | list of slugs | Free vocabulary; lowercase, hyphenated. |

`type: index` files carry `type` and nothing else (§4.8).

### 4.2 `sources/<slug>/raw.md` — `type: source`

| Field | Required | Notes |
|---|---|---|
| `title` | yes | Short label for the capture, curator-facing. |
| `author` | yes | As printed; `unknown` permitted. |
| `work` | no | Title of the book, essay, article, etc. Shared across captures from the same work. |
| `year` | no | Year of the work. |
| `locator` | no | Page, section, timestamp, or URL fragment identifying where the passage sits in the work. |
| `origin` | no | URL, ISBN, DOI, or other retrieval handle. |
| `inbox_ref` | yes if filed from inbox | Stem of the inbox capture the passage came from. |
| `attachment` | yes if an attachment exists | `original.<ext>`; the file must exist beside `raw.md`. |
| `curated` | yes | `agent-proposed` when filed by an agent or by the app's filing flow; `human` when created by hand; becomes `ratified` on approval. |

**Body:** the captured text, verbatim, with no editorial marks. When filed from the inbox the body is byte-identical to the inbox capture's body; the filer copies it and never retypes, trims, or selects from it. The body is immutable once the file's curation state is `human` or `ratified`. While `agent-proposed`, the only permitted change is rejection (revert of the filing commit). The app never presents an editor for a `raw.md` body; `AGENTS.md` forbids agents from modifying one.

**Attachment:** `original.<ext>` is immutable from creation in every state. It is a byte-identical copy of the inbox attachment. Nobody edits, converts, or replaces it; a wrong attachment is corrected by rejecting the filing.

### 4.3 `sources/<slug>/notes.md` — `type: notes`

| Field | Required | Notes |
|---|---|---|
| `source` | yes | The parent source slug (redundant with the path; used for validation). |
| `curated` | yes | Stubbed as `agent-proposed`; `ratified` alongside its `raw.md`; becomes `human` the first time the curator edits it. |

**Body:** free marginalia. Corrections to the passage (typos in the original, context, translation notes) go here, never into `raw.md`. Cross-references use the dual-link format (§6).

### 4.4 `principles/<set-slug>/_set.md` — `type: principle-set`

| Field | Required | Notes |
|---|---|---|
| `order` | yes | Positive integer; the user-visible ordinal ("Set 2"). Contiguous across all sets: 1..N with no gaps. |
| `name` | no | Optional sub-name ("Work", "Parenting"). Displayed as "Set 2 — Work". |
| `curated` | yes | Always `human`. |

**Body:** an optional description of what this set is for, written by the curator. Included verbatim in every reasoning prompt that selects the set, so it doubles as the set's framing instruction to the model.

**Display rule:** the label is `Set {order}` when `name` is absent and `Set {order} — {name}` when present. The slug is never part of the label.

### 4.5 `principles/<set-slug>/<principle-slug>.md` — `type: principle`

| Field | Required | Notes |
|---|---|---|
| `title` | yes | The principle in one line. |
| `set` | yes | The parent set slug (redundant with the path; used for validation and for detecting misplaced files). |
| `order` | yes | Positive integer; precedence within the set. Contiguous 1..N across the set's principles. Lower governs on conflict (§8). |
| `grounds` | yes, may be empty | List of source slugs whose captures ground this principle. |
| `related` | no | List of fully qualified principle refs (`<set-slug>/<principle-slug>`), in any set. |
| `curated` | yes | Always `human`. |

**Body:** the principle in the curator's own words, followed by grounding passages as dual links. A principle belongs to exactly one set. Cross-set reuse is expressed with `related`, never by sharing a file.

**Order is precedence.** When two principles in the same set cannot both be honored, the one with the lower `order` governs, and a model reasoning from the set must say that it invoked precedence rather than silently picking a side. The app maintains contiguity the way it does for sets (§7.9); desktop users edit the integers by hand and `gnomon-cli validate` reports gaps. Agents never change `order`.

There is no status field. A principle in a set is in force. A principle the curator no longer holds is deleted (git history keeps it); a principle not yet held stays in `maps/proposals/` until the curator writes it.

### 4.6 `inbox/<stem>.md` — `type: inbox`

| Field | Required | Notes |
|---|---|---|
| `note` | no | The optional note field from the capture screen. |
| `attachment` | yes if an attachment exists | `<stem>.<ext>`; the file must exist beside the capture. |
| `status` | yes | `unfiled` or `filed`. |
| `filed_as` | yes if filed | The source slug the capture became. |
| `curated` | yes | Always `human` (captures are the user's own action). |

**Body:** the captured text exactly as pasted. Inbox files and their attachments are never deleted by agents. The app deletes an inbox capture (and its attachment) only when the curator explicitly clears it after ratification or after a rejected filing.

**Clerical exception.** `status` and `filed_as` are the only fields of a `human` file that an agent may write, and only as part of a filing commit (§7.6). The body, `note`, `attachment`, and the attachment file are untouchable. Rejection of the filing reverts both fields.

### 4.7 `maps/proposals/P-<date>-<nnn>.md` — `type: proposal`

| Field | Required | Notes |
|---|---|---|
| `kind` | yes | `principle`, `link`, `tag`, `amendment`. |
| `title` | yes | One line: the suggested principle, link, tags, or change. |
| `target_set` | yes for `principle`, `amendment`, `link` | Set slug the suggestion belongs to. |
| `target` | yes for `amendment`, `link`, `tag` | The affected principle (`<set-slug>/<principle-slug>`) or source slug. |
| `from_source` | no | The source slug whose filing prompted this proposal. |
| `grounds` | no | Source slugs the suggestion rests on. |
| `status` | yes | `open`, `accepted`, `declined`. |
| `curated` | yes | `agent-proposed` when an agent wrote it; `human` when the curator did. Never `ratified`. |

**Body:** the rationale, any length, written by the proposer.

`kind` meanings: `principle` — a suggested new principle; `link` — a suggested `grounds` or `related` addition to an existing principle; `tag` — suggested tags for a source; `amendment` — a suggested change to an existing principle's wording.

Proposal files are **outside the curation state machine** (§5): they are never ratified, and `status` is their whole lifecycle. Agents create proposal files and otherwise leave them alone, with one carve-out: an agent may set `status` on a proposal in a session where the curator explicitly decided that item, and may write nothing else in doing so. Accepting a `principle` or `amendment` proposal never produces the file automatically; the curator writes the principle by hand (the app pre-fills the editor from the proposal), and the result is `curated: human` saved deliberately.

There is no `maps/_proposals.md`. Open proposals are listed in `maps/_index.md`.

### 4.8 `maps/_index.md` and `principles/_index.md` — `type: index`

Generated files. Frontmatter is exactly:

```yaml
---
type: index
---
```

No timestamp, no generator version, no curation state: regeneration must be a pure function of the other files so that two devices regenerating from the same commit produce byte-identical output, and so that a regeneration that changes nothing produces no diff. The first body line is `<!-- GENERATED by Gnomon. Do not edit. Regenerated on every write. -->`.

`principles/_index.md` contains: principle sets by `order`, each with its label and its principles by `order`, one line per principle (title as a dual link, count of `grounds`). It is the one-file entry point for desktop agents (Task A on desktop reads it to find the set folders); it is never part of a prompt (§8 assembles from the files directly).

`maps/_index.md` contains, in order: the same sets section; sources grouped by `author` then `work` then `title`, one line per source (title as a dual link, an attachment marker when `original.<ext>` exists, curation state when not `ratified` or `human`); open proposals (id, kind, title, target set); a tag cloud as a list of tag → linked files.

Sorting is by codepoint, locale-independent. Regeneration is deterministic from frontmatter alone.

### 4.9 Templates

`templates/*.md` are plain files containing the frontmatter skeleton with placeholder values in `{{double_braces}}`. They have no frontmatter of their own. The app reads them to construct new files; agents copy them per `AGENTS.md`. `templates/proposal.md` is the skeleton for §4.7.

## 5. Curation states and transitions

```
                agent or app files from inbox
   (none) ─────────────────────────────────────▶ agent-proposed ──┐
      │                                               │            │ curator
      │ curator creates by hand              curator  │ ratifies   │ rejects
      │                                               ▼            ▼
      ▼                                            ratified        ✕  (revert of the filing
    human ◀─────────────────────────────────────────┘                 commit; files cease
      ▲        curator edits a ratified                               to exist)
      │        or agent-proposed notes.md
      └──────────────────────────────────────── agent-proposed (notes.md only)
```

Rules:

- `raw.md` and `original.<ext>`: `agent-proposed` → `ratified` on approval, or removed by rejection. Body and attachment immutable in every state except through revert.
- `notes.md`: `agent-proposed` → `ratified` alongside its `raw.md`; either state → `human` on the curator's first edit.
- `principle`, `principle-set`, `inbox`: always `human`. An agent that writes one of these (beyond the §4.6 clerical exception) has violated the protocol; the app flags such commits for mandatory review.
- `proposal`: outside the machine (§4.7).
- `human` files are read-only to agents. Agents may reference them and propose changes to them via `maps/proposals/`, never edit them.
- `ratified` files may be edited by the curator (becoming `human`) but not by agents.

**Ratification** is a single commit that flips `curated` from `agent-proposed` to `ratified` on the `source` and `notes` files introduced by one filing commit. It does not touch proposal files or the inbox item, which the filing commit already marked. **Rejection** is a single revert commit of the filing commit: the source folder and any proposal files it added disappear, and the inbox item returns to `status: unfiled`. Rejection is refused by the app if any later commit touches a file from the filing commit; the curator is then offered per-file manual cleanup instead.

## 6. Link format

Every cross-reference in a body is written in **dual-link form**: a wikilink immediately followed by a standard relative markdown link to the same target, so the reference resolves in Obsidian, in GitHub's renderer, in the app, and as plain text.

```
[[sources/aurelius-meditations-4-3/raw]] ([raw](../../sources/aurelius-meditations-4-3/raw.md))
[[principles/ps-7k2m/courage-before-comfort]] ([principle](../../principles/ps-7k2m/courage-before-comfort.md))
[[maps/proposals/P-20260905-003]] ([proposal](../../maps/proposals/P-20260905-003.md))
```

The wikilink target is the repository-relative path without the `.md` extension. Heading anchors (`#heading`) may be appended to both halves, and are the way to cite a passage inside a long capture. The relative link is computed from the referencing file's location. The app's link-insertion helper writes both halves; the app renders both as a single tappable element and never shows the duplication.

Frontmatter fields (`grounds`, `related`, `target`, `from_source`, `source`, `set`, `filed_as`) use bare slugs or qualified refs, never links; the body carries the links.

## 7. Procedures

Every procedure is one commit on `main`. Neither the app nor any agent creates a branch.

### 7.1 Create a principle set

1. Generate a set slug (§3.2); re-draw on collision.
2. Determine `order` = current number of sets + 1.
3. Write `principles/<set-slug>/_set.md` with `order`, optional `name`, `curated: human`, timestamps.
4. Regenerate both index files.
5. One commit: `Create principle set: Set {order}{ — name}`.

A new brain is scaffolded with Set 1 at `ps-g8xw`, `order: 1`, no `name`, and no principles.

### 7.2 Rename a set

Rewrite `name` in `_set.md`; regenerate indexes; one commit. No path changes.

### 7.3 Reorder sets

Rewrite `order` in each affected `_set.md` so the sequence is 1..N; regenerate indexes; one commit.

### 7.4 Delete a set

1. If the set contains principles, the app requires an explicit confirmation naming the count; deletion removes the folder and every file in it. (Git history preserves them.)
2. For every surviving set with `order` greater than the deleted set's, decrement `order` by 1.
3. Scan all principles for `related` refs into the deleted set, all proposals with that `target_set`, and all `notes.md` bodies for links into it; list them to the curator as now-dangling. The app does not auto-remove them.
4. Regenerate indexes.
5. One commit: `Delete principle set: Set {order}{ — name}`.

The last remaining set cannot be deleted.

### 7.5 Capture to inbox

Write `inbox/<stem>.md` (§3.4) with the pasted body and optional `note`; if a file was attached, write `inbox/<stem>.<ext>` beside it and set `attachment`. One commit: `Capture: <stem>`. Under fifteen seconds end to end (US-1). Captures are never regenerated into the indexes, so this commit carries no index change.

### 7.6 Filing (Task C in AGENTS.md)

For each `status: unfiled` inbox capture, whether performed by a desktop agent or by the app's filing flow:

1. Determine `title`, `author`, and any of `work`, `year`, `locator`, `origin`, `tags` from the capture and its attachment. Leave a field blank rather than guess it. Propose a source slug (§3.1).
2. Write `sources/<slug>/raw.md` with that frontmatter, `inbox_ref: <stem>`, `curated: agent-proposed`, and a body that is a byte-identical copy of the inbox body. In the app this copy is made by the app, not by the model.
3. If the capture has an attachment, copy it byte for byte to `sources/<slug>/original.<ext>` and set `attachment: original.<ext>`.
4. Write `sources/<slug>/notes.md` from the template, `curated: agent-proposed`.
5. For each suggestion (a principle this grounds, complicates, or contradicts; a link; tags), write one `maps/proposals/P-<date>-<nnn>.md` (§4.7) with `from_source: <slug>`.
6. Set the inbox capture to `status: filed` and `filed_as: <slug>` (the §4.6 clerical exception).
7. One commit per capture, message `File: <slug>`.

Filers do not touch either index file; the app regenerates on its next write, or the desktop session runs `gnomon-cli index` before pushing.

### 7.7 Ratify / reject

See §5. Both are single commits: `Ratify: <slug>` and `Reject: <slug>`.

### 7.8 Connect an existing brain (US-15)

1. Validate layout (§2). Offer to add missing folders, `AGENTS.md`, and templates, each as one commit.
2. Run the §9 validator and show refusals and warnings. The app fixes nothing else; in particular it never moves or rewrites existing files. A brain in an older format is migrated by hand.
3. Regenerate indexes.

### 7.9 Create, reorder, or delete a principle

- **Create:** write `principles/<set-slug>/<principle-slug>.md` with `set`, `order` = the set's current principle count + 1, `grounds`, `curated: human`; regenerate indexes; one commit `Add principle: <title>`.
- **Reorder:** rewrite `order` on each affected principle in the set so the sequence is 1..N; regenerate; one commit.
- **Delete:** remove the file; decrement `order` on every principle in the set that was below it; list dangling `related` refs and proposal `target`s to the curator; regenerate; one commit.

### 7.10 Decide a proposal

Rewrite `status` to `accepted` or `declined`; one commit `Decide: P-<date>-<nnn>`. On desktop, the curator states the decision and the agent records it (§4.7); the agent writes nothing else in that commit.

### 7.11 Desktop session discipline

Encoded in `AGENTS.md`: `git pull` at session start; one commit per action as above; before the final push, run `npx gnomon-cli validate` and fix or report refusals, then `npx gnomon-cli index`; `git push` at session end. Agents never leave the session with unpushed commits they made.

## 8. Prompt assembly context rules

These rules govern which files are included when the app or an agent assembles context for a reasoning task. They are restated in `AGENTS.md`; this is the normative version.

**Budget.** A per-task token budget, default 60% of the selected model's context window, user-adjustable in settings.

**Fill order for Task A (reason from a principle set) and Task B (relate a new text):**

1. For each selected set, in set `order`: the `_set.md` body, then every principle file in principle `order`, verbatim. If this alone exceeds budget, stop and tell the user the selection is too large for the model; never truncate principles.
2. For each principle, in the same order, the `raw.md` body of every slug in `grounds`, verbatim, in order of first reference, until the budget is reached. Attachments are never sent.
3. For any grounding capture not included: its `notes.md` body (if any) or its title and author, plus its dual link, under a heading "Passages referenced but not included."
4. Task B adds the new text last; if the new text alone exceeds the remaining budget the user is told before the request is sent.

**Precedence.** The task instructions state that principle order within a set is precedence: where two principles of one set conflict, the model names the tension, resolves it in favor of the lower `order` only if answering requires it, and says that it invoked precedence.

**Multiple sets.** When more than one set is selected, each set's material is wrapped under its own heading ("Set 2 — Work") and the instructions require the model to reason from each set separately before comparing, and to attribute every claim to a set. Precedence applies within a set, never across sets.

**Task D (compare principle sets).** Step 1 only, for all selected sets, plus grounding passages as budget allows; no new text.

## 9. Validation rules

The app validates on every read and refuses to write a file that fails a refusal-level rule. `gnomon-cli validate` runs the same rules over a working tree and exits nonzero on refusals. Agents are expected to conform; `AGENTS.md` includes the same list.

**Refusals:**

- Frontmatter parses as YAML and contains every required field for its `type`; `type: index` files contain `type` only.
- `curated` is one of the three values, is `human` for `principle`, `principle-set`, `inbox`, and is never `ratified` for `proposal`.
- `set` in a principle equals its folder's slug; `source` in a notes file equals its folder's slug.
- Set `order` values form the contiguous sequence 1..N; within each set, principle `order` values form the contiguous sequence 1..N.
- Slugs, stems, and proposal ids match their character rules (§3).
- `raw.md` body of a `human` or `ratified` source is byte-identical to its previous committed version on any write that touches the file; `original.<ext>` is byte-identical to its previous committed version always.
- A file in a source folder other than `raw.md`, `notes.md`, and the declared `original.<ext>` is a refusal; a declared `attachment` that does not exist is a refusal; an inbox attachment whose stem does not match a capture is a refusal.
- `status: filed` on an inbox capture requires `filed_as`, and `filed_as` names an existing source.
- Proposal `kind`-conditional fields are present (§4.7).

**Warnings** (reported, never refused, since a target may be legitimately mid-filing):

- Every slug in `grounds` names an existing `sources/<slug>/raw.md`; every ref in `related`, `target`, and `target_set` names an existing principle, source, or set.
- A principle body's dual links to sources and its `grounds` list disagree in either direction. The app editor offers a one-tap sync; frontmatter remains authoritative.
- A source's `inbox_ref` names a stem that no longer exists (the curator cleared it), or names a capture whose `filed_as` differs.

## 10. Reserved and forbidden

- Filenames beginning with `_` are reserved for descriptors and generated files.
- `.gnomon/` is reserved for app metadata; nothing else writes there, and it is never part of a prompt.
- `original` is a reserved basename inside source folders.
- No file outside `maps/proposals/` may carry `type: proposal`.
- Agents must never: create, rename, reorder, or delete a set; create, reorder, or delete a principle, or change any `order`; write any `human`-curated file beyond the §4.6 clerical exception; edit either `_index.md`; modify a `raw.md` body or any attachment; delete an inbox capture or attachment; change a proposal's `status` except when recording a decision the curator made in that session; create a branch; leave the session with unpushed commits. The app treats any commit that does one of these as requiring mandatory curator review before its files count as part of the brain.
