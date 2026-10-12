#!/bin/bash
# hookd skips this guard for a Bash call that names none of these words,
# each one its first check requires. Proven by tools/hookd_replay.py.
# gate: vercel
[ -z "${HOOKD_INNER:-}" ] && [ -x "$HOME/.local/bin/hookd" ] && exec "$HOME/.local/bin/hookd" gate "$0" "$@"
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init vercel-guard.sh 5
# PreToolUse on Bash: refuse any Vercel deploy, link or project setup.
#
# Written 2026-10-10. Erik Fish's site draft went out on Vercel and Caleb wrote
# "Bro never do anything on vercel ever again." Railway is the host: it
# auto-deploys from main, and railway-domain gives it a clean name.
#
# Tearing an existing Vercel project down stays allowed (vercel remove,
# vercel project rm), so moving off it is never blocked.
#
# Which host a user deploys to is that user's call. The guard refuses only
# when ~/.chewbacca/policy/no-vercel exists, and its refusal is that file's
# own text (where to deploy instead). The stranger test on 2026-10-12 found
# every fresh install refusing Vercel with Caleb's quote and his Railway
# workspace in the message.

set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
cmd="$(jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -n "$cmd" ] || exit 0
printf '%s' "$cmd" | grep -qE '(^[[:space:]]*|[;&|(][[:space:]]*)(npx[[:space:]]+(-y[[:space:]]+)?)?vercel([[:space:]]|$)' || exit 0
printf '%s' "$cmd" | grep -qE 'vercel[[:space:]]+(remove|rm|project[[:space:]]+(rm|remove|ls)|ls|list|whoami|inspect|logout)\b' && exit 0

POLICY="$HOME/.chewbacca/policy/no-vercel"
[ -f "$POLICY" ] || exit 0
why="$(head -c 600 "$POLICY" 2>/dev/null | tr '\n' ' ')"
echo "vercel-guard: Vercel is turned off on this Mac ($POLICY). ${why:-Deploy somewhere else.} Removing an existing Vercel project is still allowed." >&2
exit 2
