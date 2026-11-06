#!/bin/bash
# hookd skips this guard for a Bash call that names none of these words,
# each one its first check requires. Proven by tools/hookd_replay.py.
# gate: create pulls
[ -z "${HOOKD_INNER:-}" ] && [ -x "$HOME/.local/bin/hookd" ] && exec "$HOME/.local/bin/hookd" gate "$0" "$@"
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init pr-guard.sh 5
# PreToolUse on Bash: refuse opening a pull request on a BMA or Amber repo.
#
# Written 2026-10-11. Two Togari fixes (#84, #85) sat as PRs with Railway
# deploying only main, and Caleb wrote "karthik told me never pr on anything
# bma or amber just push to main". Those repos take a rebase, the touched
# tests, and git push origin HEAD:main.
#
# The org is read from --repo/-R, or else from the origin remote of the
# directory the command runs in.

set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -n "$cmd" ] || exit 0
# The API route opens the same PR: stress test, 2026-11-05.
printf '%s' "$cmd" | grep -qE '(^|[;&|(][[:space:]]*|[[:space:]])gh[[:space:]]+(pr[[:space:]]+create\b|api[[:space:]].*pulls\b.*(-X[[:space:]]*POST|--method[[:space:]]+POST|-f[[:space:]]))' || exit 0

ORGS='bluemodernadvisory|amberintelligence|amber-organization'
if printf '%s' "$cmd" | grep -qiE "((--repo[= ]|-R[[:space:]]+)[^[:space:]]*|repos/)($ORGS)/"; then
  hit=1
else
  dir="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)"
  cd_to="$(printf '%s' "$cmd" | sed -nE 's/^[[:space:]]*cd[[:space:]]+([^;&|]+).*/\1/p' | sed -E 's/[[:space:]]+$//')"
  [ -n "$cd_to" ] && dir="${cd_to/#\~/$HOME}"
  remote="$(git -C "${dir:-.}" remote get-url origin 2>/dev/null || true)"
  printf '%s' "$remote" | grep -qiE "($ORGS)/" && hit=1 || hit=0
fi
[ "$hit" = 1 ] || exit 0

echo "pr-guard: Karthik, via Caleb 2026-10-11: \"never pr on anything bma or amber just push to main\". Rebase on origin/main, run the touched tests and tsc --noEmit, then git push origin HEAD:main. Railway deploys main." >&2
exit 2
