# A Gnomon brain

A commonplace book that an AI can reason from.

You capture passages from what you read, exactly as you found them. You
write, in your own words, the principles you actually hold, and you rank
them. Agents do the clerical work — filing, linking, proposing — and then
reason **from your principles** instead of giving you the balanced survey
any chat window would.

One line holds the whole thing together: **sources are other people,
principles are you.** An agent may file, link, and propose. It may never
write a principle, change a passage, or delete something you saved.

This folder is a valid, empty brain. It has Set 1 and nothing in it. The
rules the agent follows are in `AGENTS.md`; the format is the Gnomon
Brain Format Schema.

---

## The loop

```
/capture <text | path>        whenever you read something. Seconds.
/file-inbox                   weekly-ish. The agent files; you review.
/proposals                    decide the open suggestions, one at a time
                              ...then write a principle yourself
/reason <question>            the payoff
```

| command | what happens |
|---|---|
| `/capture` | saves the text (and optionally a file) to `inbox/`, verbatim, one commit. No filing, no analysis. |
| `/file-inbox` | turns each capture into a source folder, carries the attachment across, writes proposals. Shows you what it filed. |
| `/proposals` | walks open proposals one at a time. You decide; it records. |
| `/reason` | argues a question from a set's principles, in precedence order, citing which principle and which passage backs each move. |
| `/relate` | takes a new text and reports where it agrees with a set, where it challenges it, what it echoes or contradicts. |
| `/compare` | two or more sets: shared ground, direct conflicts, gaps. |
| `/validate` | checks the brain for format errors, broken references, and drift. Reports; fixes nothing. |

The same brain works in the Gnomon app on your phone. Both edit the same
files through git.

---

## Layout

| path | what it holds | who owns it |
|---|---|---|
| `inbox/` | captures, with their attached files | you save, agent files, **you** clear |
| `sources/<slug>/raw.md` | the capture, byte for byte | immutable |
| `sources/<slug>/original.<ext>` | the attached file, if any | immutable |
| `sources/<slug>/notes.md` | your marginalia | you |
| `principles/<set>/_set.md` | a set: its number, optional name, framing | **you only** |
| `principles/<set>/<slug>.md` | one principle, ranked within its set | **you only** |
| `maps/proposals/` | one suggestion per file | agent writes, you decide |
| `principles/_index.md`, `maps/_index.md` | generated indexes | nobody edits; regenerate |
| `templates/` | skeletons for new files | — |

---

## Writing a principle

This is the part no command does for you, and the part that makes the
rest work. Nothing loads as a premise until you write one.

1. Copy `templates/principle.md` to `principles/ps-g8xw/<your-slug>.md`
   (`ps-g8xw` is Set 1; every brain starts with it).
2. Fill `title`, keep `set: ps-g8xw` and `curated: human`, set `order` to
   one more than the set's current count, and replace the `{{...}}`
   placeholders. Write one paragraph in your own words.
3. List the sources that ground it under `grounds`, and link them in the
   body.
4. Run `npx gnomon-cli index` (or let the app do it) and commit.

**A principle is not a summary of a source.** The test: if the source
turned out to be wrong, would the principle survive? If it collapses, you
wrote a summary. Sources ground, complicate, and contradict principles;
they never dictate them.

**Where principles come from, in practice:** read back through your own
`notes.md` files and find the objection you keep writing in the margins.
Three different sources, same complaint from you each time — that
recurring note is a principle trying to surface.

**Order is precedence.** When two principles in a set cannot both be
honored, the lower `order` governs, and an agent must say it invoked
precedence rather than quietly picking a side. Renumber by editing the
`order` fields; never rename or move a file.

## More than one set

A set is a stance. Keep several when you want to think the same question
through under different commitments: Set 1 and Set 2, or "Set 2 — Work".
To add one by hand: make `principles/ps-<4 chars from
23456789abcdefghjkmnpqrstuvwxyz>/_set.md` from `templates/set.md` with
`order` one more than the current count. The app does this with one tap.

---

## The rules that matter

Full text in `AGENTS.md`. The four worth knowing by heart:

- **`raw.md` and attachments are immutable.** A quoted passage that
  drifts is worse than no quote. Corrections go in `notes.md`.
- **Agents never write principles.** A knowledge base whose conclusions
  were written by a model is a model's knowledge base.
- **Propose, don't finalize.** Agents write proposals; you decide. Nothing
  you wrote is deleted by an agent.
- **Files never move.** Every link stays valid forever. Numbering, naming,
  and grouping live in frontmatter.

---

## Desktop tooling

`npx gnomon-cli validate` checks the brain; `npx gnomon-cli index`
regenerates the two index files; `npx gnomon-cli status` says where things
stand. Needs Node 20 or newer. Without Node, the app regenerates the
indexes on its next write, and everything else still works.

## When it feels pointless

It will, early. One source and no principles is a folder, not a brain.
Capture and filing pay off at scale; `/reason` pays off the moment you
have two principles that disagree with each other.
