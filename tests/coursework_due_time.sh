#!/bin/bash
# `coursework due` prints the deadline time, from `at` or from a time written
# in the notes. On 2026-10-24 it said "tomorrow" for WP2 and hid the 11:59pm
# sitting in that item's notes.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0; no() { echo "  FAIL $*"; fail=1; }
mkdir -p "$T/courses"
SOON=$(python3 -c 'import datetime as d;print(d.date.today()+d.timedelta(days=1))')
cat > "$T/courses/test-101.yml" <<Y
code: TEST 101
deliverables:
  - { name: "Essay", due: $SOON, status: todo, source: "fixture", notes: "11:59pm, dropbox 1" }
  - { name: "Quiz", due: $SOON, status: todo, source: "fixture", at: "9:00am" }
  - { name: "Reading", due: $SOON, status: todo, source: "fixture", notes: "pages 1-5" }
Y
echo 'term: "Fall 2026"' > "$T/semester.yml"
out="$(NO_COLOR=1 COURSEWORK_DIR="$T" "$ROOT/bin/coursework" due --days 5)"
printf '%s' "$out" | grep 'Essay' | grep -q '11:59pm' || no "time in notes not shown: $out"
printf '%s' "$out" | grep 'Quiz' | grep -q '9:00am' || no "at field not shown: $out"
printf '%s' "$out" | grep 'Reading' | grep -q 'm$' && no "invented a time for an item with none: $out"
[ "$fail" = 0 ] && echo "  ok   due shows the deadline time from at or notes"
exit "$fail"
