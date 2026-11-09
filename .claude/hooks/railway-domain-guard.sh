#!/bin/bash
# hookd skips this guard for a Bash call that names none of these words,
# each one its first check requires. Proven by tools/hookd_replay.py.
# gate: railway
[ -z "${HOOKD_INNER:-}" ] && [ -x "$HOME/.local/bin/hookd" ] && exec "$HOME/.local/bin/hookd" gate "$0" "$@"
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init railway-domain-guard.sh 5
# PostToolUse on Bash: a Railway command just handed out a generated domain
# (web-production-331de.up.railway.app). Rename it before that URL reaches
# anyone.
#
# Written 2026-10-10. The Holy Spirit prayer tool shipped to Caleb as
# web-production-331de.up.railway.app and he wrote "Bro ALWAYS clean up the
# domain on railway deploys fix chewbs". bin/railway-domain renames it to
# <project>.up.railway.app in one call, so the guard sends the agent there.
#
# Only fires on a railway command whose output contains a generated name, so
# curling or mentioning an old URL never trips it. Override for a service whose
# generated name is deliberate: RAILWAY_DOMAIN_OK='<reason>' in the command.

set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -n "$cmd" ] || exit 0
case "$cmd" in *RAILWAY_DOMAIN_OK=*) exit 0 ;; esac
printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])railway[[:space:]]+(domain|add|up|init|deploy)\b' || exit 0

out="$(printf '%s' "$input" | jq -r '.tool_response | if type == "string" then . else ((.stdout // "") + "\n" + (.stderr // "")) end' 2>/dev/null)"
domain="$(printf '%s' "$out" | grep -oE '[a-z0-9-]+-production(-[a-z0-9]{4,6})?\.up\.railway\.app' | head -1)"
[ -n "$domain" ] || exit 0

echo "railway-domain-guard: Railway just generated $domain. Caleb wants every deploy on a clean name (2026-10-10: \"ALWAYS clean up the domain on railway deploys\"). Run railway-domain <name> now from the linked directory, using the project's real name, and give him that URL instead. If the generated name is deliberate, add RAILWAY_DOMAIN_OK='<reason>' to the command." >&2
exit 2
