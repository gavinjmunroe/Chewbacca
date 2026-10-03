#!/bin/bash
# brightspace due must flag a dropbox the ledger never recorded, and must not
# hide it behind a loosely similar ledger item.
#
# The case is real: BISC lab "Presentation Topics" (due 2026-10-02) existed
# only as a dropbox, the nearest ledger item was the 20-point
# presentation itself, a different deliverable sharing one word, and it was found a day late.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail() { echo "  FAIL $1"; exit 1; }

mkdir -p "$T/courses"
cat > "$T/courses/bisc.yml" <<'Y'
code: BISC 101Lxg
items:
  - { name: "Lab 4 Post-Lab", due: 2026-10-02 }
  - { name: "Final Presentation", due: 2026-11-13 }
Y
cat > "$T/courses/acad.yml" <<'Y'
code: ACAD 324g
items:
  - { name: "Project 2 Chindogu", due: 2026-09-30 }
  - { name: "Project 4e Final Presentation", due: 2026-11-30 }
Y

DUE=$(python3 -c 'import datetime as d;print((d.datetime.now(d.timezone.utc)+d.timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z"))')
python3 - "$T/fixture.json" "$DUE" <<'PY'
import json, sys
path, due = sys.argv[1], sys.argv[2]
empty = []
fx = {f"/le/1.99/{ou}/dropbox/folders/": empty for ou in (298850, 302009, 302284, 302776)}
fx["/le/1.99/302780/dropbox/folders/"] = [{"Id": 1, "Name": "Presentation Topics", "DueDate": due}]
fx["/le/1.99/302780/dropbox/folders/1/submissions/"] = [{"Submissions": []}]
fx["/le/1.99/299120/dropbox/folders/"] = [{"Id": 2, "Name": "P2_Chindogu", "DueDate": due}]
fx["/le/1.99/299120/dropbox/folders/2/submissions/"] = [{"Submissions": [{"Id": 9}]}]
json.dump(fx, open(path, "w"))
PY

out=$(BRIGHTSPACE_FIXTURE="$T/fixture.json" COURSEWORK_DIR="$T" python3 "$ROOT/bin/brightspace" due --days 3)
code=$?
echo "$out" | grep "Presentation Topics" | grep -q "NOT IN LEDGER" || fail "unrecorded dropbox not flagged: $out"
echo "$out" | grep "Presentation Topics" | grep -q "NOT SUBMITTED" || fail "empty submission not reported"
echo "$out" | grep "P2_Chindogu" | grep -q "NOT IN LEDGER" && fail "P2_Chindogu should match Project 2 Chindogu"
echo "$out" | grep "P2_Chindogu" | grep -q "submitted" || fail "submission not read"
[ "$code" = 1 ] || fail "exit $code, expected 1 when something is missing from the ledger"

# Once recorded, it must clear and exit 0.
echo '  - { name: "Presentation Topic Proposals", due: 2026-10-02 }' >> "$T/courses/bisc.yml"
BRIGHTSPACE_FIXTURE="$T/fixture.json" COURSEWORK_DIR="$T" python3 "$ROOT/bin/brightspace" due --days 3 >/dev/null \
  || fail "still flagged after the ledger recorded it"
echo "  ok"
