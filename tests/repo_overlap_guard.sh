#!/bin/bash
# repo-overlap-guard must warn a session, once, when another session edited
# the same checkout recently, and must stay silent for a lone session, for a
# repeat in the same session, and inside a linked worktree.
#
# 2026-10-03: three Claude tabs and Codex shared the Chewbacca checkout and
# none knew the others were there.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/.claude/hooks/repo-overlap-guard.sh"
pass=0; fail=0
ok(){ printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }
command -v jq >/dev/null 2>&1 || { echo "  skip: jq not installed"; exit 0; }

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export CHEWBACCA_HOME="$T/home"
repo="$T/repo"; mkdir -p "$repo"
git -C "$repo" init -q
printf 'a\n' > "$repo/a.txt"
git -C "$repo" add . && git -C "$repo" -c user.name=t -c user.email=t@t commit -qm base
git -C "$repo" worktree add -q "$T/wt" -b side 2>/dev/null

expect() {  # label, warns(yes/no), session, file
  local out
  out=$(jq -n --arg f "$4" --arg s "$3" '{tool_name:"Edit", tool_input:{file_path:$f}, session_id:$s}' | bash "$HOOK" 2>/dev/null)
  if [ "$2" = yes ]; then
    printf '%s' "$out" | grep -q 'Another session edited' && ok "$1 (warns)" || no "$1: expected a warning"
  else
    [ -z "$out" ] && ok "$1 (silent, passes)" || no "$1: should not warn: $out"
  fi
}

expect "a lone session" no "one" "$repo/a.txt"
expect "the same session again" no "one" "$repo/b.txt"
expect "a second session in the same checkout" yes "two" "$repo/a.txt"
expect "that second session's next edit" no "two" "$repo/c.txt"
expect "a session in a linked worktree" no "three" "$T/wt/a.txt"
expect "a file outside any repo" no "four" "$T/loose.txt"

[ "$fail" -eq 0 ] || exit 1
echo "repo-overlap-guard: $pass checks passed."
