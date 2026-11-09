#!/usr/bin/env bash
# learn-on-land refuses ending a turn that landed code without saving its lesson.
set -uo pipefail
HOOK="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/learn-on-land.sh"
command -v jq >/dev/null 2>&1 || { echo "jq absent, skipping"; exit 0; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export CHEWBACCA_LOG_DIR="$TMP/logs"
fail=0
row_user() { jq -cn --arg t "$1" '{type:"user",message:{role:"user",content:$t}}'; }
row_edit() { jq -cn --arg p "$1" '{type:"assistant",message:{content:[{type:"tool_use",name:"Edit",input:{file_path:$p}}]}}'; }
row_bash() { jq -cn --arg c "$1" '{type:"assistant",message:{content:[{type:"tool_use",name:"Bash",input:{command:$c}}]}}'; }
probe() {        # name, expected exit, reply, transcript file, [stop_hook_active]
  jq -cn --arg m "$3" --arg t "$4" --argjson a "${5:-false}" '{last_assistant_message:$m,transcript_path:$t,stop_hook_active:$a}' \
    | bash "$HOOK" >/dev/null 2>&1
  local got=$?
  if [ "$got" = "$2" ]; then echo "  ok    $1"; else echo "  FAIL  $1: wanted $2 got $got"; fail=$((fail+1)); fi
}
# Shape of bc78d8f9 and 2bb3894f on 2026-10-16: a lesson early, then code,
# then a land, in the turn he answered with "Learn and remember everything
# you should".
T1="$TMP/landed.jsonl"
{ row_user "Add the off-domain email check"
  row_edit "/Users/x/code/chewbacca/team/memory/feedback_x.md"
  row_edit "/Users/x/code/chewbacca/tools/brand_buyer.py"
  row_bash "chewbacca land --paths tools/brand_buyer.py -m 'fix: retry runner-up'"; } > "$T1"
T2="$TMP/saved.jsonl"
{ cat "$T1"; row_bash "cat >> ~/code/chewbacca/team/memory/feedback_y.md <<'X'
lesson
X"; } > "$T2"
T3="$TMP/earlier.jsonl"
{ cat "$T1"; row_user "We good?"; } > "$T3"
echo "refuses:"
probe "landed code after the last lesson" 2 "Landed on main." "$T1"
echo "lets through:"
probe "lesson saved after the code" 0 "Landed and saved." "$T2"
probe "the land was in an earlier turn" 0 "All good." "$T3"
probe "says No new lesson" 0 "Landed. No new lesson: a typo fix." "$T1"
probe "second stop never loops" 0 "Landed on main." "$T1" true
[ "$fail" = 0 ] && echo "learn-on-land: all passed" || { echo "learn-on-land: $fail failed"; exit 1; }
