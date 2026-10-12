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
# A clean filter is repo config too, and git status runs it to compare a
# same-size, racily-timed file: shown running on 2026-10-09.
echo 'f filter=evil' > "$T/dirty/.gitattributes"
git -C "$T/dirty" config filter.evil.clean "touch $T/pwned-filter; cat"
touch -t 202001010000 "$T/dirty/f"
t "filter-driver repo still refused" 2 "$T/dirty" "git reset --hard"
[ ! -e "$T/pwned-filter" ] && echo "  ok    filter driver never ran" || { echo "  FAIL  filter driver ran"; fail=$((fail+1)); }
git -C "$T/dirty" config --unset filter.evil.clean; rm -f "$T/dirty/.gitattributes"
# .git/info/attributes is read whatever attr-source says (shown 2026-10-09).
echo '* filter=evil2' > "$T/dirty/.git/info/attributes"
git -C "$T/dirty" config filter.evil2.clean "touch $T/pwned-info; cat"
touch -t 202001010001 "$T/dirty/f"
t "info/attributes filter repo still refused" 2 "$T/dirty" "git reset --hard"
[ ! -e "$T/pwned-info" ] && echo "  ok    info/attributes filter never ran" || { echo "  FAIL  info/attributes filter ran"; fail=$((fail+1)); }
git -C "$T/dirty" config --unset filter.evil2.clean; rm -f "$T/dirty/.git/info/attributes"
# A slow git spends the budget: the hook must refuse inside its own 5 s
# timeout rather than be killed, since a killed hook lets the command run.
mkdir -p "$T/slowbin"; printf '#!/bin/sh\nsleep 1.4\nexec %s "$@"\n' "$(command -v git)" > "$T/slowbin/git"; chmod +x "$T/slowbin/git"
start=$SECONDS
printf '{"tool_name":"Bash","session_id":"%s","cwd":%s,"tool_input":{"command":"git reset --hard"}}' "$ME" "$(jq -Rn --arg v "$T/clean" '$v')" \
  | PATH="$T/slowbin:$PATH" bash "$H" >/dev/null 2>&1; got=$?
took=$((SECONDS-start))
[ "$got" = 2 ] && [ "$took" -lt 5 ] && echo "  ok    slow git refuses inside the hook timeout (${took}s)" \
  || { echo "  FAIL  slow git: rc $got in ${took}s"; fail=$((fail+1)); }
# 2026-10-11: the target named through a variable is the target judged.
t "variable target, dirty"    2 "$T/clean" "W=$T/dirty; git -C \"\$W\" reset --hard"
t "unresolved variable"       2 "$T/clean" 'git -C "$NOPE" reset --hard'
t "variable git, dirty cwd"   2 "$T/dirty" "x=git; W=$T/clean; \$x -C \"\$W\" reset --hard"
t "override on another piece" 2 "$T/dirty" "DESTRUCTIVE_OK=1 echo x; git reset --hard"
# Security review of 2232e9d9, 2026-10-11: every shape below exited 0.
t "harmless call pays for eval" 2 "$T/dirty" "git -C $T/clean restore f; eval 'git reset --hard'"
t "bare stash pays for sh -c"   2 "$T/dirty" "git -C $T/clean stash; sh -c 'git checkout -- f'"
t "export shadows a name"       2 "$T/clean" "W=$T/clean; export W=$T/dirty; git -C \"\$W\" reset --hard"
t "heredoc fed to bash"         2 "$T/dirty" "bash <<EOF
git reset --hard
EOF"
t "quotes split the phrase"     2 "$T/dirty" "sh -c 'git reset --ha\"\"rd'"
t "checkout -f"                 2 "$T/dirty" "git checkout -f"
t "checkout tree-ish path"      2 "$T/dirty" "git checkout HEAD f"
t "switch -f"                   2 "$T/dirty" "git switch -f main"
t "subshell cd"                 2 "$T/clean" "( cd $T/dirty && git reset --hard )"
t "pushd"                       2 "$T/clean" "pushd $T/dirty; git reset --hard"
t "GIT_WORK_TREE prefix"        2 "$T/clean" "GIT_WORK_TREE=$T/dirty GIT_DIR=$T/dirty/.git git reset --hard"
t "--work-tree space form"      2 "$T/clean" "git --git-dir=$T/dirty/.git --work-tree $T/dirty reset --hard"
t "sh -c with -C"               2 "$T/clean" "sh -c 'git -C $T/dirty reset --hard'"
t "eval with cd"                2 "$T/clean" "eval 'cd $T/dirty; git reset --hard'"
touch "$T/clean/untracked.txt"
t "clean -f, untracked only"    2 "$T/clean" "git clean -f"
rm -f "$T/clean/untracked.txt"
echo "lets through:"
t "checkout -b from a base"   0 "$T/dirty" "git checkout -b feature2 HEAD"
t "commit message naming restore" 0 "$T/dirty" "git commit -m 'restore the file' --allow-empty --dry-run"
# 2026-10-11: a clean worktree reached by cd, -C or a variable was refused
# because the session's dirty checkout was judged instead (30 in a week).
t "cd to a clean repo"        0 "$T/dirty" "W=$T/clean; cd \$W && git reset --hard"
t "-C a clean repo"           0 "$T/dirty" "git -C $T/clean reset --hard"
t "override on its own piece" 0 "$T/dirty" "W=$T/dirty; DESTRUCTIVE_OK=1 git -C \"\$W\" reset --hard"
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
