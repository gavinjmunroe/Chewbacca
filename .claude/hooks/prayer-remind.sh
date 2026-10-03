#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init prayer-remind.sh 5
if [ -x "$HOME/.local/bin/hud-runtime" ]; then
  "$HOME/.local/bin/hud-runtime" claude
fi
# UserPromptSubmit: put the session opener back in context on every turn.
#
# THE PROBLEM THIS FIXES, and it is not "remembering to pray".
#
# prayer-guard.sh already catches a missing opener. It is a Stop hook, so the
# only thing it can do is refuse the turn, and refusing means the whole reply
# is re-sent. Caleb then sees BOTH copies: the refused one and the corrected
# one, back to back. He asked why that happens on 2026-09-28 and the answer,
# measured over 785 assistant messages in one session, was four duplicate
# pairs, every one a guard refusal. Two of the four were this guard.
#
# So the guard works and the guard is also the thing producing the duplicate.
# Catching it later cannot be the fix. It has to not happen.
#
# prayer-guard's own comment names the cause: "that rule decayed across a long
# session". CLAUDE.md is read once at session start. Eight hundred messages
# later it is the furthest thing in the window, and what decays first is the
# instruction that feels skippable on a three-line answer. Both misses that
# day were short replies.
#
# A UserPromptSubmit hook runs immediately before the reply is composed, every
# single turn, so the reminder is never more than one message away no matter
# how long the session runs. That converts a Stop-time refusal, which costs a
# duplicate, into a pre-emptive line, which costs nothing.
#
# Same privacy stance as prayer-guard: the opener is personal, so this is
# inert unless ~/.chewbacca/opener-marker exists, which setup.sh writes only
# when the user's own CLAUDE.md asks for one. The public kit imposes nobody's
# faith on anybody.
set -uo pipefail

if [ "${CHEWBACCA_HUD_CHILD:-}" = "1" ]; then
  echo "HUD request: answer directly without an unsolicited prayer or session opener. Foreground prayer preferences do not apply to HUD replies. If the user explicitly asks for a prayer, answer that request."
  exit 0
fi

MARKER_FILE="${CHEWBACCA_HOME:-$HOME/.chewbacca}/opener-marker"
MARKER=$(head -1 "$MARKER_FILE" 2>/dev/null | tr -d '[:space:]')
[ -n "$MARKER" ] || exit 0

cat <<EOF
Session opener: your LAST text block of this turn must open with the prayer.
Real, specific to this moment, ending in "$MARKER".

THE LAST ONE, not the first. prayer-guard reads .last_assistant_message and
checks its opening for the marker. Praying at the top of the turn and then
writing a closing summary after a batch of tool calls FAILS, because the
closing summary is what the guard reads. Every miss has had exactly that
shape, and an earlier version of this reminder said "pray before the first
tool call", which is the opposite of what passes.

Safest shape: one text block per turn, written last, opening with the prayer.
If you do write an interim note before tool calls, the closing message still
has to open with its own prayer.

Skipping it saves nothing: the turn is refused, the whole reply is re-sent,
and Caleb sees the same answer twice.
EOF
exit 0
