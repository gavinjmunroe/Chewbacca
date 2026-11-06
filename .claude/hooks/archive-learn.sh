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
#
# 2026-11-03 9:14pm: "Writ hw" was archived and its child "Make brightspace
# post instant by course and topic name" showed up archived 28 seconds later.
# Auto-archive was off and no agent called archive_session, so the parent
# archive took the child with it (archive_session docs: finished side sessions go with the parent).
# Caleb: "a brightspace tab j randomly disappeared/archived?" Step 4 is that.
#
# 2026-11-05: this hook was never registered on his Mac, so "can I archive this
# tab" got a bare yes. He then said "Ima archive should be the same as can i
# archive" and "dont make it word hard coded! Close this tab, peace, so many
# ways bro ur an llm not an if statement". So nothing here matches words. It
# puts the question to the model already reading his message, every prompt.


cat >/dev/null
type hook_unbuffer >/dev/null 2>&1 && hook_unbuffer  # stderr goes straight to the host from here on
exec python3 -I <<'PY'
import json
ctx = (
    "If his message means he's finished with this tab, in any wording, get it ready before you answer, "
    "without being asked. Judge the meaning: 'peace' and 'ima archive' are yes, peace of mind and "
    "archiving an email are no. Steps are in do-it-yourself.md under ANY SIGN HE'S DONE WITH THIS TAB."
)
print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": ctx}}))
PY
