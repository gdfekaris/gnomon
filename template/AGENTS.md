# AGENTS.md — Operating Manual for This Second Brain

You are working inside a personal knowledge base. It belongs to one human
curator. Your job is clerical and interpretive — never editorial — unless
explicitly instructed otherwise.

## Structure

```
sources/<slug>/original.md The whole capture, byte-for-byte, where it is
                          the curator's to keep. IMMUTABLE.
sources/<slug>/raw.md     Verbatim hand-picked passages — the curator's
                          reading of the source. IMMUTABLE once ratified.
sources/<slug>/notes.md   The curator's addenda and marginalia.
principles/<slug>.md      The curator's stance, one principle per file.
principles/_index.md      Reading list: which principles are in force, in
                          precedence order. Agents load reasoning from here.
maps/_index.md            Master catalogue of sources and principles.
maps/<theme>.md           Optional thematic cross-reference maps.
inbox/                    Unfiled captures awaiting processing.
templates/                Frontmatter templates for new files.
```

## Hard Rules

1. **raw.md and original.md are immutable once ratified.** `original.md`
   is immutable from creation — it is the capture itself, never yours to
   touch. For `raw.md`, immutability attaches at ratification: while the
   file is `curated: agent-proposed`, the curator may add or strike
   passages, or direct you to. The moment it reads `curated: ratified` or
   `curated: human` the passages are frozen for good — never edit,
   reword, trim, reorder, renumber, or "clean up" a ratified selection.
   Corrections to the passages after that go in the sibling notes.md.
   What freezes is the reading: the passages, their §-numbers, and their
   locators. Frontmatter is clerical, not the reading — `tags:` and
   `grounding:` stay maintainable at the curator's direction for the life
   of the file, so vocabulary can be renamed across the brain without
   unfreezing anything. `title:`, `author:`, `work:`, `year:`, `url:`,
   `accessed:`, `captured:` and `drafted-by:` are citation, and citation
   is part of the reading: fix one only to correct a demonstrated error,
   and say so in notes.md.
2. **The body of a file marked `curated: human` is read-only to you.**
   Link to it; never write, reword, trim, or reformat a line of it. What
   the curator wrote stays exactly as they wrote it, and `title:` counts
   as written — it names the thing.
   Frontmatter below the title is bookkeeping, not writing, and you
   maintain it the way you maintain an index: `source:`, `grounded-in:`,
   `tags:` and `grounding:` may be kept current at the curator's
   direction. One exception needs no direction — when you rename or move
   a file, repair the links that pointed at it, in these files too, and
   say in your report that you did. A link left dangling because the rule
   forbade a one-word fix serves nobody.
   When you cannot tell whether something is body or bookkeeping, it is
   body: ask.
3. **You never create or reword principle files.** You may SUGGEST a new
   principle or a new link by appending to `maps/_proposals.md`. The
   curator decides. Index files (`maps/_index.md`, `principles/_index.md`)
   are pointers, not editorial content — you maintain those, glosses
   included, but a gloss never stands in for the principle's own words.
4. **Propose, don't finalize.** When filing inbox items, write the new
   files but never delete the inbox original. The curator removes it, and
   only once the material is preserved: retained whole as `original.md`
   where that is possible, or as passages in `raw.md` where it is not.
   A capture must never leave the brain as nothing but an agent's
   selection from it.
5. **Dual-link every cross-reference in the body**: `[[slug]]` plus a
   standard markdown relative link, so links work in Obsidian, GitHub, and
   plain text alike. Frontmatter is exempt (curator's ruling, P7a): a
   field like `source:` or `grounded-in:` is read by machines and by
   Obsidian's graph, not followed by a reader, so a bare `[[slug]]` there
   is complete. The rule binds prose, lists, and index entries.

## Standard Task A — Reason from the stance

When asked to "reason according to these principles" about a text or
question:

1. Read `principles/_index.md`, then every principle file listed under
   **In force**, in the order given. Skip **Provisional**, **Retired**, and
   any **Scoped** section whose domain the question falls outside of — if a
   scoped section looks relevant, say you are loading it and why.
2. Follow links into `sources/` only as needed to ground specifics.
3. Reason coherently FROM the principles — they are premises, not
   suggestions. Where principles tension with each other, name the
   tension rather than silently resolving it. Index order is precedence
   order: if answering at all requires resolving the tension, the
   earlier-listed principle governs, and you say that you invoked
   precedence to get there.
4. Cite which principle and which source passage supports each move.
   A principle with no grounding passage is not an error and not drift —
   the stance is the curator's, and a source grounds it without being what
   makes it true (curator's ruling, P6a). Cite the principle alone there,
   and say that it stands ungrounded rather than reaching for a passage
   that does not support it.

## Standard Task B — Relate a new text to the stance

When given a new text and asked to relate it to this brain:

1. Read the new text fully.
2. Read `principles/_index.md` and all in-force principles, loaded as in
   Task A step 1.
3. Produce: (a) where the text agrees with the stance, (b) where it
   challenges it, (c) which existing source passages it echoes or
   contradicts — with links, (d) whether it suggests a NEW principle or
   an amendment (as a proposal only).

## Standard Task C — Process the inbox

A capture may arrive as a PDF, saved HTML, or another bulk format. Those
are transport, not storage: read them, take the passages, and leave the
file itself out of git (`.gitignore` excludes them). Text the curator owns
is a different case — see step 3; it is kept whole. Never dump a whole
document into `raw.md` — it holds hand-picked passages, and the picking
belongs to the curator. If the curator has not named pages or sections,
propose candidate passages with page or section cites in
`maps/_proposals.md` and file only the ones kept.

For each item in `inbox/`:

1. Determine the source (author, work, year). Create
   `sources/<author-year-shortname>/` if new.
2. Move the passage text verbatim into `raw.md` with frontmatter from
   `templates/source-raw.md`. Do not alter the passage. For web sources,
   fill `url:` and `accessed:` from the document's own metadata — a
   passage whose URL you guessed at is a passage that cannot be re-found.
   Leave a field blank rather than infer it.
3. Retain the original where you can. If the capture is text and the
   curator's to keep — their own writing, a conversation, a note, a page
   they saved — copy it whole to `sources/<slug>/original.md`,
   byte-for-byte, adding no frontmatter. `raw.md` is then the curator's
   reading of the source, not a substitute for it. Do not retain bulk
   third-party works this way (a book PDF, a scanned volume); there the
   passages are all that should persist, which is what the immutability
   of a hand-picked excerpt is for.
4. Create a stub `notes.md` from the template.
5. Suggest tags, and suggest which principles this passage grounds,
   complicates, or contradicts — append these suggestions to
   `maps/_proposals.md`.
6. Update `maps/_index.md` with the new source entry.
7. Leave the inbox file in place for curator review.

## Standard Task D — Reconcile the indexes

Run this after the curator adds, rewords, or retires a principle, and
whenever you notice drift. Agents reason from the index, so a stale index
silently changes the stance — this is the one chore worth doing unprompted.

1. List every file in `principles/` and every directory in `sources/`.
2. Every principle file appears exactly once in `principles/_index.md`,
   under exactly one heading. File anything missing under **Provisional**.
   Never promote to **In force** yourself — placement is a precedence
   decision, and precedence is the curator's.
3. Every principle and every source appears in `maps/_index.md`.
4. Report, don't repair: an entry pointing at a missing file, a duplicate,
   a principle in two sections, or a broken link goes to
   `maps/_proposals.md`. Deleting an entry is the curator's call.

## Publishing the Skeleton

(If `tools/` is absent, this repo *is* the published scaffolding and this
section does not apply to it yet.)

A brain stays local. The structural logic — this manual, the templates,
the commands, the empty indexes — is shareable, and
`tools/export-skeleton.sh` builds it onto the orphan branch `skeleton`,
which has no ancestry with `master` and so has never contained source
material.

The export works from an allowlist inside that script: only files named
there are copied. If you add a structural file that belongs in the
shareable scaffolding, add it to the allowlist too, or it will silently
stay behind. Never add a path under `sources/`, and never ship the live
`maps/_index.md`, `maps/_proposals.md`, or `principles/_index.md` — those
name the curator's sources and gloss the curator's stance. Their pristine
stubs live in `templates/` and are what the skeleton ships; keep the two
in step when the index format changes.

## Frontmatter Conventions

- `curated: human` — written by the curator by hand; read-only to agents.
- `curated: agent-proposed` — filed by an agent, awaiting ratification.
  The curator flips it to `curated: ratified` on approval. This flip is
  what freezes a `raw.md` (rule 1); before it, the selection is still open
  to correction.
- `grounding: reading-map` — the curator has demoted this source: it may
  be cited, but no principle may rest on it. Absent the field, a source
  grounds normally. A demoted source's own header says which sections, if
  any, are exempt.
- `tags:` — lowercase, hyphenated, reuse existing tags before inventing.
