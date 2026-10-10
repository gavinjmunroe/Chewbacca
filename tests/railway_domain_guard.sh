#!/bin/bash
# railway-domain-guard must refuse a Railway command that handed out a generated
# domain, and let everything else through.
# Incident: 2026-10-10, the Holy Spirit prayer tool shipped to Caleb as
# web-production-331de.up.railway.app.
set -uo pipefail
HOOK="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/railway-domain-guard.sh"
pass=0; fail=0
ok(){ printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }
command -v jq >/dev/null 2>&1 || { echo "  skip: jq not installed"; exit 0; }
run(){ jq -n --arg c "$1" --arg o "$2" '{tool_input:{command:$c},tool_response:{stdout:$o,stderr:""}}' | bash "$HOOK" >/dev/null 2>&1; echo $?; }
run_str(){ jq -n --arg c "$1" --arg o "$2" '{tool_input:{command:$c},tool_response:$o}' | bash "$HOOK" >/dev/null 2>&1; echo $?; }

[ "$(run 'railway domain' 'Service Domain created: https://web-production-331de.up.railway.app')" = 2 ] && ok "generated domain from railway domain is refused" || no "generated domain from railway domain is refused"
[ "$(run 'cd app && railway add --repo x/y --service web' 'https://api-production.up.railway.app')" = 2 ] && ok "generated domain without a hash is refused" || no "generated domain without a hash is refused"
[ "$(run_str 'railway up --detach' 'deployed to https://web-production-1a2b.up.railway.app')" = 2 ] && ok "string tool_response is read too" || no "string tool_response is read too"
[ "$(run 'railway domain' 'https://askforthefire.up.railway.app')" = 0 ] && ok "a clean domain is allowed" || no "a clean domain is allowed"
[ "$(run 'curl -s https://web-production-331de.up.railway.app/' 'https://web-production-331de.up.railway.app')" = 0 ] && ok "curling an old generated url is allowed" || no "curling an old generated url is allowed"
[ "$(run 'railway logs' 'GET https://web-production-331de.up.railway.app/ 200')" = 0 ] && ok "railway logs is not a domain-creating command" || no "railway logs is not a domain-creating command"
[ "$(run 'RAILWAY_DOMAIN_OK="internal" railway domain' 'https://web-production-331de.up.railway.app')" = 0 ] && ok "override with a reason allowed" || no "override with a reason allowed"
[ "$(run 'git status' '')" = 0 ] && ok "unrelated command allowed" || no "unrelated command allowed"
echo "  $pass passed, $fail failed"; [ "$fail" -eq 0 ]
