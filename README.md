# gnomon-dev

Design documents and the brain template for **Gnomon**, a portable,
model-agnostic second brain: a folder of plain markdown in your own git repo,
plus a bring-your-own-AI companion PWA. No code yet; this repo is in the
alignment phase.

## Documents

| file | role | status |
|---|---|---|
| `gnomon-proposal.md` | what and why: users, stories, architecture, delivery plan | **v0.3, rewritten** |
| `gnomon-schema.md` | the on-disk brain format; the contract every tool shares | **v0.2, rewritten** |
| `gnomon-technical-spec.md` | how the app, shared library, and CLI are built | **v0.2, rewritten** |
| `alignment-review.md` | contradictions and open questions across the three, with Decision lines | **decided** |
| `template/` | the canonical empty brain: AGENTS.md, Set 1, templates, commands, empty indexes | **rewritten to schema v0.2** |
| `tools/gnomon-check.py` | throwaway Python prototype of `gnomon validate` and `gnomon index` (needs PyYAML); used to verify the template and migrate geo-brain-2. Replaced by `packages/cli` once it exists. | prototype |

## Where things stand

1. ~~Fill the Decision lines in `alignment-review.md`.~~ Done 2026-09-05.
2. ~~Rewrite the three documents and `template/` so they agree.~~ Done 2026-09-05.
3. ~~Migrate geo-brain-2 by hand into the new format.~~ Done 2026-09-05.
4. Scaffold the monorepo described in the technical spec §3.
