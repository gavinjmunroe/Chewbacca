#!/usr/bin/env bash
# thinking-dash-guard: queues em dashes found in this turn's thinking, never
# refuses, ignores earlier turns and replies.
set -uo pipefail
H="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/thinking-dash-guard.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export CHEWBACCA_HOME="$T/state"
fail=0
ok() { if eval "$2"; then echo "  ok    $1"; else echo "  FAIL  $1"; fail=$((fail+1)); fi; }
mk() {  # mk <file> <old-turn thinking> <this-turn thinking> <reply>
  python3 - "$@" <<'PY'
import json, sys
f, old, new, reply = sys.argv[1:]
rows = [{"type": "user", "message": {"content": "first ask"}},
        {"type": "assistant", "message": {"content": [{"type": "thinking", "thinking": old}]}},
        {"type": "user", "message": {"content": "second ask"}},
        {"type": "user", "message": {"content": "<system-reminder>not a turn</system-reminder>"}},
        {"type": "assistant", "message": {"content": [{"type": "thinking", "thinking": new},
                                                      {"type": "text", "text": reply}]}}]
open(f, "w").write("\n".join(json.dumps(r) for r in rows))
PY
}
D=$(printf '\342\200\224')
mk "$T/a.jsonl" "old${D}turn" "load is high${D}checking it" "Fixed"
out=$(printf '{"transcript_path":"%s"}' "$T/a.jsonl" | bash "$H"); rc=$?
ok "never refuses" '[ "$rc" = 0 ] && [ -z "$out" ]'
ok "queues this turn's thinking dash" 'grep -q "THINKING last turn (1)" "$T/state/voice-flags.pending"'
ok "quotes where it happened" 'grep -q "checking it" "$T/state/voice-flags.pending"'
rm -f "$T/state/voice-flags.pending"
mk "$T/b.jsonl" "old${D}turn" "clean thinking, commas only" "A reply${D}not thinking"
printf '{"transcript_path":"%s"}' "$T/b.jsonl" | bash "$H"
ok "an earlier turn and the reply don't count" '[ ! -e "$T/state/voice-flags.pending" ]'
# PostToolUse mode: an overnight turn with no Stop still hears about it, once.
# 2026-10-19: 40 minutes of one turn put 7 dashes in thinking, and the Stop
# mode never ran.
mid() { printf '{"transcript_path":"%s","hook_event_name":"PostToolUse","session_id":"s1"}' "$1" \
  | THINKING_DASH_NO_THROTTLE=1 bash "$H"; }
mk "$T/c.jsonl" "old turn" "load is high${D}checking it" "Fixed"
out=$(mid "$T/c.jsonl"); rc=$?
ok "mid-turn: tells the agent now" '[ "$rc" = 0 ] && printf "%s" "$out" | grep -q "THINKING just now (1)"'
ok "mid-turn: never queues for the next turn" '[ ! -e "$T/state/voice-flags.pending" ]'
out=$(mid "$T/c.jsonl")
ok "mid-turn: the same dash is not reported twice" '[ -z "$out" ]'
python3 -c 'import json,sys; open(sys.argv[1],"a").write("\n"+json.dumps({"type":"assistant","uuid":"u9","message":{"content":[{"type":"thinking","thinking":"next step"+sys.argv[2]+"again"}]}}))' "$T/c.jsonl" "$D"
out=$(mid "$T/c.jsonl")
ok "mid-turn: a new dash after the last look is reported" 'printf "%s" "$out" | grep -q "just now (1)"'
out=$(printf '{"transcript_path":"%s","hook_event_name":"PostToolUse","session_id":"s2"}' "$T/c.jsonl" | bash "$H")
out2=$(printf '{"transcript_path":"%s","hook_event_name":"PostToolUse","session_id":"s2"}' "$T/c.jsonl" | bash "$H")
ok "mid-turn: throttled inside 20 seconds" '[ -n "$out" ] && [ -z "$out2" ]'

printf 'garbage' | bash "$H"; rc=$?
ok "bad input exits 0" '[ "$rc" = 0 ]'
[ "$fail" -eq 0 ] && echo "thinking-dash-guard ok" || { echo "thinking-dash-guard: $fail failed"; exit 1; }
