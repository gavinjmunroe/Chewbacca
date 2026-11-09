#!/bin/bash
# The two-day "assumed-done" rule is opt-in. A stranger's ledger must keep an
# item 5 days overdue as overdue; only a semester.yml that sets
# assume_done_after_days drops it. Caleb's own ledger opts in with 2, which is
# where the rule came from (2026-09-20); it became opt-in on 2026-10-10.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0; no() { echo "  FAIL $*"; fail=1; }
mkdir -p "$T/courses"
LATE=$(python3 -c 'import datetime as d;print(d.date.today()-d.timedelta(days=5))')
cat > "$T/courses/test-101.yml" <<Y
code: TEST 101
deliverables:
  - name: "Late Problem Set"
    due: $LATE
    status: todo
    source: "fixture"
Y
echo 'term: "Fall 2026"' > "$T/semester.yml"
out="$(COURSEWORK_DIR="$T" "$ROOT/bin/coursework" due --days 30 --json)"
overdue() { python3 -c 'import json,sys; print(" ".join(i["name"] for i in json.load(sys.stdin)["overdue"]))'; }
printf '%s' "$out" | overdue | grep -q 'Late Problem Set' || no "with no opt-in a 5-day-late item left OVERDUE: $out"
printf 'term: "Fall 2026"\nassume_done_after_days: 2\n' > "$T/semester.yml"
out="$(COURSEWORK_DIR="$T" "$ROOT/bin/coursework" due --days 30 --json)"
printf '%s' "$out" | overdue | grep -q 'Late Problem Set' && no "assume_done_after_days: 2 no longer closes a 5-day-late item: $out"
[ "$fail" = 0 ] && echo "  ok   assumed-done is off by default and on when a semester opts in"
exit "$fail"
