# geo-brain-2

A commonplace book that an AI can reason from.

You collect passages from what you read. You state, in your own words, the
positions you actually hold. Agents do the clerical work — filing,
indexing, cross-referencing — and then reason **from your positions**
instead of giving you the balanced survey any chat window would.

The rules exist to keep one line intact: **sources are other people,
principles are you.** An agent may file, link, index, and propose. It may
never write a principle, reword a passage, or delete something you wrote.

---

## The loop

```
./bin/brain                      where do I stand, what should I run
/capture <text | path>           30 seconds, whenever you read something
/file-inbox                      weekly-ish, ~15 minutes
/proposals                       decide the open questions, one at a time
                                 ...then write a principle yourself
/reason <question>               the payoff
```

| command | step | what happens |
|---|---|---|
| `/capture` | capture | drops it in `inbox/` verbatim. No filing, no analysis. Capture must cost nothing or you won't do it. |
| `/file-inbox` | file | identifies the source, retains the original, pulls citable passages, opens proposals, updates the index. Shows you the passages. |
| `/proposals` | decide | walks open items one at a time. You type a letter; it executes and clears them. |
| `/reason` | consult | argues a question from your in-force principles, citing which principle and which passage backs each move. |
| `/relate` | consult | takes a new text and reports where it agrees with your stance, where it challenges it, and what it echoes or contradicts. |
| `/reconcile` | maintain | finds broken links, drift between the indexes, unratified files. Reports; fixes nothing. |

`./bin/brain` is read-only and never changes anything. Run it whenever you
have no idea what to do next.

---

## Layout

| path | what it holds | who owns it |
|---|---|---|
| `inbox/` | unfiled captures | you drop, agent files, **you** delete |
| `sources/<slug>/original.md` | the whole capture, byte-for-byte | immutable |
| `sources/<slug>/raw.md` | the passages worth citing — your *reading* of the source | immutable |
| `sources/<slug>/notes.md` | your marginalia | you |
| `principles/<slug>.md` | your stance, one per file | **you only** |
| `principles/_index.md` | which principles are in force, in precedence order | agent maintains |
| `maps/_index.md` | catalogue of everything | agent maintains |
| `maps/_proposals.md` | the decision queue | agent appends, you decide |
| `templates/` | frontmatter templates | — |

`principles/_index.md` and `maps/_index.md` do different jobs. The maps
one is inventory: what exists. The principles one is the **reading list**:
what loads as a premise, in what order, when reasoning. A principle can
exist without being in force.

---

## Deciding proposals

Every item in `maps/_proposals.md` looks like this:

```
### P3 · rule change · AGENTS.md

**Question:** two sentences.
**Options:**
- **a** — ...
- **b** — ... ← recommended

**Decision:**
```

Type a letter on the Decision line — or free text if no option fits — then
run `/proposals`. Decided items get executed and deleted. Undecided items
are never deleted by an agent.

---

## Writing a principle

This is the part no command does for you, and the part that makes the rest
work. Nothing loads as a premise until you write one.

1. `cp templates/principle.md principles/your-slug.md`
2. Keep `curated: human`. Write one paragraph in your own words.
3. Add a line under **In force** in `principles/_index.md`:
   `- [[your-slug]] (your-slug.md) — one-sentence gloss`

**A principle is not a summary of a source.** The test: if the source
turned out to be wrong, would the principle survive? If it collapses, you
wrote a summary. Sources ground, complicate, and contradict principles —
they never dictate them.

**Where principles come from, in practice:** read back through your own
`notes.md` files and find the objection you keep writing in the margins.
Three different sources, same complaint from you each time — that
recurring note is a principle trying to surface.

**Order is precedence.** When two in-force principles cannot both be
honored, the earlier one governs, and an agent must say it invoked
precedence rather than quietly picking a side.

---

## The rules that matter

Full text in `AGENTS.md`. The four worth knowing by heart:

- **`raw.md` and `original.md` are immutable.** A quoted passage that
  drifts is worse than no quote. Corrections go in `notes.md`.
- **Agents never write principles.** A knowledge base whose conclusions
  were written by a model is a model's knowledge base.
- **Propose, don't finalize.** Agents append to the queue; you decide.
  Nothing you wrote is deleted by an agent.
- **A capture never leaves as only a selection.** Text you own is retained
  whole as `original.md`; the passages are a reading of it, not a
  replacement.

---

## Publishing the scaffolding

This brain stays local — no remote is configured. The *structure* is
shareable, and lives on the orphan branch `skeleton`, built by
`tools/export-skeleton.sh` from an explicit allowlist. It shares no
history with `master`, so no source material can reach it.

```
./tools/export-skeleton.sh
git remote add public git@github.com:<you>/<repo>.git
git push public skeleton:main
```

Add a structural file to the allowlist in that script or it stays behind —
silence is deliberate, since the alternative failure is publishing your
material.

---

## When it feels pointless

It will, early. One source and no principles is a folder, not a brain.
Capture and filing pay off at scale; `/reason` pays off the moment you
have two principles that disagree with each other.
