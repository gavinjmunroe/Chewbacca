#!/usr/bin/env bash
# draft-source-guard refuses a draft for Caleb to send whose numbers have no source.
set -uo pipefail
HOOK="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/draft-source-guard.sh"
command -v jq >/dev/null 2>&1 || { echo "jq absent, skipping"; exit 0; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export CHEWBACCA_LOG_DIR="$TMP/logs"
fail=0
probe() {        # name, expected exit, reply, [stop_hook_active]
  jq -cn --arg m "$3" --argjson a "${4:-false}" '{last_assistant_message:$m,stop_hook_active:$a}' | bash "$HOOK" >/dev/null 2>&1
  local got=$?
  if [ "$got" = "$2" ]; then echo "  ok    $1"; else echo "  FAIL  $1: wanted $2 got $got"; fail=$((fail+1)); fi
}
# The 2bb3894f reply at 2:01pm PT, 2026-10-16, word for word after the prayer.
DRAFT="So say it like this:

> We've reached 1,828 investors and about 100 have replied personally. That's a 5.5% human reply rate, more than 5x the 1% line we use as the health bar for cold outreach

That's true, and it reads strong."
echo "refuses:"
probe "the 10/16 Zeutara draft" 2 "$DRAFT"
probe "a Sources line that skips the estimate" 2 "$DRAFT
Sources: 1,828 from Clay campaign stats, 1% from the cold-email skill, 5x and 5.5% computed."
echo "lets through:"
probe "every number sourced" 0 "$DRAFT
Sources: 1,828 investors emailed (Clay campaign stats, all-time); 100 is my estimate of human replies from reading the reply list; 5.5% is 100 / 1,828; 1% is the health line in skills/cold-email; 5x is 5.5 / 1."
probe "a draft with only a date" 0 "> Can we do October 22 or 23 for Six Trees?"
probe "a draft with no numbers" 0 "> Jonah, once we have your times we can book these."
probe "no draft at all" 0 "Sent 122 replies through Togari."
probe "second stop never loops" 0 "$DRAFT" true
[ "$fail" = 0 ] && echo "draft-source-guard: all passed" || { echo "draft-source-guard: $fail failed"; exit 1; }
