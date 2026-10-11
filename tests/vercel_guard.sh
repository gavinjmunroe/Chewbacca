#!/bin/bash
# vercel-guard refuses Vercel deploys and setup, and lets teardown and plain
# mentions of the word through.
set -u
HOOK="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/vercel-guard.sh"
fail=0
run() { printf '{"tool_input":{"command":"%s"}}' "$1" | bash "$HOOK" >/dev/null 2>&1; echo $?; }
expect() { got=$(run "$2"); [ "$got" = "$1" ] || { echo "FAIL: expected $1, got $got for: $2"; fail=1; }; }
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
