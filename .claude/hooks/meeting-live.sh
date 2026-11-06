#!/bin/bash
# UserPromptSubmit: the call he's on reaches the tab he asks about it in.
#
# On 2026-11-06 the owner was still copying Granola's transcript into a tab mid-call,
# while room-capture was already writing it to disk every 15 s. A tab that asks
# about the call now gets the new lines on each prompt. Any other tab gets one
# line, once per meeting. Rules, privacy and the untrusted wrapper live in
# bin/lib/meeting_live.py. `meeting-live tabs off` turns it off.
#
# No helper pid means no recording, so almost every prompt stops at this line
# with no python started.
[ -s "$HOME/.chewbacca/room-capture/helper.pid" ] || exit 0
TOOL="$(command -v meeting-live || echo "$HOME/.local/bin/meeting-live")"
[ -x "$TOOL" ] || exit 0
"$TOOL" hook 2>/dev/null
exit 0
