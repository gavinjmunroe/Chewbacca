#!/bin/bash
# railway-up-guard: deploys go through GitHub, never `railway up`.
#
# The case that matters most here is a repo with NO remote. The guard shipped
# 2026-10-27 only refused when the repo already had a GitHub origin, and exited
# 0 otherwise, which waved through the one state Caleb actually cares about: a
# project with no repo at all, where `railway up` is the only way it has ever
# deployed. On 2026-11-06 bisc-talk-app deployed that way all night, with no
# history and no rollback, and the guard saw every one of them go past. Caleb:
# "BRO NEVER USE RAILWAY W/O GITHUB HOW MANY TIMES DO I HV TO TELL U?????????".
H="${RAILWAY_UP_GUARD_HOOK:-$HOME/.claude/hooks/railway-up-guard.sh}"
[ -f "$H" ] || { echo "SKIP railway_up_guard: no hook at $H"; exit 0; }
command -v jq >/dev/null 2>&1 || { echo "SKIP railway_up_guard: jq missing"; exit 0; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/norem" "$tmp/gh" "$tmp/other"
for d in norem gh other; do git -C "$tmp/$d" init -q; done
git -C "$tmp/gh" remote add origin https://github.com/calebnewtonusc/x.git
git -C "$tmp/other" remote add origin https://gitlab.com/someone/x.git

pass=0; fail=0
t() { # name, expected_exit, dir, command
  rc=0
  printf '{"tool_name":"Bash","tool_input":{"command":%s},"cwd":%s}' \
    "$(python3 -I -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$4")" \
    "$(python3 -I -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$3")" \
    | HOOKD_INNER=1 bash "$H" >/dev/null 2>&1 || rc=$?
  if [ "$rc" = "$2" ]; then echo "  ok   $1 (exit $rc)"; pass=$((pass + 1))
  else echo "  FAIL $1 (exit $rc, wanted $2)"; fail=$((fail + 1)); fi
}

echo "SHOULD REFUSE (exit 2):"
# The 2026-11-06 incident itself: no remote, so there is nothing to push to.
t "railway up with no remote"    2 "$tmp/norem" "railway up --ci"
t "no remote, behind a cd"       2 "$tmp/norem" "cd $tmp/norem && railway up"
t "no remote, origin not GitHub" 2 "$tmp/other" "railway up --ci"
# The case the guard already covered, kept so a rewrite cannot drop it.
t "railway up with a GitHub origin" 2 "$tmp/gh" "railway up --ci"
t "railway redeploy"                2 "$tmp/gh" "railway redeploy"
t "serviceInstanceDeploy over the API" 2 "$tmp/gh" \
  "curl -s https://backboard.railway.com/graphql/v2 -d '{\"query\":\"mutation{serviceInstanceDeployV2}\"}'"

echo "SHOULD PASS (exit 0):"
t "a deliberate one-off"   0 "$tmp/norem" "RAILWAY_UP_OK='one-off, no project yet' railway up"
t "railway status"         0 "$tmp/norem" "railway status"
t "railway link"           0 "$tmp/norem" "railway link"
t "railway-connect itself" 0 "$tmp/norem" "railway-connect --branch main"
t "a push"                 0 "$tmp/gh"    "git push origin main"
# 2026-11-06: the commit that fixed this guard was refused by this guard,
# because its message quoted the words "railway up". Git deploys nothing.
t "a commit quoting the words" 0 "$tmp/norem" "git commit -q -m 'fix: refuse railway up when a repo has no remote'"
t "a commit from a file"       0 "$tmp/norem" "git commit -F /tmp/msg.txt # mentions railway up"
t "git log grepping for it"    0 "$tmp/gh"    "git log --oneline --grep='railway up'"

echo "railway_up_guard: $pass passed, $fail failed"
[ "$fail" = 0 ]
