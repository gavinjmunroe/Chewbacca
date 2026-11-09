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
fx = {f"/le/1.99/{ou}/dropbox/folders/": empty for ou in (900101, 900103, 900104, 900105)}
fx["/le/1.99/900106/dropbox/folders/"] = [{"Id": 1, "Name": "Presentation Topics", "DueDate": due}]
fx["/le/1.99/900106/dropbox/folders/1/submissions/"] = [{"Submissions": []}]
fx["/le/1.99/900102/dropbox/folders/"] = [{"Id": 2, "Name": "P2_Chindogu", "DueDate": due}]
fx["/le/1.99/900102/dropbox/folders/2/submissions/"] = [{"Submissions": [{"Id": 9}]}]
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

# Any student: courses come from their own enrollments, the newest term only,
# named from the section Name (Code is the section number), and a ledger code
# with a suffix ("BISC 101Lxg") still matches "BISC-101".
python3 - "$T/fixture2.json" "$DUE" <<'PY'
import json, sys
path, due = sys.argv[1], sys.argv[2]
enr = "/lp/1.43/enrollments/myenrollments/?orgUnitTypeId=3&pageSize=100"
org = lambda i, code, name: {"OrgUnit": {"Id": i, "Code": code, "Name": name}}
fx = {enr: {"Items": [org(11, "20263_13102", "20263_13102 BISC-101: Cells"),
                      org(12, "20263_13105", "20263_13105 BISC-101: Cells"),
                      org(13, "20263_39000", "20263_39000 MATH-125: Calculus"),
                      org(14, "20253_35382", "20253_35382 GESM-120: Old term")]}}
fx["/le/1.99/11/dropbox/folders/"] = []
fx["/le/1.99/12/dropbox/folders/"] = [{"Id": 5, "Name": "Lab 4 Post-Lab", "DueDate": due}]
fx["/le/1.99/12/dropbox/folders/5/submissions/"] = [{"Submissions": []}]
fx["/le/1.99/13/dropbox/folders/"] = [{"Id": 6, "Name": "Problem Set 3", "DueDate": due}]
fx["/le/1.99/13/dropbox/folders/6/submissions/"] = [{"Submissions": []}]
json.dump(fx, open(path, "w"))
PY
out=$(BRIGHTSPACE_FIXTURE="$T/fixture2.json" COURSEWORK_DIR="$T" python3 "$ROOT/bin/brightspace" due --days 3) \
  && fail "MATH problem set is in no ledger, expected exit 1"
echo "$out" | grep -q "^MATH 125" || fail "course not named from the section Name: $out"
echo "$out" | grep "Lab 4 Post-Lab" | grep -q "NOT IN LEDGER" && fail "BISC 101 should match ledger code BISC 101Lxg: $out"
echo "$out" | grep "Problem Set 3" | grep -q "NOT IN LEDGER" || fail "another student's course not read: $out"
echo "$out" | grep -q "GESM" && fail "old-term course listed: $out"
# Quizzes count too: BISC weekly Quiz #5 closes Mon 9am with no late attempt,
# and on 2026-10-11 `due` read only dropboxes, so it never showed. A quiz is
# listed with its released grade, or NO GRADE YET.
python3 - "$T/fixture3.json" "$DUE" <<'PY'
import json, sys
path, due = sys.argv[1], sys.argv[2]
fx = json.load(open(path.replace("fixture3", "fixture")))
fx["/le/1.75/900105/quizzes/"] = {"Objects": [
    {"QuizId": 5, "Name": "Quiz #5", "DueDate": due, "IsActive": True, "GradeItemId": 50},
    {"QuizId": 4, "Name": "Quiz# 4", "DueDate": due, "IsActive": True, "GradeItemId": 40},
    {"QuizId": 3, "Name": "Old draft", "DueDate": due, "IsActive": False, "GradeItemId": 30}], "Next": None}
fx["/le/1.75/900105/grades/values/myGradeValues/"] = [{"GradeObjectIdentifier": "40", "DisplayedGrade": "100 %"}]
json.dump(fx, open(path, "w"))
PY
out=$(BRIGHTSPACE_FIXTURE="$T/fixture3.json" COURSEWORK_DIR="$T" python3 "$ROOT/bin/brightspace" due --days 3)
echo "$out" | grep "Quiz #5" | grep -q "NO GRADE YET" || fail "open quiz not listed: $out"
echo "$out" | grep "Quiz# 4" | grep -q "100 %" || fail "quiz grade not read: $out"
echo "$out" | grep -q "Old draft" && fail "inactive quiz listed: $out"

# A link in the instructions and a file on an announcement both have to show.
# A22's spec and a lab's presentation date were each hidden that way (2026-11-04).
python3 - "$T/fixture4.json" <<'PY'
import json, sys, datetime as dt
when = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
json.dump({
  "/lp/1.43/enrollments/myenrollments/?orgUnitTypeId=3&pageSize=100": {"Items": [{"OrgUnit": {"Id": 7, "Name": "20263_1 BISC-101: Cells", "Code": "20263_1"}, "Access": {"IsActive": True, "CanAccess": True}}], "PagingInfo": {"HasMoreItems": False}},
  "/le/1.75/7/dropbox/folders/9": {"Name": "A22", "DueDate": None, "Attachments": [],
    "CustomInstructions": {"Text": "Follow this spec.", "Html": '<p>Follow <a href="https://x.test/spec?a=1&amp;b=2">this <b>spec</b></a>.</p>'}},
  "/le/1.99/7/news/": [{"Id": 5, "Title": "Presentation Dates", "StartDate": when, "Body": {"Text": "See the snapshot."},
    "Attachments": [{"FileId": 11, "FileName": "present.png"}]}],
}, open(sys.argv[1], "w"))
PY
out=$(BRIGHTSPACE_FIXTURE="$T/fixture4.json" COURSEWORK_DIR="$T" python3 "$ROOT/bin/brightspace" instructions 7 9) || fail "instructions: $out"
echo "$out" | grep -q "linked: this spec: https://x.test/spec?a=1&b=2" || fail "instruction link hidden: $out"
out=$(BRIGHTSPACE_FIXTURE="$T/fixture4.json" COURSEWORK_DIR="$T" python3 "$ROOT/bin/brightspace" news --days 3) || fail "news: $out"
echo "$out" | grep -q "attached: present.png (/le/1.99/7/news/5/attachments/11)" || fail "news attachment hidden: $out"

# Never a window, signed out or not: the read that used to open Chrome ran
# inside keepalives and MCP calls nobody was watching.
grep -n '"open"' "$ROOT/bin/brightspace" && fail "bin/brightspace opens something"
# The cookie key opens every Chrome cookie, so it never goes into argv, where
# ps shows it to every process (security review, 2026-10-10: openssl -K <hex>).
for f in bin/brightspace bin/chewbacca-api; do
  [ -f "$ROOT/$f" ] || continue  # USC OS ships no api engine
  grep -q '"-K"' "$ROOT/$f" && fail "$f passes the cookie key on a command line"
done
echo "  ok"
