#!/bin/bash
# gtm-reuse-gate: a hand-rolled lead scorer is refused until it builds on
# tools/gtme_score.py (the BMA/Togari rubrics); one that imports it, small
# snippets and unrelated code pass. 2026-10-27: a Medrano lead scorer was written
# from scratch and matched a baseball trade as a church's why-now.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
H="$ROOT/.claude/hooks/gtm-reuse-gate.sh"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export CHEWBACCA_HOME="$TMP/home" CHEWBACCA_LOG_DIR="$TMP/logs"
mkdir -p "$CHEWBACCA_HOME/state"
fail=0
scorer=$(python3 -c '
print("import csv")
for i in range(12):
    print(f"def score_lead_{i}(lead, contact, account):\n    tier = \"A\" if lead else \"B\"\n    return tier")
')
reuse="import gtme_score
$scorer"
other=$(python3 -c 'print("\n".join(f"x{i} = {i}  # render frames" for i in range(60)))')
call() { jq -n --arg f "$1" --arg c "$2" '{tool_name:"Write", tool_input:{file_path:$f, content:$c}}' | bash "$H"; }
denied() { printf '%s' "$1" | grep -q '"permissionDecision": "deny"'; }

out=$(call "$TMP/score.py" "$scorer"); rc=$?
if denied "$out" && [ $rc -eq 0 ] && printf '%s' "$out" | grep -q 'resolve_primary' && printf '%s' "$out" | grep -q 'signal_strength'; then
  echo "ok   a hand-rolled lead scorer is refused, exit 0, naming the Togari rubrics"
else echo "FAIL hand-rolled scorer not refused ($rc): $out"; fail=1; fi

out=$(call "$TMP/score.py" "$reuse")
denied "$out" && { echo "FAIL a scorer importing gtme_score was refused"; fail=1; } || echo "ok   a scorer built on gtme_score passes"

picker="import gtme_score
prim = gtme_score.resolve_primary(cands, TITLES)
$scorer"
out=$(call "$TMP/build.py" "$picker")
if denied "$out" && printf '%s' "$out" | grep -q 'jev.ask'; then
  echo "ok   a buyer picker with no Jev check is refused, handing over the jev.ask call (2026-10-29, IEHP)"
else echo "FAIL buyer picker without Jev not refused: $out"; fail=1; fi

out=$(call "$TMP/build.py" "import jev
$picker")
denied "$out" && { echo "FAIL a buyer picker that checks with Jev was refused"; fail=1; } || echo "ok   a buyer picker that checks with Jev passes"

out=$(call "$TMP/render.py" "$other")
denied "$out" && { echo "FAIL unrelated code refused"; fail=1; } || echo "ok   unrelated code passes"

out=$(call "$TMP/notes.md" "$scorer")
denied "$out" && { echo "FAIL a markdown file refused"; fail=1; } || echo "ok   non-code files pass"

grep -q 'gtm-reuse-gate.sh' "$ROOT/setup.sh" && echo "ok   setup registers it" || { echo "FAIL not registered in setup.sh"; fail=1; }
exit $fail
