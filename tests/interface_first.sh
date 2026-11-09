#!/bin/bash
# interface-first: a whole UI page Write is refused until the interface skill
# is loaded, and nothing else is touched. 2026-10-11: a study app shipped as a
# flat card grid with the skill named and never loaded.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
H="$ROOT/.claude/hooks/interface-first.sh"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export CHEWBACCA_HOME="$TMP/home" CHEWBACCA_LOG_DIR="$TMP/logs"
mkdir -p "$CHEWBACCA_HOME/state"
fail=0
big=$(python3 -c 'print("<div></div>\n" * 200)')
small=$(python3 -c 'print("<div></div>\n" * 20)')
: > "$TMP/t.jsonl"
call() { # tool file content
  jq -n --arg t "$1" --arg f "$2" --arg c "$3" --arg tp "$TMP/t.jsonl" \
    '{session_id:"s1", tool_name:$t, transcript_path:$tp, tool_input:{file_path:$f, content:$c}}' | bash "$H"
}
denied() { printf '%s' "$1" | grep -q '"permissionDecision": "deny"'; }
out=$(call Write /x/index.html "$big"); rc=$?
denied "$out" && [ $rc -eq 0 ] && echo "ok   a 200-line page is refused before the skill, exit 0" || { echo "FAIL big page not refused ($rc): $out"; fail=1; }
out=$(call Write /x/App.tsx "$big"); denied "$out" && echo "ok   tsx counts" || { echo "FAIL tsx"; fail=1; }
out=$(call Write /x/index.html "$small"); denied "$out" && { echo "FAIL small file refused"; fail=1; } || echo "ok   a 20-line file passes"
out=$(call Write /x/script.py "$big"); denied "$out" && { echo "FAIL non-UI refused"; fail=1; } || echo "ok   a python file passes"
out=$(call Edit /x/index.html "$big"); denied "$out" && { echo "FAIL Edit refused"; fail=1; } || echo "ok   Edit passes"
echo interface > "$CHEWBACCA_HOME/state/skill-loaded-s1"
out=$(call Write /x/index.html "$big"); denied "$out" && { echo "FAIL refused after load"; fail=1; } || echo "ok   passes once the skill is loaded"
rm "$CHEWBACCA_HOME/state/skill-loaded-s1"
echo 'Base directory for this skill: /Users/x/.claude/skills/interface' > "$TMP/t.jsonl"
out=$(call Write /x/index.html "$big"); denied "$out" && { echo "FAIL transcript fallback"; fail=1; } || echo "ok   transcript fallback sees the load"
grep -q 'interface-first.sh' "$ROOT/setup.sh" && echo "ok   setup registers it" || { echo "FAIL not registered in setup.sh"; fail=1; }
exit $fail
