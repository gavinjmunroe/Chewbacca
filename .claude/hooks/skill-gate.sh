#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init skill-gate.sh 5
# PreToolUse: when skill-route named an ENFORCED skill for this prompt, refuse
# the first tool call that isn't loading it.
#
# skill-route.sh names skills as advice. For graph-engineering that advice was
# skipped on several prompts in one session on 2026-09-29, after the identical
# skip on 2026-09-21, and Caleb had to say it out loud both times. This turns
# the router's line into one refusal: load the skill, or be stopped once.
#
# It refuses ONCE and then clears the marker, so a skill that truly doesn't fit
# costs one tool call, never a loop.
set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
INPUT=$(cat)
SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' | tr -cd 'A-Za-z0-9_-')
[ -n "$SID" ] || exit 0
STATE="${CHEWBACCA_HOME:-$HOME/.chewbacca}/state"
MARK="$STATE/skill-required-$SID"
TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty')
# Record every load, marker or not, so skill-route stops gating a skill that
# is already in this session's context.
if [ "$TOOL" = "Skill" ]; then
  ASKED=$(printf '%s' "$INPUT" | jq -r '.tool_input.skill // empty')
  [ -n "$ASKED" ] && mkdir -p "$STATE" && echo "${ASKED##*:}" >> "$STATE/skill-loaded-$SID"
fi
[ -s "$MARK" ] || exit 0

if [ "$TOOL" = "Skill" ]; then
  # A scoped variant ("repo:graph-engineering") counts as the skill.
  if grep -qxF "${ASKED##*:}" "$MARK"; then rm -f "$MARK"; fi
  exit 0
fi

NEED=$(tr '\n' ' ' < "$MARK")
rm -f "$MARK"
echo "skill-gate: the router named ${NEED}for this request, and it hasn't been loaded. Load it with the Skill tool before acting, and apply it: fan out independent work, verify from ground truth. If it truly doesn't fit, load it anyway and say why in one line." >&2
exit 2
