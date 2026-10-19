#!/bin/bash
# The ledger never drops a deadline in silence. Break-it, 2026-10-19: a BOM at
# the top of a course file made `due` print "Nothing due"; a second
# `deliverables:` key erased the first list; 2027-02-30 showed as Mar 2; and
# assume_done_after_days: -5 hid an item due in 2 days. All exited 0.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0; no() { echo "  FAIL $*"; fail=1; }
SOON=$(python3 -c 'import datetime as d;print(d.date.today()+d.timedelta(days=2))')
cw() { COURSEWORK_DIR="$T" "$ROOT/bin/coursework" "$@" 2>&1; }
mkdir -p "$T/courses"; echo 'term: "Fall 2026"' > "$T/semester.yml"

printf '\xef\xbb\xbfcode: TEST 101\ndeliverables:\n  - name: "Midterm essay"\n    due: %s\n    status: todo\n    source: "fixture"\n' "$SOON" > "$T/courses/a.yml"
out=$(cw due --days 14); grep -q "Midterm essay" <<< "$out" || no "a BOM hid the deliverable: $out"

printf 'code: TEST 101\ndeliverables:\n  - name: "Midterm essay"\n    due: %s\n    status: todo\n    source: "fixture"\ndeliverables:\n  - name: "Lab 3"\n    due: %s\n    status: todo\n    source: "fixture"\n' "$SOON" "$SOON" > "$T/courses/a.yml"
out=$(cw due --days 14); rc=$?
[ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "appears twice" || no "a duplicate key passed silently (rc $rc): $out"

printf 'code: TEST 101\ndeliverables:\n  - name: "Ghost"\n    due: 2027-02-30\n    status: todo\n    source: "fixture"\n' > "$T/courses/a.yml"
out=$(cw due --days 999); grep -q "Mar 2" <<< "$out" && no "2027-02-30 still shows as Mar 2"
out=$(cw check); grep -q "Ghost" <<< "$out" || no "check doesn't flag an impossible date: $out"

printf 'code: TEST 101\ndeliverables:\n  - name: "Midterm essay"\n    due: %s\n    status: todo\n    source: "fixture"\n' "$SOON" > "$T/courses/a.yml"
printf 'term: "Fall 2026"\nassume_done_after_days: -5\n' > "$T/semester.yml"
out=$(cw due --days 14); rc=$?
[ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "negative" || no "a negative grace passed (rc $rc): $out"

[ "$fail" = 0 ] && echo "  ok   BOM, duplicate key, impossible date and negative grace never hide a deadline"
exit "$fail"
