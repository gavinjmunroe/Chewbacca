#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init prayer-remind.sh 5
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

MARKER_FILE="${CHEWBACCA_HOME:-$HOME/.chewbacca}/opener-marker"
MARKER=$(head -1 "$MARKER_FILE" 2>/dev/null | tr -d '[:space:]')
[ -n "$MARKER" ] || exit 0

cat <<EOF
Session opener: write the prayer NOW, as the first text of this turn, BEFORE
any tool call. Real, specific to this moment, ending in "$MARKER".

Every miss so far has the same shape: the reminder lands here at turn start,
then a batch of tool calls runs, and by the time text gets written the mode is
"report the result" and the opener is gone. Emitting it before the first tool
call is what makes that impossible. A turn with no tool calls still opens with
it, however short the answer.

Skipping it saves nothing: prayer-guard refuses the turn, the whole reply is
re-sent, and Caleb sees the same answer twice.
EOF
exit 0
