#!/usr/bin/env bash
# repo-safe-to-remove must refuse the exact 2026-11-04 case: stale origin/* refs
# for a remote that no longer exists, which made three repos look fully pushed.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/bin/repo-safe-to-remove"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
fail=0
expect() { # name, want (SAFE|KEEP), dir
  out=$(bash "$BIN" "$3" 2>&1)
  case "$out" in "$2"*) echo "  ok    $1";; *) echo "  FAIL  $1: $out"; fail=$((fail+1));; esac
}

git init -q --bare "$TMP/remote.git"
git clone -q "$TMP/remote.git" "$TMP/repo" 2>/dev/null
git -C "$TMP/repo" commit -q --allow-empty -m one
git -C "$TMP/repo" push -q origin HEAD:main 2>/dev/null
expect "fully pushed and clean" SAFE "$TMP/repo"

git -C "$TMP/repo" commit -q --allow-empty -m two
expect "a local commit not on the remote" KEEP "$TMP/repo"
git -C "$TMP/repo" push -q origin HEAD:main 2>/dev/null

echo x > "$TMP/repo/new.txt"
expect "an untracked file" KEEP "$TMP/repo"
rm "$TMP/repo/new.txt"

git -C "$TMP/repo" checkout -q -b side
git -C "$TMP/repo" commit -q --allow-empty -m side
git -C "$TMP/repo" checkout -q -
expect "a branch never pushed" KEEP "$TMP/repo"
git -C "$TMP/repo" branch -q -D side

# The 2026-11-04 case: remote deleted, origin/* refs still say everything is pushed.
rm -rf "$TMP/remote.git"
expect "remote deleted but stale origin refs remain" KEEP "$TMP/repo"

expect "not a repo" KEEP "$TMP"
[ "$fail" = 0 ] && echo "repo-safe-to-remove: all ok" || { echo "repo-safe-to-remove: $fail failed"; exit 1; }
