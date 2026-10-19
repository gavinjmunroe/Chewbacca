#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init thinking-dash-guard.sh 5
# Catch em dashes in the THINKING, which Caleb reads in the editor.
#
# slop-guard reads last_assistant_message, the reply only. On 2026-10-10 he
# wrote "IT KEEPS FORGETTING AND DOING EM DASHES". Over the previous 24 hours
# replies carried none, and 80 thinking blocks did (51 Desktop, 25 SDK, 4
# VS Code). A memory note from 10/7 already said no em dashes in thinking
# either, and said the hook only checked replies. Nothing ever read thinking.
#
# Thinking can't be rewritten once it's on screen, and a refusal only adds a
# duplicate reply, so this never refuses. Two modes:
#
#   Stop         counts the dashes in this turn's thinking and queues them in
#                voice-flags.pending, which voice-remind.sh puts in front of
#                the next turn.
#   PostToolUse  reads thinking written since its last look and, on a dash,
#                tells the agent right then. On 2026-10-19 an overnight turn
#                ran 40 minutes and hundreds of tool calls without a Stop, put
#                7 dashes in thinking Caleb was reading live, and he asked why
#                the em dashes were back. The Stop mode never got to run.
#                Throttled to one transcript read per 20 seconds per session.
set -uo pipefail
INPUT="$(cat)"
STATE="${CHEWBACCA_HOME:-$HOME/.chewbacca}"
FIELDS="$(printf '%s' "$INPUT" | python3 -I -c 'import json,sys
try:
    d = json.load(sys.stdin)
    print("%s\t%s\t%s" % (d.get("transcript_path") or "", d.get("hook_event_name") or "Stop", d.get("session_id") or "nosession"))
except ValueError:
    pass' 2>/dev/null)"
TP="$(printf '%s' "$FIELDS" | cut -f1)"
EVENT="$(printf '%s' "$FIELDS" | cut -f2)"
SESSION="$(printf '%s' "$FIELDS" | cut -f3 | tr -cd 'A-Za-z0-9_-')"
[ -n "$TP" ] && [ -f "$TP" ] || exit 0

MARK=""
if [ "$EVENT" = "PostToolUse" ]; then
  mkdir -p "$STATE/thinking-dash" 2>/dev/null
  MARK="$STATE/thinking-dash/${SESSION:-nosession}"
  # Throttle: a tool call every few seconds must not reread a 100 MB transcript.
  if [ -f "$MARK" ] && [ -z "${THINKING_DASH_NO_THROTTLE:-}" ]; then
    age=$(( $(date +%s) - $(stat -f %m "$MARK" 2>/dev/null || stat -c %Y "$MARK" 2>/dev/null || echo 0) ))
    [ "$age" -lt 20 ] && exit 0
  fi
fi

REPORT="$(python3 -I - "$TP" "$EVENT" "$MARK" <<'PY'
import hashlib, json, os, sys
path, event, mark = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, "rb") as fh:
    fh.seek(0, 2)
    size = fh.tell()
    fh.seek(max(0, size - 2_000_000))
    lines = fh.read().splitlines()
last_seen = ""
if mark and os.path.exists(mark):
    last_seen = open(mark).read().strip()
turn, since, newest = [], [], last_seen
passed_mark = not last_seen
for raw in lines:
    try:
        rec = json.loads(raw)
    except ValueError:
        continue
    rid = rec.get("uuid") or hashlib.sha1(raw).hexdigest()[:16]
    content = (rec.get("message") or {}).get("content")
    if rec.get("type") == "user" and isinstance(content, str) and not content.startswith("<"):
        turn = []
    elif rec.get("type") == "assistant":
        for part in content or []:
            if isinstance(part, dict) and part.get("type") == "thinking":
                text = part.get("thinking") or ""
                turn.append(text)
                if passed_mark:
                    since.append(text)
                newest = rid
    if last_seen and rid == last_seen:
        passed_mark = True
# A mark that scrolled out of the 2 MB tail means everything here is new.
if last_seen and not passed_mark:
    since = turn
if mark:
    with open(mark, "w") as fh:
        fh.write(newest or "")
pool = since if event == "PostToolUse" else turn
hits = [t for t in pool if "—" in t or "–" in t]
if hits:
    n = sum(t.count("—") + t.count("–") for t in hits)
    t = hits[-1]
    i = max(t.find("—"), t.find("–"))
    print("%d\t%s" % (n, " ".join(t[max(0, i - 60):i + 40].split())))
PY
)"
[ -n "$REPORT" ] || exit 0
N="${REPORT%%	*}"
EX="${REPORT#*	}"
mkdir -p "$STATE" 2>/dev/null
printf '%s\t%s\n' "$(date '+%Y-%m-%d %H:%M')" "thinking-em-dash $N ${EVENT}" >> "$STATE/voice-flags.log"
if [ "$EVENT" = "PostToolUse" ]; then
  MSG="em-dash in your THINKING just now ($N), and Caleb reads thinking live: use commas and periods there too. e.g. > $EX" \
    python3 -I -c 'import json,os; print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": os.environ["MSG"]}}))'
  exit 0
fi
printf '%s\n' "em-dash in your THINKING last turn ($N), and Caleb reads thinking: write it with commas and periods like the reply. e.g. > $EX" >> "$STATE/voice-flags.pending"
exit 0
