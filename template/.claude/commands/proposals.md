---
description: Walk open proposals one at a time and record the curator's decisions
argument-hint: [optional: a proposal id like P-20260905-003]
---

List every `maps/proposals/*.md` with `status: open`, most consequential
first (`principle` and `amendment` before `link` before `tag`).

Scope, if given: $ARGUMENTS

For each, one at a time: state the suggestion in two sentences, show its
target and grounds, say what you would decide and why in one sentence.
Then stop and wait for the curator.

When the curator decides, follow "Recording proposal decisions" in
`AGENTS.md`: set `status` to `accepted` or `declined`, refresh `updated`,
change nothing else, commit `Decide: <id>`, and move to the next.

Never decide on the curator's behalf. Never batch. Never write a principle
file, whatever a proposal suggests; for an accepted `principle` or
`amendment`, offer draft wording in your reply and stop.
