#!/bin/bash
# vercel-guard refuses Vercel deploys and setup for a user who turned Vercel
# off (~/.chewbacca/policy/no-vercel), and lets teardown and plain mentions of
# the word through. A user who never chose that is never refused: the stranger
# test on 2026-10-12 found every install refusing Vercel with Caleb's quote.
set -u
HOOK="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/vercel-guard.sh"
H="$(mktemp -d)"
trap 'rm -rf "$H"' EXIT
fail=0
run() { printf '{"tool_input":{"command":"%s"}}' "$1" | HOME="$H" bash "$HOOK" >/dev/null 2>&1; echo $?; }
expect() { got=$(run "$2"); [ "$got" = "$1" ] || { echo "FAIL: expected $1, got $got for: $2"; fail=1; }; }
# No choice made: Vercel is the user's call.
expect 0 "vercel deploy --prod --yes"
expect 0 "cd site && npx vercel --prod"
mkdir -p "$H/.chewbacca/policy"
printf 'Deploy to Railway instead.\n' > "$H/.chewbacca/policy/no-vercel"
msg="$(printf '{"tool_input":{"command":"vercel deploy"}}' | HOME="$H" bash "$HOOK" 2>&1 >/dev/null)"
case "$msg" in *"Deploy to Railway instead."*) ;; *) echo "FAIL: the refusal doesn't carry the user's own line: $msg"; fail=1 ;; esac
case "$msg" in *Caleb*) echo "FAIL: the refusal names a person the user isn't: $msg"; fail=1 ;; esac
expect 2 "vercel deploy --prod --yes"
expect 2 "cd site && npx vercel --prod"
expect 2 "echo hi; vercel link"
expect 2 "vercel env add KEY"
expect 0 "vercel remove erik-fish-site --yes"
expect 0 "vercel project rm erik-fish-site"
expect 0 "grep vercel package.json"
expect 0 "railway up --service web --detach"
[ $fail = 0 ] && echo "vercel-guard: ok"
exit $fail
