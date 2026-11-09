#!/bin/bash
# A deliverable written as a flow map across lines must parse as a map. On
# 2026-10-11 all 21 BISC 101 items were written that way, each parsed as the
# string "{", and weekly Quiz #5 vanished from `due` with no warning.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail() { echo "  FAIL $1"; exit 1; }
mkdir -p "$T/courses"
DUE=$(python3 -c 'import datetime as d;print((d.date.today()+d.timedelta(days=1)).isoformat())')
cat > "$T/courses/bio.yml" <<Y
code: BIO 101
deliverables:
  - {
      name: "Weekly review quiz #5",
      due: $DUE,
      at: "09:00",
      type: quiz,
      notes: "Mrs. O'Neil's section, {braces} in quotes stay text",
    }
  - { name: "One-line item", due: $DUE }
  - name: "Block item"
    due: $DUE
    tags: [a,
      b]
Y
out=$(COURSEWORK_DIR="$T" node "$ROOT/bin/coursework" due --days 3)
for want in "Weekly review quiz #5" "One-line item" "Block item"; do
  echo "$out" | grep -q "$want" || fail "\"$want\" missing from due: $out"
done
COURSEWORK_DIR="$T" node "$ROOT/bin/coursework" due --days 3 --json |
  python3 -c 'import json,sys; d=json.load(sys.stdin); n=[i["notes"] for k in d.values() if isinstance(k,list) for i in k if i["name"].startswith("Weekly")][0]; sys.exit(0 if "{braces}" in n and "O'"'"'Neil" in n else 1)' ||
  fail "quoted text inside a flow map was mangled"

# An unclosed brace is an error with a line number, never a silent string.
printf 'code: X 1\ndeliverables:\n  - {\n      name: "never closed",\n' > "$T/courses/bad.yml"
err=$(COURSEWORK_DIR="$T" node "$ROOT/bin/coursework" due 2>&1) && fail "an unclosed { parsed"
echo "$err" | grep -q "bad.yml:3" || fail "error doesn't name the line: $err"
rm "$T/courses/bad.yml"

# check names items that parsed as anything but a map.
printf 'code: Y 1\ndeliverables:\n  - just a string\n' > "$T/courses/y.yml"
chk=$(COURSEWORK_DIR="$T" node "$ROOT/bin/coursework" check 2>&1)
echo "$chk" | grep -q "did not parse as maps" || fail "check missed a non-map item: $chk"
echo "  ok"
