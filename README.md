# gnomon-dev

Design documents and the brain template for **Gnomon**, a portable,
model-agnostic second brain: a folder of plain markdown in your own git repo,
plus a bring-your-own-AI companion PWA. No code yet; this repo is in the
alignment phase.

## Documents

| file | role | status |
|---|---|---|
| `second-brain-proposal-v0.2.md` | what and why: users, stories, architecture, delivery plan | draft |
| `gnomon-schema.md` | the on-disk brain format; the contract every tool shares | **v0.2, rewritten** |
| `second-brain-technical-spec.md` | how the app, shared library, and CLI are built | draft |
| `alignment-review.md` | contradictions and open questions across the three, with Decision lines | **decided** |
| `template/` | the brain scaffolding carried over from geo-brain-2; predates the schema and will be rewritten to match it | stale |

## Where things stand

1. ~~Fill the Decision lines in `alignment-review.md`.~~ Done 2026-09-05.
2. Rewrite the three documents and `template/` so they agree (order in
   `alignment-review.md` §7).
3. Scaffold the monorepo described in the technical spec §3.
