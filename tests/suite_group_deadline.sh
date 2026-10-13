#!/bin/bash
# A suite group that hangs is killed at its deadline, with everything it
# started, and the run says HUNG and what was stuck instead of running on with
# an empty log. And the pytest group hands pytest only the files that import
# it, never the whole folder.
#
# 2026-10-13: job 1013-094230-c180 ran the full suite 3 h 35 min at load 170
# with nothing in its log; its pytest group was rerunning all 254 test files.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
pass=0; fail=0
ok(){ printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }

T="$(mktemp -d)"; trap 'pkill -f "$T/" 2>/dev/null; rm -rf "$T"' EXIT
mkdir -p "$T/out"
# A stand-in runner: group "quick" passes, "hangs" starts a child that never
# ends, the shape of a test waiting on a server that never answers.
cat > "$T/runner.sh" <<'R'
case "$1" in
  quick) echo "quick ran"; exit 0 ;;
  hangs) echo "about to wait"; sleep 300 & echo $! > "$(dirname "$0")/sleep.pid"; wait ;;
esac
R
start=$SECONDS
out=$(printf 'quick\0hangs\0' | CHEWBACCA_SUITE_GROUP_DEADLINE=3 \
      xargs -0 -n 1 -P 2 bash "$ROOT/bin/lib/suite-group.sh" "$T/runner.sh" "$T/out" 2>&1)
took=$((SECONDS - start))
[ "$took" -lt 30 ] && ok "a hung group ends at its deadline (${took}s for a 3 s deadline)" \
  || no "a hung group ran ${took}s past a 3 s deadline"
grep -q 'HUNG  hangs' <<<"$out" && ok "the run line says HUNG for the hung group" || no "no HUNG line: $out"
grep -q 'ok    quick' <<<"$out" && ok "the other group still passes" || no "quick did not pass: $out"
[ "$(cat "$T/out/hangs.rc" 2>/dev/null)" = 124 ] && ok "the hung group's exit code is 124" \
  || no "hangs.rc is '$(cat "$T/out/hangs.rc" 2>/dev/null)', wanted 124"
grep -q 'TIMED OUT: group "hangs"' "$T/out/hangs.log" 2>/dev/null && ok "its log says it timed out" \
  || no "its log never says it timed out"
grep -q 'sleep 300' "$T/out/hangs.log" 2>/dev/null && ok "its log names what was still running" \
  || no "its log doesn't name the stuck process"
sleep 1
kill -0 "$(cat "$T/sleep.pid" 2>/dev/null || echo 999999)" 2>/dev/null \
  && no "a child of the hung group is still running" || ok "nothing it started outlives the kill"

# The pytest group's file list.
files=$(bash "$ROOT/tests/pytest_files.sh" "$ROOT/tests" 2>/dev/null)
grep -q 'test_slop_check_rules.py' <<<"$files" && ok "pytest gets the files that import pytest" \
  || no "pytest_files.sh missed test_slop_check_rules.py"
grep -q 'test_jobs' <<<"$files" && no "pytest_files.sh lists a script-mode file" \
  || ok "pytest never gets a script-mode test file"
grep -q 'python3 -m pytest "$ROOT/tests"' "$ROOT/tests/run.sh" && no "run.sh still hands pytest the whole tests folder" \
  || ok "run.sh no longer hands pytest the whole tests folder"

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
