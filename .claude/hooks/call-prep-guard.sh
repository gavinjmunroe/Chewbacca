#!/bin/bash
# hookd skips this guard for a Bash call that names none of these words,
# each one its first check requires.
# gate: batchUpdate .py
[ -z "${HOOKD_INNER:-}" ] && [ -x "$HOME/.local/bin/hookd" ] && exec "$HOME/.local/bin/hookd" gate "$0" "$@"
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init call-prep-guard.sh 20
# PostToolUse on Bash: a Google Doc was just edited. If any tab of it is a
# founder call script (a heading like "Firebox: 4:30 to 5:00"), run
# call_prep_check on the live doc and hand every FAIL back to the agent.
#
# Written 2026-10-28. The checker existed, but a tab had to remember to run
# it, and the Firebox script went out 1,000 words long ("Bro its wayyy too
# dense speak english"), with Gavin still in it after he dropped ("bro gav
# cant make it"), and with all three founders in one tab. Run by hand, the
# checker then found 10 FAILs in that tab. This makes the check the default
# after every doc write instead of a step to remember.
#
# Advisory: it never blocks and never shows Caleb an error
# (feedback_hooks_never_show_errors). The write already happened; the agent
# gets the FAIL lines and fixes the doc.

set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -n "$cmd" ] || exit 0

# The doc write is either inline (gws docs documents batchUpdate ...) or inside
# a python script the command runs, which is how the 10/28 edits were made.
src="$cmd"
for f in $(printf '%s' "$cmd" | grep -oE '[^[:space:]"'\'']+\.py' | head -5); do
  [ -f "$f" ] && src="$src
$(cat "$f" 2>/dev/null)"
done
printf '%s' "$src" | grep -q 'batchUpdate' || exit 0
printf '%s' "$src" | grep -qE 'docs' || exit 0

ids="$(printf '%s' "$src" | grep -oE '("documentId"|documentId|DOC)[^A-Za-z0-9_-]{1,8}[A-Za-z0-9_-]{30,}' \
  | grep -oE '[A-Za-z0-9_-]{30,}$' | sort -u | head -3)"
[ -n "$ids" ] || exit 0

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
checker="${CALL_PREP_CHECK:-}"
[ -n "$checker" ] || { [ -f "$here/../../bin/lib/call_prep_check.py" ] && checker="$here/../../bin/lib/call_prep_check.py"; }
[ -n "$checker" ] || checker="$HOME/.chewbacca/kit/current/bin/lib/call_prep_check.py"
[ -f "$checker" ] || exit 0

report=""
for id in $ids; do
  out="$(python3 "$checker" --doc "$id" --only-call-tabs 2>/dev/null)"
  fails="$(printf '%s' "$out" | grep '^FAIL' | head -12)"
  [ -n "$fails" ] && report="$report
doc $id:
$fails"
done
[ -n "$report" ] || exit 0

msg="call-prep-guard: the call script you just edited fails the call-prep check. Fix every line below in the doc, then rerun python3 bin/lib/call_prep_check.py --doc <id> --tab <founder> (add --absent <name> if someone can't make the call).$report"
jq -n --arg m "$msg" '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$m}}'
exit 0
