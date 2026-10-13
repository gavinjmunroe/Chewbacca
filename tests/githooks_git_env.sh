#!/usr/bin/env bash
# A hook's tests never re-initialise the repo they're pushed from.
# Git exports GIT_DIR to hooks; `git -C <temp> init` in a test pre-push ran
# then set core.bare = true on the shared checkout (2026-10-13, twice).
# The control shows the mechanism; the scrubbed hook shows the fix; the last
# check holds .githooks/pre-push to sourcing the scrub.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
fail=0
G=(git -c user.name=t -c user.email=t@t -c commit.gpgsign=false -c init.defaultBranch=main)
"${G[@]}" init -q --bare "$T/origin.git"
"${G[@]}" init -q "$T/a"
"${G[@]}" -C "$T/a" commit -q --allow-empty -m first
"${G[@]}" -C "$T/a" remote add origin "$T/origin.git"
"${G[@]}" -C "$T/a" push -q origin main
"${G[@]}" -C "$T/a" worktree add -q "$T/w" -b side

push_with() {   # $1: hook body; pushes from the worktree, prints core.bare
  mkdir -p "$T/hooks"
  printf '#!/bin/bash\n%s\nmkdir -p "%s/x" && git -C "%s/x" init -q\nexit 0\n' "$1" "$T" "$T" > "$T/hooks/pre-push"
  chmod +x "$T/hooks/pre-push"
  rm -rf "$T/x"
  "${G[@]}" -C "$T/a" config core.bare false
  "${G[@]}" -C "$T/w" -c core.hooksPath="$T/hooks" commit -q --allow-empty -m "c$RANDOM"
  "${G[@]}" -C "$T/w" -c core.hooksPath="$T/hooks" push -q origin side 2>/dev/null
  "${G[@]}" -C "$T/a" config --get core.bare 2>/dev/null || git --git-dir="$T/a/.git" config --get core.bare
}

got="$(push_with ':')"
if [ "$got" = "true" ]; then echo "ok    control: an unscrubbed hook's git init flips core.bare (the 10/13 failure)"
else echo "FAIL  control: expected the unscrubbed hook to flip core.bare, got $got"; fail=1; fi
got="$(push_with ". '$ROOT/.githooks/scrub-git-env.sh'")"
if [ "$got" = "false" ]; then echo "ok    a scrubbed hook's git init leaves the repo alone"
else echo "FAIL  the scrubbed hook still flipped core.bare: $got"; fail=1; fi
if awk '/scrub-git-env.sh/{if(!s)s=NR} /^[^#]*run "/{if(!t)t=NR} END{exit !(s && t && s<t)}' "$ROOT/.githooks/pre-push"; then
  echo "ok    pre-push scrubs the git env before it runs any test"
else echo "FAIL  .githooks/pre-push must source scrub-git-env.sh before its first test"; fail=1; fi
exit $fail
