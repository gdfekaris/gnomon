# Fixtures

`brain/` is the reference brain (spec §17): `template/` plus content that
exercises the format. It is a valid brain and must stay one; CI runs
`tools/gnomon-check.py` over it. Edit it by hand, then run
`npm run validate:fixture` and, if the checker says an index is stale,
`python3 tools/gnomon-check.py packages/core/fixtures/brain --write`.

What it contains and why:

- Two sets: Set 1 (`ps-g8xw`, no name, two principles) and Set 2
  (`ps-7k2m`, named "Work", with a `_set.md` body and two principles, one
  with two grounds and one with none).
- Four sources in every curation state: two ratified captures from the
  same author and work (index grouping), one with an attachment
  (`original.pdf`), one `agent-proposed` filing awaiting ratification,
  and one `human` source created by hand with no `inbox_ref`.
- Four inbox captures: three filed (one with an attachment) whose bodies
  are byte-identical to their sources, and one unfiled with a note.
- Four proposals covering every `kind` and every `status`, including one
  written by the curator (`curated: human`).
- `related` refs across sets in both directions, a tag on a principle
  (the index lists it as `file`, not `raw`), and a `notes.md` body with a
  dual link.

Golden brains for Phase 1 are this fixture, `template/`, and the
maintainer's `~/Desktop/main/geo-brain-2`.
