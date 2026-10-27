#!/bin/bash
# hookd skips this guard for a Bash call that names none of these words,
# each one its first check requires. Proven by tools/hookd_replay.py.
# gate: railway
[ -z "${HOOKD_INNER:-}" ] && [ -x "$HOME/.local/bin/hookd" ] && exec "$HOME/.local/bin/hookd" gate "$0" "$@"
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init railway-up-guard.sh 5
# PreToolUse on Bash: `railway up` in a repo that has a GitHub origin. Deploys
# go through GitHub: push to main, and Railway builds it.
#
# Written 2026-10-27. kyber-landing's service was made and fed with
# `railway up`, so it had no source repo; a pushed fix sat undeployed for ten
# minutes and Caleb wrote "Bro ALWAYS make a github repo and deploy through
# there never dont use github!!!!!!!!!". bin/railway-connect attaches the
# service to the repo once, after which a push is the deploy.
#
# Override for a deliberate one-off upload: RAILWAY_UP_OK='<reason>'.

set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -n "$cmd" ] || exit 0
case "$cmd" in *RAILWAY_UP_OK=*) exit 0 ;; esac
printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])railway[[:space:]]+up([[:space:]]|$)' || exit 0

cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)"
dir="$(printf '%s' "$cmd" | sed -nE 's/^[[:space:]]*cd[[:space:]]+([^;&|]+)[[:space:]]*&&.*/\1/p' | head -1)"
dir="${dir%"${dir##*[![:space:]]}"}"
dir="${dir/#\~/$HOME}"
case "$dir" in "") dir="$cwd" ;; /*) ;; *) dir="$cwd/$dir" ;; esac
[ -n "$dir" ] && [ -d "$dir" ] || exit 0
origin="$(git -C "$dir" remote get-url origin 2>/dev/null)"
case "$origin" in *github.com*) ;; *) exit 0 ;; esac

echo "railway-up-guard: this repo is on GitHub, so deploy through GitHub (Caleb, 2026-10-27: \"ALWAYS make a github repo and deploy through there\"). Run railway-connect once in this folder to attach the service to $origin, then git push to main is the deploy. For a deliberate one-off upload, add RAILWAY_UP_OK='<reason>' to the command." >&2
exit 2
