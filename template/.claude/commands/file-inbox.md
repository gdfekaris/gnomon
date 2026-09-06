---
description: File every unfiled capture into sources (Task C)
argument-hint: [optional: a stem, to file only that capture]
---

Run **Task C** from `AGENTS.md` on every `inbox/*.md` with
`status: unfiled`, following it exactly. Read `AGENTS.md` first; its rules
govern, not your judgment.

Scope, if given: $ARGUMENTS

Easy to get wrong:
- The `raw.md` body is the capture's body, byte for byte. You do not pick
  passages; there is no selection step.
- Copy the attachment, if any, to `original.<ext>` unchanged.
- Leave optional frontmatter out rather than guess it.
- One proposal per file in `maps/proposals/`, numbered after today's
  highest. Never a loose essay in your reply.
- The only change to the capture is `status: filed` and `filed_as`.
- One commit per capture: `File: <slug>`.

When done, list each filing (title, author, slug) and each proposal (id,
kind, title) in your reply. The curator cannot ratify what they cannot see.
