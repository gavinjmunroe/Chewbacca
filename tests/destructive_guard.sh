#!/usr/bin/env bash
# destructive-guard refuses work-destroying git commands when there's work to
# lose, and another session's worktree removal; it stays quiet otherwise.
set -uo pipefail
H="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/destructive-guard.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export CHEWBACCA_LOG_DIR="$T/logs"
git -C "$T" init -q dirty && git -C "$T/dirty" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
echo a > "$T/dirty/f" && git -C "$T/dirty" add f && git -C "$T/dirty" -c user.email=t@t -c user.name=t commit -q -m f && echo b > "$T/dirty/f"
git -C "$T" init -q clean && git -C "$T/clean" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
ME=11111111-1111-1111-1111-111111111111
OTHER=22222222-2222-2222-2222-222222222222
fail=0
t() {  # name, expected, cwd, command
  printf '{"tool_name":"Bash","session_id":"%s","cwd":%s,"tool_input":{"command":%s}}' "$ME" \
    "$(jq -Rn --arg v "$3" '$v')" "$(jq -Rn --arg v "$4" '$v')" | bash "$H" >/dev/null 2>&1
  local got=$?
  if [ "$got" = "$2" ]; then echo "  ok    $1"; else echo "  FAIL  $1: wanted $2 got $got"; fail=$((fail+1)); fi
}
echo "refuses when there's work to lose:"
t "checkout -- file, dirty"   2 "$T/dirty" "git checkout -- f"
t "checkout ., dirty"         2 "$T/dirty" "git checkout ."
t "restore, dirty"            2 "$T/dirty" "git restore f"
t "reset --hard, dirty"       2 "$T/dirty" "git reset --hard HEAD"
t "bare stash, dirty"         2 "$T/dirty" "git stash"
t "cd then reset, dirty"      2 "/" "cd $T/dirty && git reset --hard"
t "another session's worktree" 2 "$T/clean" "git worktree remove --force /private/tmp/claude-501/-Users-x/$OTHER/scratchpad/wt3"
# Security review, 2026-10-10: bypass shapes and a malicious repo.
t "git -c before the verb"    2 "$T/dirty" "git -c user.name=x reset --hard"
t "full path to git"          2 "$T/dirty" "/usr/bin/git reset --hard"
t "command git"               2 "$T/dirty" "command git checkout -- f"
t "inside sh -c"              2 "$T/dirty" "sh -c 'git reset --hard'"
t "override not leading"      2 "$T/dirty" "echo DESTRUCTIVE_OK=1; git reset --hard"
t "eval string"               2 "$T/dirty" 'eval "git reset --hard"'
t "git in a variable"         2 "$T/dirty" 'x=git; $x reset --hard'
t "git from a subshell"       2 "$T/dirty" '$(which git) reset --hard'
git -C "$T/dirty" config core.fsmonitor "touch $T/pwned; false"
t "fsmonitor repo still refused" 2 "$T/dirty" "git reset --hard"
[ ! -e "$T/pwned" ] && echo "  ok    fsmonitor never ran" || { echo "  FAIL  fsmonitor ran"; fail=$((fail+1)); }
git -C "$T/dirty" config --unset core.fsmonitor
echo "lets through:"
t "same commands, clean repo" 0 "$T/clean" "git reset --hard HEAD"
t "restore --staged, dirty"   0 "$T/dirty" "git restore --staged f"
t "named stash push, dirty"   0 "$T/dirty" "git stash push -u -m my-tag"
t "checkout a branch, dirty"  0 "$T/dirty" "git checkout -b feature"
t "own worktree"              0 "$T/clean" "git worktree remove --force /private/tmp/claude-501/-Users-x/$ME/scratchpad/wt3"
t "deliberate override"       0 "$T/dirty" "DESTRUCTIVE_OK=1 git reset --hard"
t "mentioned in a heredoc"    0 "$T/dirty" "git commit -F - <<'MSG'
explains why git reset --hard is dangerous
MSG"
t "not git"                   0 "$T/dirty" "echo checked out the branch"
[ "$fail" = 0 ] && echo "destructive-guard ok"
exit "$fail"
