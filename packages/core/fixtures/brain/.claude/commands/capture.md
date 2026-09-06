---
description: Save a passage or a file into the inbox, verbatim
argument-hint: <text, or a path to a file>
---

Capture this into `inbox/`. Do not file it, do not analyze it, do not
comment on it. Capture must cost nothing.

Input: $ARGUMENTS

1. Make a stem: `date -u +%Y%m%d-%H%M%S`, a hyphen, then three characters
   from `23456789abcdefghjkmnpqrstuvwxyz`
   (`tr -dc 23456789abcdefghjkmnpqrstuvwxyz </dev/urandom | head -c3`).
2. Write `inbox/<stem>.md` from `templates/inbox.md` with `status: unfiled`,
   `curated: human`, timestamps now (`date -u +%Y-%m-%dT%H:%M:%SZ`), and
   the body exactly as given. Delete the `note` and `attachment` lines
   unless used.
3. If the input is a path to a `.md` or `.txt` file, its contents are the
   body. If it is a path to any other file, copy it to `inbox/<stem>.<ext>`
   (extension lowercased), set `attachment: <stem>.<ext>`, and leave the
   body empty unless text was also given.
4. Commit: `Capture: <stem>`.
5. Reply with one line: the stem and the current count of unfiled captures.

If the text names its author or source, do not verify or research it.
That happens at filing time.
