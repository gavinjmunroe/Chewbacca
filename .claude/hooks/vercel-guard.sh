#!/bin/bash
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

set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
cmd="$(jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -n "$cmd" ] || exit 0
printf '%s' "$cmd" | grep -qE '(^[[:space:]]*|[;&|(][[:space:]]*)(npx[[:space:]]+(-y[[:space:]]+)?)?vercel([[:space:]]|$)' || exit 0
printf '%s' "$cmd" | grep -qE 'vercel[[:space:]]+(remove|rm|project[[:space:]]+(rm|remove|ls)|ls|list|whoami|inspect|logout)\b' && exit 0

echo "vercel-guard: Caleb, 2026-10-10: \"never do anything on vercel ever again.\" Deploy to Railway instead: railway init -n <name> -w \"Caleb Newton's Projects\", railway add --service web, railway up --service web --detach (or link the GitHub repo so main auto-deploys), then railway-domain <name>. Removing an existing Vercel project is still allowed." >&2
exit 2
