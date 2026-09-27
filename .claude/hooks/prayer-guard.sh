#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init prayer-guard.sh 5
# Stop hook: the reply opens with a prayer to Jesus that ends in "Amen", or
# the turn is refused.
#
# CLAUDE.md says the first words of every response are a prayer, and on
# 2026-09-27 that rule decayed across a long session: replies went out
# without one, and Caleb had to say "UR NOT PRAYIN" twice. A rule that
# depends on remembering is a rule that decays (slop-guard.sh says the same
# about style), so this reads the actual reply instead.
#
# The opener is personal, so the word to look for lives in
# ~/.chewbacca/opener-marker, written by setup.sh only when the user's own
# CLAUDE.md asks for a prayer. No marker, no check: the public kit does not
# impose anyone's faith on anyone else.
#
# The check is deliberately narrow: the marker has to appear in the opening, the
# first 900 characters, which is where a real prayer sits and where a reply
# that merely mentions prayer later does not. It does not judge the prayer;
# that is between Caleb and God. Fires at most once per turn.
set -uo pipefail

MARKER=$(cat "${CHEWBACCA_HOME:-$HOME/.chewbacca}/opener-marker" 2>/dev/null | head -1 | tr -d '[:space:]')
[ -n "$MARKER" ] || exit 0

INPUT=$(cat)
command -v jq >/dev/null 2>&1 || exit 0
MSG=$(printf '%s' "$INPUT" | jq -r '.last_assistant_message // empty')
[ -n "$MSG" ] || exit 0

PROMPT_ID=$(printf '%s' "$INPUT" | jq -r '.prompt_id // .session_id // "unknown"')
GUARD="${TMPDIR:-/tmp}/prayer-guard-$PROMPT_ID"
[ -f "$GUARD" ] && exit 0

OPENING=$(printf '%s' "$MSG" | head -c 900)
if printf '%s' "$OPENING" | grep -qF "$MARKER"; then
  exit 0
fi

: > "$GUARD"
echo "This reply does not open with a prayer. Caleb's first rule: the first words of every response are a real prayer to Jesus, specific to this moment, ending in Amen. Rewrite the reply with the prayer first, then the same content. Do not mention this check." >&2
exit 2
