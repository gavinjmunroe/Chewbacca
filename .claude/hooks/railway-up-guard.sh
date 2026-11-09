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

# A git commit whose message describes the incident contains the words this
# guard greps for. 2026-11-06: the commit that FIXED this guard was refused by
# it, because its message quoted "railway up". A git command deploys nothing,
# so it is never what this guard is for.
case "$cmd" in
  git\ *|*[\;\&\|]\ git\ *) exit 0 ;;
esac
printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+(commit|log|show|tag|notes|rebase|merge|revert|cherry-pick)([[:space:]]|$)' && exit 0

# The same bypass through the API. 2026-10-28, OPTRA: during Railway's
# "deployments stuck in initializing" outage a session canceled the stuck
# deploy and fired serviceInstanceDeployV2 at backboard.railway.com from a
# python heredoc, which skipped GitHub exactly like `railway up` and this guard
# never saw it. Caleb: "Bro NEVER deploy direectly to railway, alwasy usse
# github". `railway redeploy` is the CLI spelling of the same thing.
if printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])railway[[:space:]]+redeploy([[:space:]]|$)' \
  || { printf '%s' "$cmd" | grep -qiE 'backboard\.railway\.(com|app)|railway\.(com|app)/graphql' \
       && printf '%s' "$cmd" | grep -qE 'serviceInstanceDeploy|serviceInstanceRedeploy|deploymentRedeploy|deploymentInstanceExecutionCreate|environmentTriggersDeploy'; }; then
  echo "railway-up-guard: deploys go through GitHub only (Caleb, 2026-10-28: \"NEVER deploy directly to railway, always use github\"). Push to main, and if Railway's queue is stuck, check status.railway.com and push an empty commit once they recover. For a deliberate one-off, add RAILWAY_UP_OK='<reason>' to the command." >&2
  exit 2
fi

printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])railway[[:space:]]+up([[:space:]]|$)' || exit 0

cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)"
dir="$(printf '%s' "$cmd" | sed -nE 's/^[[:space:]]*cd[[:space:]]+([^;&|]+)[[:space:]]*&&.*/\1/p' | head -1)"
dir="${dir%"${dir##*[![:space:]]}"}"
dir="${dir/#\~/$HOME}"
case "$dir" in "") dir="$cwd" ;; /*) ;; *) dir="$cwd/$dir" ;; esac
[ -n "$dir" ] && [ -d "$dir" ] || exit 0
origin="$(git -C "$dir" remote get-url origin 2>/dev/null)"
# No GitHub origin used to exit 0 here, which waved through the worst case of
# all: a project with no repo, where `railway up` is the ONLY way it has ever
# deployed. 2026-11-06, bisc-talk-app: a whole night of deploys went up that
# way with no history and no rollback, and this guard watched every one of them
# go by because the repo had no remote. Caleb: "BRO NEVER USE RAILWAY W/O
# GITHUB HOW MANY TIMES DO I HV TO TELL U?????????".
case "$origin" in
  *github.com*) ;;
  *)
    echo "railway-up-guard: this repo has no GitHub remote, so \`railway up\` would be the only record this deploy ever existed (Caleb, 2026-11-06: \"NEVER USE RAILWAY W/O GITHUB\"). Run railway-connect in this folder: it creates the private repo, pushes, and attaches the service, after which git push is the deploy. For a deliberate one-off upload, add RAILWAY_UP_OK='<reason>' to the command." >&2
    exit 2
    ;;
esac

echo "railway-up-guard: this repo is on GitHub, so deploy through GitHub (Caleb, 2026-10-27: \"ALWAYS make a github repo and deploy through there\"). Run railway-connect once in this folder to attach the service to $origin, then git push to main is the deploy. For a deliberate one-off upload, add RAILWAY_UP_OK='<reason>' to the command." >&2
exit 2
