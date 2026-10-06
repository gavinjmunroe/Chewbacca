#!/bin/bash
# clay-native-guard must refuse per-row Clay loops and stay out of the way otherwise.
# Incident: 2026-10-05 Zeutara, per-row `clay workflows runs/actions test` loops
# ran all night and burned ~3,400 client credits.
set -uo pipefail
HOOK="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/clay-native-guard.sh"
pass=0; fail=0
ok(){ printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }
command -v jq >/dev/null 2>&1 || { echo "  skip: jq not installed"; exit 0; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
run(){ jq -n --arg c "$1" '{tool_input:{command:$c}}' | bash "$HOOK" >/dev/null 2>&1; echo $?; }
printf 'import subprocess\nfrom concurrent.futures import ThreadPoolExecutor\ndef f(e): subprocess.run(["clay","workflows","runs","test","wf",e])\nlist(ThreadPoolExecutor(8).map(f,[1,2]))\n' > "$TMP/loop.py"
printf 'import subprocess\nsubprocess.run(["clay","workflows","runs","test","wf","x"])\n' > "$TMP/one.py"
[ "$(run "for e in a b; do clay workflows runs test wf --inputs -; done")" = 2 ] && ok "inline shell loop refused" || no "inline shell loop refused"
[ "$(run "python3 $TMP/loop.py")" = 2 ] && ok "script with a per-row pool refused" || no "script with a per-row pool refused"
[ "$(run "python3 $TMP/one.py")" = 0 ] && ok "single run allowed" || no "single run allowed"
[ "$(run "clay workflows actions test pkg key --inputs '{}'")" = 0 ] && ok "one action test allowed" || no "one action test allowed"
[ "$(run "CLAY_LOOP_OK='5-row fixture' python3 $TMP/loop.py")" = 0 ] && ok "override with a reason allowed" || no "override with a reason allowed"
[ "$(run "clay campaigns list")" = 0 ] && ok "unrelated clay command allowed" || no "unrelated clay command allowed"
echo "  $pass passed, $fail failed"; [ "$fail" -eq 0 ]
