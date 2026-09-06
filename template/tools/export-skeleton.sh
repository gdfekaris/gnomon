#!/usr/bin/env bash
#
# Build the shareable skeleton onto the orphan branch `skeleton`.
#
# The skeleton is defined by the ALLOWLIST below: only files named there
# are ever copied. This fails closed — a file you did not anticipate is
# simply absent, so no source passage, note, or principle can reach the
# branch by accident. The branch has no ancestry with `master`, so its
# history has never contained your material and never can.
#
# Usage: tools/export-skeleton.sh ["commit message"]
#
# Nothing is pushed. Publish deliberately:
#   git remote add public git@github.com:<you>/<repo>.git
#   git push public skeleton:main
#
# Working tree and current branch are untouched; this builds the commit
# with git plumbing in a temporary index.

set -euo pipefail

MSG="${1:-Update skeleton}"

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

# ALLOWLIST — "<path in this repo>:<path in the skeleton>"
# Index files are shipped from their pristine templates, never from the
# live ones: the live copies name your sources and gloss your principles.
ALLOW=(
  "AGENTS.md:AGENTS.md"
  "templates/skeleton-README.md:README.md"
  "templates/skeleton-LICENSE:LICENSE"
  "templates/skeleton-gitignore:.gitignore"
  "templates/source-raw.md:templates/source-raw.md"
  "templates/source-notes.md:templates/source-notes.md"
  "templates/principle.md:templates/principle.md"
  "templates/maps-index.md:maps/_index.md"
  "templates/maps-proposals.md:maps/_proposals.md"
  "templates/principles-index.md:principles/_index.md"
  "inbox/README.md:inbox/README.md"
  ".claude/commands/capture.md:.claude/commands/capture.md"
  ".claude/commands/file-inbox.md:.claude/commands/file-inbox.md"
  ".claude/commands/reason.md:.claude/commands/reason.md"
  ".claude/commands/relate.md:.claude/commands/relate.md"
  ".claude/commands/proposals.md:.claude/commands/proposals.md"
  ".claude/commands/reconcile.md:.claude/commands/reconcile.md"
)

# Same, but shipped executable.
ALLOW_EXEC=(
  "bin/brain:bin/brain"
)

# Empty directories git would otherwise drop.
KEEP=("sources/.gitkeep" "principles/.gitkeep")

# Guard: a stub that has accumulated real entries. Every legitimate
# [[link]] in a stub lives inside an HTML comment as an example.
for stub in templates/maps-index.md templates/maps-proposals.md \
            templates/principles-index.md; do
  if grep -n '\[\[' "$stub" | grep -qv '<!--'; then
    echo "ABORT: $stub has a live [[link]] outside a comment." >&2
    echo "It looks like real content leaked into a stub. Fix it first." >&2
    exit 1
  fi
done

for pair in "${ALLOW[@]}" "${ALLOW_EXEC[@]}"; do
  [ -f "${pair%%:*}" ] || { echo "ABORT: missing ${pair%%:*}" >&2; exit 1; }
done

# Build the tree in a scratch index so the real one is never touched.
GIT_INDEX_FILE=$(mktemp -u "${TMPDIR:-/tmp}/skeleton-index.XXXXXX")
export GIT_INDEX_FILE
trap 'rm -f "$GIT_INDEX_FILE"' EXIT
git read-tree --empty

for pair in "${ALLOW[@]}"; do
  src="${pair%%:*}"; dst="${pair#*:}"
  blob=$(git hash-object -w "$src")
  git update-index --add --cacheinfo "100644,$blob,$dst"
done

for pair in "${ALLOW_EXEC[@]}"; do
  src="${pair%%:*}"; dst="${pair#*:}"
  blob=$(git hash-object -w "$src")
  git update-index --add --cacheinfo "100755,$blob,$dst"
done

empty=$(git hash-object -w --stdin </dev/null)
for k in "${KEEP[@]}"; do
  git update-index --add --cacheinfo "100644,$empty,$k"
done

tree=$(git write-tree)

# Verify the tree matches the allowlist exactly, before it becomes a commit.
expected=$(for p in "${ALLOW[@]}" "${ALLOW_EXEC[@]}"; do echo "${p#*:}"; done
           printf '%s\n' "${KEEP[@]}" | sort)
actual=$(git ls-tree -r --name-only "$tree")
if [ "$(echo "$expected" | sort)" != "$(echo "$actual" | sort)" ]; then
  echo "ABORT: built tree does not match the allowlist:" >&2
  diff <(echo "$expected" | sort) <(echo "$actual" | sort) >&2 || true
  exit 1
fi

if parent=$(git rev-parse --verify -q refs/heads/skeleton); then
  if [ "$(git rev-parse "$parent^{tree}")" = "$tree" ]; then
    echo "skeleton is already up to date ($(git rev-parse --short "$parent"))"
    exit 0
  fi
  commit=$(git commit-tree "$tree" -p "$parent" -m "$MSG")
else
  commit=$(git commit-tree "$tree" -m "$MSG")
fi

git update-ref refs/heads/skeleton "$commit"
echo "skeleton -> $(git rev-parse --short "$commit")"
git ls-tree -r --name-only skeleton | sed 's/^/  /'
