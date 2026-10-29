#!/bin/bash
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init archive-learn.sh 3
# Archive means learn first, for this tab and every tab it started.
#
# THE FAILURE THIS EXISTS FOR, 2026-10-29. Caleb asked "Can I archive this tab
# and the 3 other child tabs?" The reply said yes and offered an archive
# button. It never told the three child tabs to turn the day's corrections into
# kit code. He had to write "MAKE SURE YOU TELL ALL OF THEM TO LEARN EVERYTHING
# AND REMEMBER EVERYTHING AND BUILD LESSONS INTO CHEWB!" and then "I should
# never have to say this again."
#
# So any archive or close question puts the closeout in front of the agent:
# message every linked session, land each lesson as a tool, test, gate, default
# or skill section, and answer only after the commits exist. Silent otherwise.

PAYLOAD=$(cat)
export PAYLOAD
exec python3 -I <<'PY'
import json, os, re
try:
    prompt = (json.loads(os.environ.get("PAYLOAD") or "{}").get("prompt") or "")
except ValueError:
    raise SystemExit(0)
low = prompt.lower()
ASK = re.compile(r"\b(archiv\w*|close (this|the|these|all|my) (tab|tabs|session|sessions)|"
                 r"safe to close|can i close|done with (this|these) tabs?|kill (this|these) tabs?)\b")
if not ASK.search(low):
    raise SystemExit(0)
ctx = (
    "Archive means LEARN FIRST (Caleb, 2026-10-29: \"I should never have to say this again\"). "
    "Before answering: 1) list linked sessions (mcp__ccd_session_mgmt__list_sessions linked) and "
    "SendMessage each one: list every correction and every break from its work, land each as a tool, "
    "test, gate, default or skill section in Chewbacca with `chewbacca land`, FF/Amber/Chewbacca facts "
    "in team/memory, and reply with one line per lesson and its commit. 2) Do the same for this "
    "session's own lessons. 3) Answer the archive question only once those commits exist, naming them. "
    "A memory note alone does not count."
)
print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": ctx}}))
PY
