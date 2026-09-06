---
description: Check the brain for format errors, broken references, and stale indexes
---

Run `npx gnomon-cli validate` and report its output as a checklist,
refusals first. If `npx` is unavailable, work through the "Validation
checklist" in `AGENTS.md` by hand and report the same way.

Then check whether `npx gnomon-cli index` would change either index file
(run it and look at `git status`); if so, say the indexes were stale and
commit the regenerated files as `Index`.

Fix nothing else. Report findings to the curator; anything that needs a
decision becomes a proposal file, not an edit.
