#!/bin/bash
# Stop: refuse to finish a session that shipped work, or got corrected, and
# taught the kit nothing.
#
# WHY. On 2026-09-20 Caleb asked four times whether Chewbacca had been updated
# with what the session learned, and finally said "I shouldn't hv to keep asking
# this bruv". The rule became this hook, but it was advisory and counted any
# kit commit, team board moves included. On 2026-10-09 he corrected one website
# five times in a night, nothing was written down, and he said "I should never
# have to tell chewb to make a skill". Advisory hooks do nothing
# (feedback_advisory_hooks_do_nothing), so this one refuses, once per session.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init kit-debt.sh 15

command -v jq >/dev/null 2>&1 || exit 0
TOOL=$(command -v kit-debt || echo "$HOME/.local/bin/kit-debt")
[ -x "$TOOL" ] || exit 0

INPUT=$(cat)
SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)
ACTIVE=$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)

# Once per session: a refusal that repeats every turn gets the hook disabled.
MARK="${TMPDIR:-/tmp}/kit-debt-${SID:-none}"
[ "$ACTIVE" = "true" ] && exit 0
[ -n "$SID" ] && [ -f "$MARK" ] && exit 0

REPORT=$("$TOOL" --terse --session "$SID" --transcript "$TRANSCRIPT" 2>/dev/null) && exit 0
[ -n "$REPORT" ] || exit 0

[ -n "$SID" ] && touch "$MARK"
jq -n --arg d "$REPORT" '{decision: "block", reason: ($d + "\n\nDo this before telling Caleb the session is done.")}' 2>/dev/null
exit 0
