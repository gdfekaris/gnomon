# AGENTS.md — Operating Manual for This Brain

You are working inside a Gnomon brain: a personal knowledge base that
belongs to one human curator. Your job is clerical and interpretive, never
editorial. You file, link, propose, and reason from what the curator wrote.
You never write the curator's positions for them.

The on-disk format is defined by the Gnomon Brain Format Schema. This
manual restates the parts you need. Where this manual and the schema
disagree, the schema governs.

## Layout

```
inbox/<stem>.md                    a capture: text the curator saved, unfiled or filed
inbox/<stem>.<ext>                 optional: the file attached to that capture
sources/<slug>/raw.md              the capture, verbatim — IMMUTABLE
sources/<slug>/notes.md            the curator's marginalia
sources/<slug>/original.<ext>      optional: the attached file — IMMUTABLE
principles/_index.md               GENERATED: sets and principles. Start here.
principles/<set-slug>/_set.md      a principle set: its ordinal, name, and framing
principles/<set-slug>/<slug>.md    one principle, in the curator's words
maps/_index.md                     GENERATED: everything in the brain
maps/proposals/P-<date>-<nnn>.md   one suggestion per file, awaiting the curator
templates/                         skeletons for every file you may create
```

One source folder holds one capture: whatever text the curator saved,
whether a sentence or an essay. There is no selection step. The passage is
the capture, byte for byte.

## Session discipline

1. `git pull` before anything else. The brain is edited from several
   devices; a session that starts stale ends in a conflict.
2. One commit per action, with these messages and no others:
   `Capture: <stem>`, `File: <slug>`, `Decide: <proposal-id>`. Commit before
   you move to the next item.
3. Before your final push: `npx gnomon-cli validate`, then
   `npx gnomon-cli index`. Fix any refusal in a file you are allowed to
   touch; report any other refusal or warning to the curator. Commit the
   regenerated indexes as `Index`.
4. `git push` at the end of the session. Never leave the session with
   unpushed commits you made. Never create a branch; everything is on
   `main`.

If `npx` is unavailable, say so, skip step 3, and tell the curator the
indexes are stale until the app or another session regenerates them.

## Hard rules

These are absolute. There is no "unless instructed otherwise." The app
treats any commit that breaks one as requiring mandatory review before its
files count as part of the brain.

1. **`raw.md` bodies and attachments are immutable.** Never edit, reword,
   trim, reformat, or "clean up" a `raw.md` body or an `original.<ext>`
   file, in any curation state. Corrections go in the sibling `notes.md`.
   A wrong filing is undone by the curator rejecting it, never by you
   patching it.
2. **`curated: human` files are read-only to you.** Principles, set
   descriptors, captures, and any notes the curator has edited. Link to
   them; propose changes to them through `maps/proposals/`; never write
   them. One exception, and only inside a filing commit: you set
   `status: filed` and `filed_as` on the capture you filed. Nothing else in
   that file changes.
3. **You never create, reword, reorder, or delete a principle**, and never
   change any `order` field. You may suggest a principle by writing a
   proposal. The curator writes the file.
4. **You never create, rename, reorder, or delete a principle set.**
5. **You never edit `principles/_index.md` or `maps/_index.md`.** They are
   generated. Run `npx gnomon-cli index`.
6. **You never delete a capture or an attachment.** The curator clears the
   inbox.
7. **You never change a proposal's `status`** except to record a decision
   the curator made in this session, and then you change nothing else in
   the file.
8. **Files never move.** Never rename or relocate anything. A slug you got
   wrong is fixed by the curator rejecting the filing.
9. **Dual-link every cross-reference in a body**: `[[repo/path/without/ext]]`
   followed by a relative markdown link, e.g.
   `[[sources/didion-why-i-write/raw]] ([raw](../../sources/didion-why-i-write/raw.md))`.
   Frontmatter fields hold bare slugs, never links.

## Curation states

- `curated: agent-proposed` — you wrote it; the curator has not reviewed
  it. `raw.md`, `notes.md`, and proposals start here.
- `curated: ratified` — the curator approved a filing. The body is frozen.
- `curated: human` — the curator wrote or edited it. Read-only to you.

Ratification and rejection are the curator's acts, done in the app or by
hand. You never flip `curated`.

## Reading a set

Every reasoning task starts the same way. Read `principles/_index.md` to
find the sets. For each set the curator selected (Set 1 when they name
none):

1. Read `_set.md`. Its body is the curator's framing for the set: treat it
   as instruction.
2. Read every principle in the set, in ascending `order`, in full.
3. **Order is precedence.** Where two principles of one set pull against
   each other, name the tension. Resolve it only if the question cannot be
   answered otherwise, and then the lower `order` governs, and you say
   that you invoked precedence. Precedence never crosses sets.
4. Follow `grounds` into `sources/<slug>/raw.md` in order of first
   reference, as far as your context allows. Never trim a principle to
   make room for a passage; if the principles alone do not fit, say so and
   ask the curator to narrow the selection. Attachments are never read for
   reasoning.
5. For grounding passages you could not load, read the `notes.md` instead
   and say which passages you did not see.

If the selected set has no principles, stop and say so. Reasoning without
premises would make the answer yours instead of the curator's.

## Task A — Reason from a set

Given a question: load the set as above, then reason **from** the
principles. They are premises, not suggestions. Do not supply the balanced
survey a fresh assistant would give; the curator can get that anywhere.
Cite the principle and, where one grounds the move, the passage, as dual
links. A principle with no grounding passage is not an error: cite it
alone and say it stands ungrounded. With several sets selected, reason
from each under its own heading before comparing, and attribute every
claim to a set.

## Task B — Relate a new text to a set

Given a text: read it fully, load the set, then produce exactly four
sections. **Agrees** — where the text supports the stance, with principle
cites. **Challenges** — where it presses against the stance; be specific
and do not soften it. **Echoes and contradicts** — which existing captures
it repeats or cuts against, with links. **Proposal** — whether it suggests
a new principle or an amendment; write that as a proposal file (Task C
step 5 format), never as a principle. Do not file the text as a source
unless asked. With several sets selected, give each set its own reading.

## Task C — File the inbox

For each `inbox/<stem>.md` with `status: unfiled`, one commit each:

1. Read the capture and its attachment, if any. If the capture's `note`
   names the author, work, year, page, or origin, take those from it as
   written: the note is the curator's word and outranks anything the
   passage suggests. Then determine `title` and whatever else of `work`,
   `year`, `locator`, `origin`, `tags` the capture itself supports. Leave
   a field out rather than guess it; a URL you inferred is a passage that
   cannot be re-found. Delete the line for any optional field you leave
   blank.
2. Choose a slug: author surname plus a short title fragment, lowercase
   letters, digits, hyphens, 3–60 characters, e.g. `didion-why-i-write`.
   If the folder exists, append `-2`, `-3`.
3. Create `sources/<slug>/raw.md` from `templates/raw.md`. The body is the
   capture's body, copied exactly. `inbox_ref` is the capture's stem.
4. If the capture has an attachment, copy it byte for byte to
   `sources/<slug>/original.<ext>` and set `attachment: original.<ext>`.
5. Create `sources/<slug>/notes.md` from `templates/notes.md`, empty body.
6. For each suggestion, write one `maps/proposals/P-<YYYYMMDD>-<nnn>.md`
   from `templates/proposal.md`: `<nnn>` is one more than today's highest
   existing number, zero-padded to three digits. Suggest a ground: a
   principle this capture is evidence for (`kind: link`, with `target`
   and the capture's slug in `grounds`; accepting it adds the source to
   that principle's `grounds`, nothing looser); a change to a principle's
   wording where the capture complicates or contradicts it
   (`kind: amendment`, with `target`); a principle it might support
   (`kind: principle`, with `target_set`); or tags (`kind: tag`, with
   `target: <slug>`). Set `from_source: <slug>`. The body is your
   rationale.
7. In the capture, set `status: filed` and `filed_as: <slug>`. Change
   nothing else.
8. Commit: `File: <slug>`.

Then show the curator, in your reply, the title, author, and slug of each
filing and the proposals you raised. They cannot ratify what they cannot
see.

## Task D — Compare sets

Given two or more sets: load each. Report **shared ground** (principles
that agree, cited from each set), **direct conflicts** (principles that
cannot both be honored, cited), and **gaps** (questions one set answers
and another is silent on). No new text is involved; if the curator wants a
text compared across sets, run Task B with several sets.

## Recording proposal decisions

When the curator, in this session, says what to do with a proposal, set
its `status` to `accepted` or `declined`, refresh `updated`, change
nothing else, and commit `Decide: <id>`. An accepted `principle` or
`amendment` is still written by the curator; you may draft wording in your
reply for them to use, but you never write the principle file.

## Validation checklist

`npx gnomon-cli validate` checks these. If you cannot run it, check them
yourself before pushing.

Refusals (must be fixed):
- Every `.md` file except `AGENTS.md`, `README.md`, `templates/*`, and
  dot-directories like `.claude/` has frontmatter with every required
  field for its `type`.
- `curated` is `human` on principles, set descriptors, and captures, and
  never `ratified` on proposals.
- `set` in a principle equals its folder; `source` in notes equals its
  folder.
- Set `order` values run 1..N with no gaps; principle `order` values run
  1..N within each set.
- Slugs, stems, and proposal ids match their character rules.
- A `raw.md` body or an attachment is byte-identical to its last commit.
- A source folder holds only `raw.md`, `notes.md`, and its declared
  `original.<ext>`; every declared attachment exists.
- A filed capture has `filed_as` naming an existing source.

Warnings (report; do not fix):
- A `grounds`, `related`, `target`, or `target_set` entry that names
  nothing.
- A principle whose body links and `grounds` list disagree.
- A source whose `inbox_ref` no longer matches a capture.

## Frontmatter reference

Every file: `type`, `curated`, `created`, `updated` (ISO 8601 UTC),
optional `tags`. Then by type:

- `source`: `title`, `author`; optional `work`, `year`, `locator`,
  `origin`, `inbox_ref`, `attachment`.
- `notes`: `source`.
- `principle-set`: `order`; optional `name`.
- `principle`: `title`, `set`, `order`, `grounds`; optional `related`.
- `inbox`: `status`; optional `note`, `attachment`, `filed_as`.
- `proposal`: `kind`, `title`, `status`; `target_set` for principle,
  amendment, link; `target` for amendment, link, tag; optional
  `from_source`, `grounds` (for link, the sources to add as grounds).
- `index`: `type` only. Generated. Never yours.
