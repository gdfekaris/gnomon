---
description: Drop a passage, URL, or half-thought into the inbox
argument-hint: <text, or a path to a file>
---

Capture this into `inbox/` for later filing. Do not file it, do not
analyze it, do not comment on it. Capture must cost nothing.

Input: $ARGUMENTS

1. If it is a path to an existing file, copy it into `inbox/` unchanged.
2. Otherwise write it verbatim to `inbox/YYYY-MM-DD-<short-slug>.md`,
   where the slug comes from the first few words. Add nothing — no
   frontmatter, no heading, no summary.
3. Reply with one line: the filename, and the current inbox count.

If the text names its author or source, do not verify or research it.
That happens at filing time, not capture time.
