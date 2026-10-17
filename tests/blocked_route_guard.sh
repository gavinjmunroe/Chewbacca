#!/usr/bin/env bash
# blocked-route-guard refuses handing Caleb a UI click after one route failed.
set -uo pipefail
HOOK="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/blocked-route-guard.sh"
command -v jq >/dev/null 2>&1 || { echo "jq absent, skipping"; exit 0; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export CHEWBACCA_LOG_DIR="$TMP/logs"
fail=0
probe() {        # name, expected exit, reply
  jq -cn --arg m "$3" '{last_assistant_message:$m}' | bash "$HOOK" >/dev/null 2>&1
  local got=$?
  if [ "$got" = "$2" ]; then echo "  ok    $1"; else echo "  FAIL  $1: wanted $2 got $got"; fail=$((fail+1)); fi
}
echo "refuses the 2026-10-16 demo handoffs:"
probe "faf1c561 12:35" 2 "BLOCKED: hiding columns in Clay can only be done in its UI, and Claude in Chrome isn't connected, so that click has to happen on ur screen."
probe "faf1c561 12:42" 2 "BLOCKED: the only Clay login is in the window on ur screen, so the cleanup has to be done by u, about 90 sec:
- Sort: click the icon, pick Updated At, then Descending."
echo "lets through:"
probe "routes tried and named" 0 "BLOCKED: chewbacca clay view-sort returned 404 and jev-browse hit the login wall, so click Updated At on ur screen."
probe "a BLOCKED with no UI step" 0 "BLOCKED: Jonah has to sign the DocuSign as himself."
probe "no BLOCKED at all" 0 "Sorted the view through chewbacca clay. Strava is on top."
probe "a BLOCKED: mentioned mid-sentence (the steering-study reply, 10/16)" 0 "- blocked-route-guard: a BLOCKED: that hands him a click has to name two kit routes tried first. It catches both demo handoffs, where he wrote BRO U HV JEV BROWSER AGENT."
probe "the handoff in a dash list" 2 "Here's where it stands.
- BLOCKED: the sort has to happen on ur screen, Claude in Chrome is down."
[ "$fail" = 0 ] && echo "blocked-route-guard: all passed" || { echo "blocked-route-guard: $fail failed"; exit 1; }
