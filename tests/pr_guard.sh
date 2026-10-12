#!/bin/bash
# pr-guard refuses gh pr create on BMA and Amber repos, by --repo or by the
# origin remote of the directory, and lets every other PR through.
set -u
HOOK="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/pr-guard.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git init -q "$TMP/bma" && git -C "$TMP/bma" remote add origin https://github.com/bluemodernadvisory/togari-platform.git
git init -q "$TMP/mine" && git -C "$TMP/mine" remote add origin https://github.com/calebnewtonusc/Chewbacca.git
fail=0
run() { jq -n --arg c "$2" --arg d "$1" '{tool_input:{command:$c},cwd:$d}' | bash "$HOOK" >/dev/null 2>&1; echo $?; }
expect() { got=$(run "$2" "$3"); [ "$got" = "$1" ] || { echo "FAIL: expected $1, got $got for: $3 (in $2)"; fail=1; }; }
expect 2 "$TMP/mine" "gh pr create --repo bluemodernadvisory/togari-platform --title x --body y"
expect 2 "$TMP/mine" "gh pr create -R amberintelligence/amber-id --fill"
expect 2 "$TMP/bma" "gh pr create --title x --body y"
expect 2 "$TMP/mine" "cd $TMP/bma && gh pr create --fill"
expect 0 "$TMP/mine" "gh pr create --title x --body y"
expect 0 "$TMP/bma" "gh pr view 84"
expect 0 "$TMP/bma" "git push origin HEAD:main"
[ $fail = 0 ] && echo "pr-guard: ok"
exit $fail
