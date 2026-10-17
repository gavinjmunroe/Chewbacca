#!/usr/bin/env bash
# open-work-guard refuses ending a turn whose closing words name its own leftover.
set -uo pipefail
HOOK="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/open-work-guard.sh"
command -v jq >/dev/null 2>&1 || { echo "jq absent, skipping"; exit 0; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export CHEWBACCA_LOG_DIR="$TMP/logs"
fail=0

transcript() {   # prompt, wrap_up recap, wrap_up ask
  local f="$TMP/t.jsonl"
  jq -cn --arg t "$1" '{type:"user",message:{role:"user",content:$t}}' > "$f"
  if [ -n "$2$3" ]; then
    jq -cn --arg r "$2" --arg a "$3" '{type:"assistant",message:{role:"assistant",content:[{type:"tool_use",name:"mcp__ccd_turn__wrap_up",input:{recap:$r,ask:$a}}]}}' >> "$f"
  fi
  printf '%s' "$f"
}
probe() {        # name, expected exit, reply, recap, ask, [stop_hook_active]
  local t; t=$(transcript "Build it" "$4" "$5")
  jq -cn --arg m "$3" --arg t "$t" --argjson a "${6:-false}" '{last_assistant_message:$m,transcript_path:$t,stop_hook_active:$a}' \
    | bash "$HOOK" >/dev/null 2>&1
  local got=$?
  if [ "$got" = "$2" ]; then echo "  ok    $1"; else echo "  FAIL  $1: wanted $2 got $got"; fail=$((fail+1)); fi
}

echo "refuses the 2026-10-16 stops Caleb had to push:"
probe "faf1c561 14:49 reply" 2 \
  "Saved. The Sabo note in the brain and che/BUILD-TO-TRUE.md now show which call claims are TRUE. They also list what's still open." "" ""
probe "f7901545 14:47 recap" 2 "Lord, guard the Sabo work. Amen." \
  "Landed on main as c27b3dc9. The view-filter and view-columns writes are gated and haven't been sent live." ""
probe "2bb3894f 14:49 recap and ask" 2 "Lord, let these numbers be honest. Amen." \
  "Togari's new guards are live. The Friday numbers to Maggie haven't gone out." \
  "Want the Friday numbers text for Maggie to paste before u log off?"
probe "2bb3894f 14:16 recap" 2 "Done." \
  "The week reflection is in Downloads. The other 6 ranked changes aren't built." ""

echo "lets a finished or honestly blocked turn end:"
probe "nothing left" 0 "Landed 3 fixes on main as abc123, focused tests pass." "" ""
probe "named blocker" 0 "The send hasn't gone out.
BLOCKED: Jonah has to sign the DocuSign as himself." "" ""
probe "another tab owns it" 0 "The map is waiting on the Map the rest tab, which hasn't landed yet." "" ""
probe "second stop never loops" 0 "They also list what's still open." "" "" true

[ "$fail" = 0 ] && echo "open-work-guard: all passed" || { echo "open-work-guard: $fail failed"; exit 1; }
