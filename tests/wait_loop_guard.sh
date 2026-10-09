#!/bin/bash
# wait-loop-guard must refuse polling loops with no cap and let bounded ones run.
# Incident: 2026-10-09, an `until` deploy wait whose condition hit a zsh parse
# error polled Railway every 10s for an hour after the deploy finished.
set -uo pipefail
HOOK="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/wait-loop-guard.sh"
pass=0; fail=0
ok(){ printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }
command -v jq >/dev/null 2>&1 || { echo "  skip: jq not installed"; exit 0; }
run(){ jq -n --arg c "$1" '{tool_input:{command:$c}}' | bash "$HOOK" >/dev/null 2>&1; echo $?; }

[ "$(run 'until railway deployment list | grep -q SUCCESS; do sleep 10; done')" = 2 ] && ok "unbounded until poll refused" || no "unbounded until poll refused"
[ "$(run 'until railway deployment list | grep -q SUCCESS && [ "$t" \> "01:20" ]; do sleep 10; done')" = 2 ] && ok "the 10-09 loop itself refused" || no "the 10-09 loop itself refused"
[ "$(run 'while true; do curl -s x; sleep 5; done')" = 2 ] && ok "while true poll refused" || no "while true poll refused"
[ "$(run 'for i in $(seq 1 40); do railway deployment list | grep -q SUCCESS && break; sleep 10; done')" = 0 ] && ok "seq-capped loop allowed" || no "seq-capped loop allowed"
[ "$(run 'n=0; until check; do n=$((n+1)); [ $n -ge 30 ] && break; sleep 2; done')" = 0 ] && ok "counter-capped loop allowed" || no "counter-capped loop allowed"
[ "$(run 'timeout 300 bash -c "until check; do sleep 5; done"')" = 0 ] && ok "timeout-wrapped loop allowed" || no "timeout-wrapped loop allowed"
[ "$(run 'while read -r line; do echo "$line"; done < file')" = 0 ] && ok "a read loop with no sleep is not a poll" || no "a read loop with no sleep is not a poll"
[ "$(run 'WAIT_LOOP_OK="watcher" until false; do sleep 1; done')" = 0 ] && ok "override with a reason allowed" || no "override with a reason allowed"
[ "$(run 'git status')" = 0 ] && ok "unrelated command allowed" || no "unrelated command allowed"
echo "  $pass passed, $fail failed"; [ "$fail" -eq 0 ]
