#!/bin/bash
# Nothing ships while he is standing in front of a room.
#
# 2026-11-06: four pushes landed on his presenter window between 9:59 and
# 10:14 while he waited to present at 10:00, the last one after he had already
# started. He went up with a tool he had never seen, read its bullets aloud,
# and said afterwards "it wasnt coherent at all the whole time". The ledger had
# carried "type: presentation, at: 10:00" since the night before. Nothing read
# it. This test is the thing that reads it.
H="${LIVE_EVENT_GUARD_HOOK:-$HOME/.claude/hooks/live-event-guard.sh}"
[ -f "$H" ] || { echo "SKIP live_event_guard: no hook at $H"; exit 0; }
command -v jq >/dev/null 2>&1 || { echo "SKIP live_event_guard: jq missing"; exit 0; }

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

# A stub `coursework` reporting one presentation at a time each case picks.
mkstub() {
  if [ "$1" = "none" ]; then
    cat > "$tmp/coursework" <<'EOF'
#!/bin/bash
[ "$1" = "today" ] || exit 0
echo '{"due":[],"classes":[]}'
EOF
  else
    cat > "$tmp/coursework" <<EOF
#!/bin/bash
[ "\$1" = "today" ] || exit 0
echo '{"due":[{"course":"BISC 101Lxg","name":"Lab presentation: CRISPR Cas9","type":"presentation","at":"$1"}],"classes":[]}'
EOF
  fi
  chmod +x "$tmp/coursework"
}

# The window is start-30min to start+120min, so each case pins the stub
# relative to the real clock rather than to a fixed hour.
at() { python3 -I -c "
from datetime import datetime, timedelta
print((datetime.now() + timedelta(minutes=$1)).strftime('%H:%M'))"; }

pass=0; fail=0
t() { # name, expected_exit, at, command
  mkstub "$3"
  rc=0
  printf '{"tool_name":"Bash","tool_input":{"command":%s}}' \
    "$(python3 -I -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$4")" \
    | PATH="$tmp:$PATH" HOOKD_INNER=1 bash "$H" >/dev/null 2>&1 || rc=$?
  if [ "$rc" = "$2" ]; then echo "  ok   $1 (exit $rc)"; pass=$((pass + 1))
  else echo "  FAIL $1 (exit $rc, wanted $2)"; fail=$((fail + 1)); fi
}

echo "SHOULD REFUSE (exit 2):"
# These four are the actual pushes from 2026-11-06, by shape.
t "push 10 min before he presents"  2 "$(at 10)"   "git push origin main"
t "push while he is presenting"     2 "$(at -20)"  "cd ~/code/bisc-talk-app && git push -q origin main"
t "railway up just before"          2 "$(at 5)"    "railway up --ci"
t "railway redeploy during"         2 "$(at -5)"   "railway redeploy"
t "at the very edge of the window"  2 "$(at 29)"   "git push origin main"
t "npm publish during"              2 "$(at -30)"  "npm publish"
t "wrangler deploy before"          2 "$(at 15)"   "wrangler deploy"

echo "SHOULD PASS (exit 0):"
t "a real emergency, overridden"      0 "$(at 10)"   "LIVE_EVENT_OK='he asked out loud for it' git push origin main"
t "well before the window opens"      0 "$(at 200)"  "git push origin main"
t "well after it has ended"           0 "$(at -300)" "git push origin main"
t "no live event today at all"        0 "none"       "git push origin main"
t "a build, which ships nothing"      0 "$(at 10)"   "npx next build"
t "a commit, which ships nothing"     0 "$(at 10)"   "git commit -m 'fix the thing'"
t "reading his own ledger"            0 "$(at 10)"   "coursework today"
t "a test run"                        0 "$(at 10)"   "bash tests/run.sh"

echo "live_event_guard: $pass passed, $fail failed"
[ "$fail" = 0 ]
