#!/bin/bash
# hookd skips this guard for a Bash call that names none of these words.
# gate: push deploy railway vercel publish up
[ -z "${HOOKD_INNER:-}" ] && [ -x "$HOME/.local/bin/hookd" ] && exec "$HOME/.local/bin/hookd" gate "$0" "$@"
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init live-event-guard.sh 5
#
# PreToolUse on Bash: nothing ships while he is standing in front of a room.
#
# 2026-11-06. He presented BISC 101's CRISPR talk at 10:00. Between 9:59 and
# 10:14, while he sat in that room waiting to go up, four changes were pushed
# to the presenter window he was about to use. The last one landed after he had
# already started. He went up with a tool he had never seen, read its bullets
# aloud, and afterwards: "Bro i ws j reading the bullet points and it wasnt
# coherent at all the whole time", then "Fix chewbs bro u failed me".
#
# The ledger knew. `coursework today --json` had the entry, type presentation,
# at 10:00, hours before any of it. Nothing read it.
#
# A tool in use during a graded live event is frozen. Anything learned during
# it goes into the next version, told to him in chat, never shipped under him.
# Override for a genuine emergency: LIVE_EVENT_OK='<reason>'.

set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
command -v coursework >/dev/null 2>&1 || exit 0

input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -n "$cmd" ] || exit 0
case "$cmd" in *LIVE_EVENT_OK=*) exit 0 ;; esac

# Only the things that actually reach him.
printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])(railway[[:space:]]+(up|redeploy)|vercel([[:space:]]+(deploy|--prod))?|git[[:space:]]+push|gh[[:space:]]+release[[:space:]]+create|npm[[:space:]]+publish|wrangler[[:space:]]+(deploy|publish))([[:space:]]|$)' || exit 0

# A graded live event today, from his own ledger. Minutes before it starts and
# while it is running, nothing ships.
window="$(coursework today --json 2>/dev/null | python3 -I -c '
import json, sys
from datetime import datetime, timedelta
BEFORE, AFTER = 30, 120   # minutes either side
try:
    d = json.load(sys.stdin)
except Exception:
    raise SystemExit
now = datetime.now()
for item in d.get("due", []):
    if item.get("type") not in ("presentation", "exam", "quiz", "interview", "defense"):
        continue
    at = item.get("at")
    if not at:
        continue
    try:
        h, m = (int(x) for x in at.split(":")[:2])
    except Exception:
        continue
    start = now.replace(hour=h, minute=m, second=0, microsecond=0)
    if start - timedelta(minutes=BEFORE) <= now <= start + timedelta(minutes=AFTER):
        print(f'"'"'{item.get("course","")}|{at}|{item.get("name","")[:70]}'"'"')
        break
' 2>/dev/null)"

[ -n "$window" ] || exit 0

course="${window%%|*}"; rest="${window#*|}"; at="${rest%%|*}"; name="${rest#*|}"
cat >&2 <<MSG
live-event-guard: refusing to ship. $course has a graded live event at $at today:
  $name

On 2026-11-06 four changes were pushed to his presenter window between 9:59
and 10:14 while he sat in the room waiting to present at 10:00. The last one
landed after he had started. He went up with a tool he had never seen.

A tool in use during a graded live event is frozen. Write the fix down, tell
him what to tap in chat, and ship after. For a genuine emergency, add
LIVE_EVENT_OK='<reason>' to the command.
MSG
exit 2
