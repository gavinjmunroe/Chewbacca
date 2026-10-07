#!/bin/bash
# suite-rerun-guard must refuse a second full tests/run.sh on an unchanged
# tree, and must permit a first run, a group run, a run after any edit, and an
# explicit CHEWBACCA_SUITE_RERUN=1 retry.
#
# 2026-10-03: the full suite ran four times in one session, twice with nothing
# new to test, at about 15 minutes each.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/.claude/hooks/suite-rerun-guard.sh"
pass=0; fail=0
ok(){ printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }
command -v jq >/dev/null 2>&1 || { echo "  skip: jq not installed"; exit 0; }

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export CHEWBACCA_HOME="$T/home"
repo="$T/repo"; mkdir -p "$repo/tests"
git -C "$repo" init -q
printf 'echo hi\n' > "$repo/tests/run.sh"
git -C "$repo" add . && git -C "$repo" -c user.name=t -c user.email=t@t commit -qm base
session="s-$$-$RANDOM"

expect() {  # label, wanted exit, command
  local got
  jq -n --arg c "$3" --arg d "$repo" --arg s "$session" \
    '{tool_name:"Bash", tool_input:{command:$c}, cwd:$d, session_id:$s}' | bash "$HOOK" >/dev/null 2>&1
  got=$?
  if [ "$got" = "$2" ]; then ok "$1 (exit $got)"; else no "$1: wanted $2 got $got"; fi
}

echo "permits:"
expect "the first full run" 0 "bash tests/run.sh 2>&1 | tail -5"
expect "a single group" 0 "bash tests/run.sh hud"
echo "refuses:"
expect "a second full run on an unchanged tree" 2 "bash tests/run.sh"
expect "the same run by absolute path" 2 "time bash $repo/tests/run.sh > /tmp/x.log"
echo "permits again:"
expect "an explicit retry" 0 "CHEWBACCA_SUITE_RERUN=1 bash tests/run.sh"
printf 'changed\n' > "$repo/new.txt"
expect "a run after the tree changed" 0 "bash tests/run.sh"
expect "an unrelated command" 0 "git status"

echo "reading run.sh is not running it:"
session="r-$$-$RANDOM"
expect "a grep of run.sh" 0 "grep -n check tests/run.sh | head"
expect "a sed of run.sh" 0 "sed -n 1,5p tests/run.sh; echo"
expect "a syntax check of run.sh" 0 "bash -n tests/run.sh && echo ok"
expect "the first real run after those reads" 0 "cd $repo && bash tests/run.sh"
expect "and a repeat of that real run" 2 "nohup bash tests/run.sh > /tmp/x.log 2>&1"
expect "a direct ./ run counts too" 2 "./tests/run.sh"
echo "wrappers a review found the first fix missed:"
for c in "timeout 900 bash tests/run.sh" "caffeinate -i bash tests/run.sh" "bash \"tests/run.sh\" 2>&1 | tail" \
         "exec bash tests/run.sh" "bash -o pipefail tests/run.sh" "FOO=\"a b\" bash tests/run.sh"; do
  expect "repeat via: $c" 2 "$c"
done
expect "a group behind a wrapper is still allowed" 0 "timeout 900 bash tests/run.sh hud 2>&1 | tail"

echo "never runs the repo's own git programs:"
marker="$T/pwned"
git -C "$repo" config core.fsmonitor "touch $marker #"
git -C "$repo" config diff.external "sh -c 'touch $marker'"
git -C "$repo" config filter.evil.clean "sh -c 'touch $marker; cat'"
printf '* filter=evil diff=evil\n' > "$repo/.gitattributes"
git -C "$repo" config diff.evil.textconv "sh -c 'touch $marker; cat'"
# python3 -c puts the working directory first on sys.path, and the hook runs
# inside the target repo: a hashlib.py there would be imported (security
# review of 90ba54c).
printf 'open("%s", "w").close()\nfrom _sha2 import *\n' "$marker" > "$repo/hashlib.py"
printf 'more\n' >> "$repo/tests/run.sh"
session="s2-$$-$RANDOM"
expect "a repo whose config names diff, filter and fsmonitor programs" 0 "bash tests/run.sh"
[ ! -e "$marker" ] && ok "none of those programs ran" || no "the hook executed a repo-configured program"
ln -s /dev/zero "$repo/zero"
session="s3-$$-$RANDOM"
start=$SECONDS
expect "an untracked symlink to /dev/zero" 0 "bash tests/run.sh"
[ $((SECONDS - start)) -lt 5 ] && ok "and it does not hang on it" || no "hung reading a device"

[ "$fail" -eq 0 ] || exit 1
echo "suite-rerun-guard: $pass checks passed."
