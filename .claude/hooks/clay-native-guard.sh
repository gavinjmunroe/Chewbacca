#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init clay-native-guard.sh 5
# PreToolUse on Bash: refuse per-row Clay loops driven from the shell.
#
# Written 2026-10-06. The gtm-engineering skill had said since 2026-09-23 to use
# native Clay enrichment columns and never replace them with agent research. On
# 2026-10-05 the Zeutara wave work still ran ZeroBounce, email finding, Claygent
# lines and copy writes one row at a time through `clay workflows runs test` and
# `clay workflows actions test` loops in python. It took all night, the Claygent
# loop burned ~3,400 of the client's credits on 150 rows before anyone priced a
# row, and Caleb: "any gtme would use it better than u." A paragraph did not stop
# it, so this refuses.
#
# The Clay-native route: Find People (or import) into a TABLE, add enrichment
# columns (Work email waterfall, Validate email, AI/Claygent with a source
# field), price ONE row, Run column, then send the table or audience to the
# campaign. Override for a genuine one-off: put CLAY_LOOP_OK='<reason>' in the
# command.

set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
payload="$(cat)"
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"
session="$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null)"
[ -n "$cmd" ] || exit 0
case "$cmd" in *CLAY_LOOP_OK=*) exit 0 ;; esac
# Caleb told the agent in THIS session to do the Clay work itself within 2 hours
# (chat-approval.sh). The CLAY_LOOP_OK prefix can't carry that: launch-guard
# refuses any env prefix on a command that names Clay, so on 2026-10-10 the two
# guards together left no way to run an approved verification at all. Bound to
# the session because a bare "do it" in another tab is about that tab's work
# (security review of 2e5c1aff).
python3 -I - "${CHEWBACCA_STATE_DIR:-$HOME/.chewbacca/state}/clay-chat-approval" "$session" <<'PY' 2>/dev/null && exit 0
import json, os, sys, time
s = sys.argv[2]
if not s or not all(c.isalnum() or c in "_.-" for c in s):
    sys.exit(1)
try:
    rec = json.load(open(os.path.join(sys.argv[1], s + ".json")))
    at = int(rec["at"])
except Exception:
    sys.exit(1)
if rec.get("session_id") != s or rec.get("v") != 2 or rec.get("interactive") is not True:
    sys.exit(1)
sys.exit(0 if 0 <= time.time() - at < 2 * 3600 else 1)
PY

PER_ROW='(workflows[^a-z]+runs[^a-z]+test|workflows[^a-z]+actions[^a-z]+test)'
# "for" alone matched prose inside a prompt ("one sentence for a cold email") on
# 2026-10-06 and blocked a one-row pricing call; a loop has "for NAME in".
LOOP='(\bfor [A-Za-z_][A-Za-z0-9_]* in\b|\bwhile\b|ThreadPool|\.map\(|xargs)'
hit=""
# Inline: a shell or python loop in the command itself.
if printf '%s' "$cmd" | grep -qE "$PER_ROW" && printf '%s' "$cmd" | grep -qE "$LOOP"; then hit="inline loop"; fi
# A script the command runs.
if [ -z "$hit" ]; then
  for f in $(printf '%s' "$cmd" | grep -oE '[^ "'"'"']+\.py' | head -5); do
    [ -f "$f" ] || continue
    if grep -qE "$PER_ROW|\"runs\", *\"test\"|\"actions\", *\"test\"" "$f" && grep -qE "$LOOP" "$f"; then hit="$f"; break; fi
  done
fi
[ -n "$hit" ] || exit 0
echo "clay-native-guard: refusing a per-row Clay loop ($hit). Bulk Clay work goes in a Clay TABLE: rows in via Find People or import, enrichment columns (Work email waterfall, Validate email, AI/Claygent line with a source field), price ONE row first, then Run column and send to the campaign. On 2026-10-05 per-row CLI loops took a night and burned ~3,400 client credits. Genuine one-off: add CLAY_LOOP_OK='<reason>' to the command." >&2
exit 2
