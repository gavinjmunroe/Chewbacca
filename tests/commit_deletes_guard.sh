#!/bin/bash
# A commit never deletes files nobody asked it to.
#
# 2026-11-06: commits built in a temp index seeded with `cp .git/index`, in a
# checkout several tabs were working in, wrote trees missing files HEAD already
# had. Nothing printed. 431 committed files were gone from the working tree
# before anyone looked, including a guard written that same morning.
H="${COMMIT_DELETES_GUARD_HOOK:-$HOME/.claude/hooks/commit-deletes-guard.sh}"
[ -f "$H" ] || { echo "SKIP commit_deletes_guard: no hook at $H"; exit 0; }
command -v jq >/dev/null 2>&1 || { echo "SKIP commit_deletes_guard: jq missing"; exit 0; }

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
repo="$tmp/repo"; mkdir -p "$repo"
git -C "$repo" init -q
git -C "$repo" config user.email t@t; git -C "$repo" config user.name t
for n in a b c d e; do echo "$n" > "$repo/$n.md"; done
git -C "$repo" add . >/dev/null; git -C "$repo" commit -q -m base

pass=0; fail=0
t() { # name, expected_exit, command
  rc=0
  printf '{"tool_name":"Bash","tool_input":{"command":%s},"cwd":%s}' \
    "$(python3 -I -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$3")" \
    "$(python3 -I -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$repo")" \
    | HOOKD_INNER=1 bash "$H" >/dev/null 2>&1 || rc=$?
  if [ "$rc" = "$2" ]; then echo "  ok   $1 (exit $rc)"; pass=$((pass + 1))
  else echo "  FAIL $1 (exit $rc, wanted $2)"; fail=$((fail + 1)); fi
}

echo "SHOULD REFUSE (exit 2):"
# The incident: a stale index that drops files HEAD has.
idx="$tmp/stale.idx"
GIT_INDEX_FILE="$idx" git -C "$repo" read-tree HEAD
GIT_INDEX_FILE="$idx" git -C "$repo" rm -q --cached a.md b.md c.md >/dev/null 2>&1
t "a temp index that drops three files" 2 "GIT_INDEX_FILE=$idx git commit -q -m x"

# The same shape with the index staged normally.
git -C "$repo" rm -q --cached d.md >/dev/null 2>&1
t "a staged deletion nobody named"      2 "git commit -m x"
t "behind a cd"                         2 "cd $repo && git commit -m x"
git -C "$repo" reset -q >/dev/null 2>&1

# The safe seeding pattern this guard's own message recommends. Refusing it
# made the guard fire on every correct temp-index commit, including the one
# that shipped the guard itself.
t "a temp index seeded with read-tree HEAD, in one command" 0 \
  "IDX=\$(mktemp); rm -f \$IDX; GIT_INDEX_FILE=\$IDX git read-tree HEAD && GIT_INDEX_FILE=\$IDX git add a.md && GIT_INDEX_FILE=\$IDX git commit -q -m x"
# Review, 2026-11-06: standing down on ANY missing index was too generous, so
# only the safe seeding pattern above gets the pass. A missing index with no
# read-tree is a blind spot, and a blind spot is refused.
t "a missing index with no read-tree" 2 "GIT_INDEX_FILE=$tmp/never-made.idx git commit -q -m x"

# The override and --amend used to match anywhere in the command, so a line
# that merely mentioned either stood the whole guard down. Both are read from
# the commit segment now.
git -C "$repo" rm -q --cached a.md >/dev/null 2>&1
t "the override only counts on the commit itself" 2 "echo COMMIT_DELETES_OK=x && git commit -m x"
t "--amend named in an echo, not on the commit"   2 "echo --amend && git commit -m x"
t "a clustered -am still sees the deletions"      2 "git commit -am x"
git -C "$repo" reset -q >/dev/null 2>&1

echo "SHOULD PASS (exit 0):"
git -C "$repo" rm -q --cached e.md >/dev/null 2>&1
t "the deletion is named after --"      0 "git commit -m x -- e.md"
git -C "$repo" reset -q >/dev/null 2>&1
t "a deliberate bulk removal, declared" 0 "COMMIT_DELETES_OK='pruning fixtures' git commit -m x"
echo "f" > "$repo/f.md"; git -C "$repo" add f.md >/dev/null
t "an ordinary commit that adds a file" 0 "git commit -m x"
t "an ordinary commit with named paths" 0 "git commit -m x -- f.md"
t "an amend"                            0 "git commit --amend -m x"
t "not a commit at all"                 0 "git status"
t "a push"                              0 "git push origin main"
git -C "$repo" reset -q >/dev/null 2>&1

echo "commit_deletes_guard: $pass passed, $fail failed"
[ "$fail" = 0 ]
