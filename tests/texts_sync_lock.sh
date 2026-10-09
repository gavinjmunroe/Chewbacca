#!/usr/bin/env bash
# `people texts sync` runs one at a time. 2026-10-10: three ran at once while
# the Mac was swapping, and Caleb force-quit Claude over the lag.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
lock="$T/texts-sync.lock"
# Load just the lock function from the module source, so the test needs no
# message store or reader.
probe() {
  PEOPLE_SYNC_LOCK="$lock" node -e '
    const src = require("fs").readFileSync(process.argv[1], "utf8");
    const body = src.slice(src.indexOf("function syncLock()"), src.indexOf("function syncChannel("));
    const fs = require("fs"), path = require("path"), DIR = "/nonexistent";
    eval(body + "; process.stdout.write(String(syncLock()))");
  ' "$ROOT/bin/lib/people/texts.js"
}
check() { if [ "$2" = "$3" ]; then echo "  ok    $1"; else echo "  FAIL  $1: wanted $3 got $2"; fail=$((fail+1)); fi; }

check "no lock: takes it" "$(probe)" true
check "released on exit" "$([ -e "$lock" ] && echo present || echo absent)" absent
sleep 30 &
holder=$!
echo "$holder" > "$lock"
check "live owner: second sync stands down" "$(probe)" false
kill "$holder" 2>/dev/null
wait "$holder" 2>/dev/null
check "dead owner (force-quit): taken over" "$(probe)" true
echo 0 > "$lock"
check "garbage pid: taken over" "$(probe)" true
[ "$fail" = 0 ] && echo "texts sync lock ok"
exit "$fail"
