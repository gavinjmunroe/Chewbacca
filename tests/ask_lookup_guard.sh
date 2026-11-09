#!/bin/bash
# ask-lookup-guard refuses a next-step question about a fact a lookup finds
# when the turn ran no lookup, and lets everything else through.
# Incident: 2026-10-28, the box asked "What time Friday?" about a call that was
# on Caleb's calendar.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/.claude/hooks/ask-lookup-guard.sh"
pass=0; fail=0
ok(){ printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }
command -v jq >/dev/null 2>&1 || { echo "  skip: jq not installed"; exit 0; }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT

# A transcript: an earlier turn that looked at the calendar, then Caleb's new
# message, then this turn's tool calls ($1, a JSON array of [name, input]).
transcript(){
  {
    echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__cal__list_events","input":{}}]}}'
    echo '{"type":"user","message":{"content":"Justin got moved to friday"}}'
    printf '%s' "$1" | jq -c '.[] | {type:"assistant",message:{content:[{type:"tool_use",name:.[0],input:.[1]}]}}'
    echo '{"type":"user","message":{"content":[{"type":"tool_result","content":"ok"}]}}'
  } > "$T/t.jsonl"
}
run(){ jq -n --arg a "$1" --arg r "${2:-}" --arg p "$T/t.jsonl" \
  '{tool_name:"mcp__ccd_turn__wrap_up",tool_input:{ask:$a,recap:$r},transcript_path:$p}' \
  | bash "$HOOK" >/dev/null 2>&1; echo $?; }

transcript '[["Bash",{"command":"gws docs documents batchUpdate"}]]'
[ "$(run 'What time Friday?')" = 2 ] && ok "a meeting time asked w no lookup this turn is refused" || no "a meeting time asked w no lookup this turn is refused"
[ "$(run "What's his email?")" = 2 ] && ok "an email asked w no lookup is refused" || no "an email asked w no lookup is refused"
[ "$(run 'When is the call with Noah?')" = 2 ] && ok "when is the call is refused" || no "when is the call is refused"
[ "$(run 'What price range do u and Gav want to name?')" = 0 ] && ok "a real decision is allowed" || no "a real decision is allowed"
[ "$(run 'Ship it?')" = 0 ] && ok "a go-ahead is allowed" || no "a go-ahead is allowed"
[ "$(run '')" = 0 ] && ok "no ask is allowed" || no "no ask is allowed"
[ "$(run 'What time Friday?' 'LOOKED_UP: calendar and texts, nothing on Friday')" = 0 ] && ok "an override naming where it looked is allowed" || no "an override naming where it looked is allowed"

transcript '[["mcp__cal__list_events",{"startTime":"2026-10-30T00:00:00"}]]'
[ "$(run 'What time Friday?')" = 0 ] && ok "after a calendar lookup this turn it is allowed" || no "after a calendar lookup this turn it is allowed"
transcript '[["Bash",{"command":"chewbacca resolve \"Justin email\" --about Justin"}]]'
[ "$(run "What's his email?")" = 0 ] && ok "after chewbacca resolve it is allowed" || no "after chewbacca resolve it is allowed"

jq -n '{tool_name:"AskUserQuestion",tool_input:{questions:[{question:"Which day works?"}]},transcript_path:"'"$T/t.jsonl"'"}' > "$T/q.json"
transcript '[["Bash",{"command":"ls"}]]'
bash "$HOOK" < "$T/q.json" >/dev/null 2>&1; [ $? = 2 ] && ok "AskUserQuestion is checked too" || no "AskUserQuestion is checked too"

echo "  $pass passed, $fail failed"; [ "$fail" -eq 0 ]
