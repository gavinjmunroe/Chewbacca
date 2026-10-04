#!/bin/bash
# tools/route_tune.py on a built fixture: the rule picks the bar it says it
# picks, and under 50 labeled rows a hook gets a table and no recommendation.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok() { if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "  pass  $1"; else fail=$((fail+1)); echo "  FAIL  $1"; echo "        got: $2  wanted: $3"; fi; }

# brain-recall, 65 rows: 40 right answers scored 0.70 to 0.895, 20 rows where
# nothing should show scored 0.50 to 0.6425, 5 whose answer was not listed
# scored 0.60. Every threshold from 0.65 to 0.70 has precision 1.0 and recall
# 40/45, so the rule's tie-break (highest recall, then precision, then the
# lowest threshold) must land on 0.65.
# skill-route, 30 rows: under the 50-row floor, so no recommendation.
python3 - "$T/labels.jsonl" <<'PY'
import json, sys
rows = []
for i in range(40):
    rows.append({"id": f"b{i}", "hook": "brain-recall", "truth": f"m{i}", "outside": False,
                 "candidates": [{"name": f"m{i}", "score": round(0.70 + i * 0.005, 4)},
                                {"name": "other", "score": 0.40}]})
for i in range(20):
    rows.append({"id": f"n{i}", "hook": "brain-recall", "truth": None, "outside": False,
                 "candidates": [{"name": "noise", "score": round(0.50 + i * 0.0075, 4)}]})
for i in range(5):
    rows.append({"id": f"o{i}", "hook": "brain-recall", "truth": None, "outside": True,
                 "candidates": [{"name": "wrong", "score": 0.60}]})
for i in range(30):
    rows.append({"id": f"s{i}", "hook": "skill-route", "truth": "graph-engineering", "outside": False,
                 "candidates": [{"name": "graph-engineering", "score": 0.50}]})
with open(sys.argv[1], "w") as fh:
    fh.write("\n".join(json.dumps(r) for r in rows) + "\n")
PY

out=$(python3 "$ROOT/tools/route_tune.py" --labels "$T/labels.jsonl" --json)
rec=$(printf '%s\n' "$out" | tail -1)
ok "brain-recall bar follows the written rule" "$(printf '%s' "$rec" | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["bar"])')" "0.65"
ok "the recommendation names the constant" "$(printf '%s\n' "$out" | grep -c 'recommended MIN_COS = 0.65')" "1"
ok "precision and recall at 0.60 are in the table" "$(printf '%s\n' "$out" | grep -E '^  0\.60 ' | head -1 | awk '{print $5, $6}')" "0.78 0.89"
ok "skill-route under 50 rows: refused" "$(printf '%s\n' "$out" | grep -c 'no recommendation: 30 labeled rows, the rule needs 50')" "1"
ok "skill-route under 50 rows: no bar in JSON" "$(printf '%s' "$rec" | python3 -c 'import json,sys; r=json.load(sys.stdin)[1]; print(r["bar"], r["gate"])')" "None None"

# A precision floor no threshold reaches is reported, not papered over.
python3 - "$T/bad.jsonl" <<'PY'
import json, sys
with open(sys.argv[1], "w") as fh:
    for i in range(60):
        fh.write(json.dumps({"id": f"x{i}", "hook": "skill-route", "truth": None, "outside": False,
                             "candidates": [{"name": "watch", "score": 0.5 + i * 0.005}]}) + "\n")
PY
ok "all-noise labels recommend no VEC_MIN" "$(python3 "$ROOT/tools/route_tune.py" --labels "$T/bad.jsonl" | grep -c 'no VEC_MIN reaches precision')" "1"
ok "missing labels file exits 1" "$(python3 "$ROOT/tools/route_tune.py" --labels "$T/none.jsonl" >/dev/null 2>&1; echo $?)" "1"

echo; echo "$pass passed, $fail failed"; [ "$fail" -eq 0 ]
