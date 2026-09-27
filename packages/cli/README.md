# gnomon-cli

The desktop command line for a [Gnomon](https://github.com/gdfekaris/gnomon)
brain: a folder of plain markdown, in your own git repository, that the
Gnomon app and your AI assistant both work in. The CLI reads and writes
the working tree and never commits; you or your assistant commit.

Requires Node 20 or newer. Run it in a clone of your brain:

```
npx gnomon-cli validate     # schema rules over the working tree; nonzero exit on refusals
npx gnomon-cli index        # regenerate maps/_index.md and principles/_index.md, only if changed
npx gnomon-cli status       # counts, index freshness, uncommitted changes, and what to do next
npx gnomon-cli decrypt      # an encrypted brain, readable for a desktop session (see below)
```

Or install it once and use the short name:

```
npm install -g gnomon-cli
gnomon validate
```

Every command takes an optional path to the brain; the default is the
current directory.

## What the commands do

- **validate** checks the layout (AGENTS.md, the five folders, at least
  one principle set) and every file's frontmatter and links against the
  brain format schema. It prints each refusal and warning with its path,
  notes stale index files, and exits nonzero when there are refusals.
- **index** rewrites the two generated index files from the brain's
  contents, byte-identical when nothing changed. It is the same code the
  app runs after every commit.
- **status** prints unfiled captures, sources by curation state,
  principles and sets, open proposals, whether the indexes are current,
  the git state, and a one-line nudge naming the next step of the loop.
- **decrypt**, **encrypt**, and **guard** are for an encrypted brain; see
  below.

## An encrypted brain

When encryption is on (the app turns it on; `.gnomon/encryption.json`
exists), passage, notes, principle, proposal, and inbox text is stored as
ciphertext and frontmatter stays readable. `validate`, `index`, and
`status` work without the key. To read and write the bodies on the desktop:

```
npx gnomon-cli decrypt           # after git pull: every body to plaintext, in the working tree only
npx gnomon-cli guard --install   # once per clone: refuse any commit that carries a plaintext body
```

Then wrap every commit, so no plaintext is ever committed:

```
npx gnomon-cli encrypt && git add -A && git commit -m "File: <slug>" && npx gnomon-cli decrypt
```

- The passphrase comes from `GNOMON_PASSPHRASE`, or the command asks for
  it in a terminal. It is checked before any file is touched; a wrong one
  changes nothing.
- `encrypt` keeps the committed ciphertext of every body whose plaintext
  has not changed, so only what you edited shows in the diff, and an
  untouched brain re-encrypts with no diff at all.
- `decrypt` refuses a tree with uncommitted changes (it starts right after
  a pull or a commit); `--force` overrides.
- While the tree is decrypted, `git status` lists every body as modified;
  that is the decryption. `gnomon status` says the tree is decrypted and
  how many bodies are plaintext.
- `guard --install` writes a pre-commit hook into this checkout only
  (hooks are never pushed). The hook refuses a commit that stages a
  plaintext body, and refuses when it cannot run `gnomon-cli` at all:
  a blocked commit can be retried, a pushed plaintext body cannot be
  taken back. It never overwrites a hook that is not its own.
- Encryption is turned on, off, and re-keyed in the app, never here.

[git-crypt](https://github.com/AGWA/git-crypt) is an alternative for
people who prefer git filters, though it encrypts whole files, frontmatter
included, and the app cannot read it.

## A local model

A desktop session can run on a model on your own computer, so no AI
provider sees the brain: Ollama for the model, OpenCode (or any agent that
reads `AGENTS.md`) for the session, and the CLI as always. The setup:
https://github.com/gdfekaris/gnomon/blob/main/docs/local-models.md

## In an assistant session

A brain's `AGENTS.md` asks the assistant to run
`npx gnomon-cli validate && npx gnomon-cli index` before the final push of
a session, so a desktop session and the phone app never disagree about
the indexes. A brain without Node can still be indexed from the app.

## Versions

The CLI and the app share a version; `gnomon --version` prints it. The
brain format itself carries no version: the schema is the contract.

MIT. Source and issues: https://github.com/gdfekaris/gnomon
