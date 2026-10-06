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
cmd="$(jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -n "$cmd" ] || exit 0
case "$cmd" in *CLAY_LOOP_OK=*) exit 0 ;; esac

PER_ROW='(workflows[^a-z]+runs[^a-z]+test|workflows[^a-z]+actions[^a-z]+test)'
LOOP='(\bfor\b|\bwhile\b|ThreadPool|\.map\(|xargs)'
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
