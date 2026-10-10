#!/usr/bin/env bash
# machine-budget: silent when calm; when warm, renices Bash in bypass sessions,
# refuses workflows and tells the next prompt; when hot, refuses subagents too.
set -uo pipefail
H="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/machine-budget.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export HOME="$T" MB_CORES=14 MB_MEMFREE=50
fail=0
ok() { if eval "$2"; then echo "  ok    $1"; else echo "  FAIL  $1"; fail=$((fail+1)); fi; }
run() { printf '%s' "$2" | MB_LOAD="$1" bash "$H"; }
BASH_IN='{"hook_event_name":"PreToolUse","tool_name":"Bash","permission_mode":"bypassPermissions","tool_input":{"command":"npm run build","timeout":600000}}'
AGENT='{"hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"prompt":"x"}}'
FLOW='{"hook_event_name":"PreToolUse","tool_name":"Workflow","tool_input":{}}'
PROMPT='{"hook_event_name":"UserPromptSubmit","prompt":"hi"}'

ok "calm: nothing on Bash" '[ -z "$(run 5 "$BASH_IN")" ]'
ok "calm: nothing on a prompt" '[ -z "$(run 5 "$PROMPT")" ]'
ok "calm: subagents allowed" '[ -z "$(run 5 "$AGENT")" ]'

out=$(run 16 "$BASH_IN")
ok "warm: Bash reniced to 10" 'printf %s "$out" | grep -q "renice -n 10 -p \$\$ >/dev/null 2>&1; npm run build"'
ok "warm: other tool_input fields kept" 'printf %s "$out" | grep -q "\"timeout\": 600000"'
ok "warm: one JSON document" 'printf %s "$out" | python3 -c "import json,sys; json.load(sys.stdin)"'
ok "warm: subagents still allowed" '[ -z "$(run 16 "$AGENT")" ]'
ok "warm: workflows refused" 'run 16 "$FLOW" | grep -q "\"deny\""'
ok "warm: the prompt hears about it" 'run 16 "$PROMPT" | grep -q "WARM (load 16 on 14 cores"'
ok "warm: low memory alone counts" 'printf %s "$BASH_IN" | MB_LOAD=3 MB_MEMFREE=15 bash "$H" | grep -q "renice -n 10"'

ok "hot: Bash reniced to 19" 'run 30 "$BASH_IN" | grep -q "renice -n 19"'
ok "hot: subagents refused" 'run 30 "$AGENT" | grep -q "\"deny\""'
ok "hot: critical memory counts" 'printf %s "$AGENT" | MB_LOAD=3 MB_MEMFREE=8 bash "$H" | grep -q "\"deny\""'

NOBYPASS='{"hook_event_name":"PreToolUse","tool_name":"Bash","permission_mode":"default","tool_input":{"command":"npm test"}}'
ok "never auto-allows outside bypass mode" '[ -z "$(run 30 "$NOBYPASS")" ]'
NICED='{"hook_event_name":"PreToolUse","tool_name":"Bash","permission_mode":"bypassPermissions","tool_input":{"command":"nice -n 19 make"}}'
ok "an already-niced command is left alone" '[ -z "$(run 30 "$NICED")" ]'

mkdir -p "$T/.chewbacca"; touch "$T/.chewbacca/load-authorized"
ok "authorized: subagent allowed when hot" '[ -z "$(run 30 "$AGENT")" ]'
rm "$T/.chewbacca/load-authorized"
echo warm > "$T/.chewbacca/machine-budget-force"
ok "force file sets the level" 'run 1 "$BASH_IN" | grep -q "renice -n 10"'
rm "$T/.chewbacca/machine-budget-force"

out=$(printf 'not json' | MB_LOAD=30 bash "$H"); rc=$?
ok "bad input is ignored" '[ "$rc" = 0 ] && [ -z "$out" ]'

# The rewrite actually lowers priority for the command and its children.
n=$(zsh -c 'renice -n 10 -p $$ >/dev/null 2>&1; sh -c "ps -o nice= -p \$\$"' | tr -d ' ')
ok "renice reaches child processes" '[ "$n" -ge 10 ]'

[ "$fail" -eq 0 ] && echo "machine-budget ok" || { echo "machine-budget: $fail failed"; exit 1; }
