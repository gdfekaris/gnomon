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

## In an assistant session

A brain's `AGENTS.md` asks the assistant to run
`npx gnomon-cli validate && npx gnomon-cli index` before the final push of
a session, so a desktop session and the phone app never disagree about
the indexes. A brain without Node can still be indexed from the app.

## Versions

The CLI and the app share a version; `gnomon --version` prints it. The
brain format itself carries no version: the schema is the contract.

MIT. Source and issues: https://github.com/gdfekaris/gnomon
