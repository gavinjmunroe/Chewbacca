#!/usr/bin/env bash
# machine-budget: silent when calm; when warm, refuses workflows and tells the
# next prompt; when hot, refuses subagents too. agent-nice: agents run at nice 10.
set -uo pipefail
H="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/machine-budget.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
FIX="$(cd "$(dirname "$0")" && pwd)/fixtures/machine"
# The reference Mac (10P + 4E, 24 GB), someone at it, on power. Its limits
# come from bin/lib/machine_profile.py, never from this file or the hook.
export HOME="$T" MACHINE_PROFILE="$FIX/reference-14core.json" MB_MEMFREE=50
fail=0
ok() { if eval "$2"; then echo "  ok    $1"; else echo "  FAIL  $1"; fail=$((fail+1)); fi; }
run() { printf '%s' "$2" | MB_LOAD="$1" bash "$H"; }
AGENT='{"hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"prompt":"x"}}'
FLOW='{"hook_event_name":"PreToolUse","tool_name":"Workflow","tool_input":{}}'
PROMPT='{"hook_event_name":"UserPromptSubmit","prompt":"hi"}'

ok "calm: nothing on a prompt" '[ -z "$(run 5 "$PROMPT")" ]'
ok "calm: subagents allowed" '[ -z "$(run 5 "$AGENT")" ]'
ok "calm: workflows allowed" '[ -z "$(run 5 "$FLOW")" ]'

ok "warm: subagents still allowed" '[ -z "$(run 16 "$AGENT")" ]'
ok "warm: workflows refused" 'run 16 "$FLOW" | grep -q "\"deny\""'
ok "warm: deny is one JSON document" 'run 16 "$FLOW" | python3 -c "import json,sys; json.load(sys.stdin)"'
ok "warm: the prompt hears about it" 'run 16 "$PROMPT" | grep -q "WARM (load 16 on 10+4 cores"'
ok "warm: low memory alone counts" 'printf %s "$FLOW" | MB_LOAD=3 MB_MEMFREE=15 bash "$H" | grep -q "\"deny\""'
ok "hot: subagents refused" 'run 30 "$AGENT" | grep -q "\"deny\""'
ok "hot: critical memory counts" 'printf %s "$AGENT" | MB_LOAD=3 MB_MEMFREE=8 bash "$H" | grep -q "\"deny\""'
ok "hot: Bash is never touched" '[ -z "$(run 30 '"'"'{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"ls"}}'"'"')" ]'

mkdir -p "$T/.chewbacca"; touch "$T/.chewbacca/load-authorized"
ok "authorized: subagent allowed when hot" '[ -z "$(run 30 "$AGENT")" ]'
rm "$T/.chewbacca/load-authorized"
echo warm > "$T/.chewbacca/machine-budget-force"
ok "force file sets the level" 'run 1 "$FLOW" | grep -q "\"deny\""'
rm "$T/.chewbacca/machine-budget-force"

# Machine-shaped: the same load means different things on different Macs.
python3 -c 'import json,sys; r=json.load(open(sys.argv[1])); json.dump(dict(r, idle_s=3600), open(sys.argv[2], "w")); json.dump(dict(r, on_battery=True), open(sys.argv[3], "w"))' \
  "$FIX/reference-14core.json" "$T/away.json" "$T/battery.json"
lap() { printf '%s' "$2" | MACHINE_PROFILE="$FIX/laptop-8core.json" MB_LOAD="$1" bash "$H"; }
away() { printf '%s' "$2" | MACHINE_PROFILE="$T/away.json" MB_LOAD="$1" bash "$H"; }
batt() { printf '%s' "$2" | MACHINE_PROFILE="$T/battery.json" MB_LOAD="$1" bash "$H"; }
ok "8-core laptop: warm at load 8" 'lap 8 "$FLOW" | grep -q "\"deny\""'
ok "8-core laptop: hot at load 15" 'lap 15 "$AGENT" | grep -q "\"deny\""'
ok "8-core laptop: calm at load 5" '[ -z "$(lap 5 "$FLOW")" ]'
ok "nobody at the Mac: load 16 is calm" '[ -z "$(away 16 "$FLOW")" ]'
ok "nobody at the Mac: subagents still allowed at 40" '[ -z "$(away 40 "$AGENT")" ]'
ok "nobody at the Mac: hot at 60" 'away 60 "$AGENT" | grep -q "\"deny\""'
ok "nobody at the Mac: the prompt says so, not that someone is using it" \
   'away 40 "$PROMPT" | grep -q "nobody has touched it for 60 min" && ! away 40 "$PROMPT" | grep -q "someone is using it"'
ok "on battery: warm at load 10" 'batt 10 "$FLOW" | grep -q "\"deny\""'
ok "no person's name in what it says" '! run 30 "$PROMPT" | grep -q Caleb && ! run 30 "$AGENT" | grep -q Caleb'

out=$(printf 'not json' | MB_LOAD=30 bash "$H"); rc=$?
ok "bad input is ignored" '[ "$rc" = 0 ] && [ -z "$out" ]'

# agent-nice: agents and their descendants go to 10, editors and the user's apps stay.
N="$(cd "$(dirname "$0")/.." && pwd)/bin/agent-nice"
cat > "$T/ps.txt" <<'PS'
  100     1   0 /Applications/Visual Studio Code.app/Contents/MacOS/Electron
  200   100   0 /Users/x/.vscode/extensions/anthropic.claude-code/resources/native-binary/claude
  201   200   0 node
  202   201   0 /bin/zsh
  203   200  15 npm
  300     1   0 /Applications/Claude.app/Contents/MacOS/Claude
  400     1   0 /opt/homebrew/bin/codex
  500     1   0 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
PS
export AGENT_NICE_PS_CMD="cat $T/ps.txt" AGENT_NICE_RENICE_CMD="$T/fake-renice"
printf '#!/bin/sh\necho "$@" > %s/reniced\n' "$T" > "$T/fake-renice"; chmod +x "$T/fake-renice"
python3 -I "$N" >/dev/null
ok "agent-nice renices claude, codex and their children" '[ "$(cat "$T/reniced")" = "10 -p 200 201 202 400" ]'
ok "agent-nice leaves an already-nicer child alone" '! grep -qw 203 "$T/reniced"'
ok "agent-nice never touches the editor, Desktop window or Chrome" '! grep -qwE "100|300|500" "$T/reniced"'

# renice really reaches a process's children.
n=$(zsh -c 'renice -n 10 -p $$ >/dev/null 2>&1; sh -c "ps -o nice= -p \$\$"' | tr -d ' ')
ok "renice reaches child processes" '[ "$n" -ge 10 ]'

[ "$fail" -eq 0 ] && echo "machine-budget ok" || { echo "machine-budget: $fail failed"; exit 1; }
