#!/bin/bash
# railway-up-guard must refuse `railway up` in a repo with a GitHub origin and
# let everything else through.
# Incident: 2026-10-27, kyber-landing's service had no repo because it was fed
# with railway up, and a pushed fix never deployed.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/.claude/hooks/railway-up-guard.sh"
pass=0; fail=0
ok(){ printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }
command -v jq >/dev/null 2>&1 || { echo "  skip: jq not installed"; exit 0; }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/gh" "$T/plain" "$T/gh/sub"
git -C "$T/gh" init -q && git -C "$T/gh" remote add origin https://github.com/someone/site.git
git -C "$T/plain" init -q
run(){ jq -n --arg c "$1" --arg d "$2" '{tool_input:{command:$c},cwd:$d}' | HOOKD_INNER=1 bash "$HOOK" >/dev/null 2>&1; echo $?; }

[ "$(run 'railway up --detach' "$T/gh")" = 2 ] && ok "railway up in a GitHub repo is refused" || no "railway up in a GitHub repo is refused"
[ "$(run 'railway up' "$T/gh/sub")" = 2 ] && ok "railway up from a subfolder is refused" || no "railway up from a subfolder is refused"
[ "$(run "cd $T/gh && railway up --ci" "$T/plain")" = 2 ] && ok "cd into the GitHub repo first is still refused" || no "cd into the GitHub repo first is still refused"
[ "$(run 'railway up' "$T/plain")" = 0 ] && ok "railway up with no GitHub origin is allowed" || no "railway up with no GitHub origin is allowed"
[ "$(run "RAILWAY_UP_OK='hotfix while github is down' railway up" "$T/gh")" = 0 ] && ok "override with a reason allowed" || no "override with a reason allowed"
[ "$(run 'railway logs' "$T/gh")" = 0 ] && ok "railway logs is allowed" || no "railway logs is allowed"
[ "$(run 'railway domain' "$T/gh")" = 0 ] && ok "railway domain is allowed" || no "railway domain is allowed"
[ "$(run 'git push origin main' "$T/gh")" = 0 ] && ok "git push is allowed" || no "git push is allowed"
# Incident 2026-10-28: an API redeploy during an outage skipped GitHub.
[ "$(run "python3 - <<'EOF'
q('mutation(\$s:String!){serviceInstanceDeployV2(serviceId:\$s,environmentId:\"e\")}') # https://backboard.railway.com/graphql/v2
EOF" "$T/plain")" = 2 ] && ok "deploy mutation sent to the Railway API is refused" || no "deploy mutation sent to the Railway API is refused"
[ "$(run 'curl -s https://backboard.railway.com/graphql/v2 -d "{\"query\":\"mutation{deploymentRedeploy(id:\\\"x\\\"){id}}\"}"' "$T/plain")" = 2 ] && ok "deploymentRedeploy over curl is refused" || no "deploymentRedeploy over curl is refused"
[ "$(run 'railway redeploy -y' "$T/plain")" = 2 ] && ok "railway redeploy is refused" || no "railway redeploy is refused"
[ "$(run 'curl -s https://backboard.railway.com/graphql/v2 -d "{\"query\":\"query{deployment(id:\\\"x\\\"){status}}\"}"' "$T/plain")" = 0 ] && ok "a read query to the Railway API is allowed" || no "a read query to the Railway API is allowed"
[ "$(run 'python3 x.py  # serviceConnect via backboard.railway.com/graphql/v2' "$T/plain")" = 0 ] && ok "serviceConnect (attaching the repo) is allowed" || no "serviceConnect (attaching the repo) is allowed"
[ "$(run 'railway deployment list' "$T/gh")" = 0 ] && ok "railway deployment list is allowed" || no "railway deployment list is allowed"
python3 -m py_compile "$ROOT/bin/railway-connect" && ok "railway-connect compiles" || no "railway-connect compiles"
echo "  $pass passed, $fail failed"; [ "$fail" -eq 0 ]
