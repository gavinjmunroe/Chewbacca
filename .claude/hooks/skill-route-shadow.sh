#!/bin/bash
# UserPromptSubmit: Jev and the keyword router each pick a skill for the
# prompt, logged side by side as `skill-route` in ~/.bob/decisions.jsonl.
# Shows nothing and acts on nothing; skill-route.sh still does the routing.
# Detached, so the prompt never waits on Jev. Off: SKILL_ROUTE_SHADOW=off.
[ "${SKILL_ROUTE_SHADOW:-on}" = "off" ] && exit 0
ROOT="${CHEWBACCA_ROOT:-$HOME/Chewbacca}"
TOOL="$ROOT/tools/skill_route_shadow.py"
[ -f "$TOOL" ] || exit 0
payload=$(cat)
printf '%s' "$payload" | nohup python3 "$TOOL" >/dev/null 2>&1 &
exit 0
