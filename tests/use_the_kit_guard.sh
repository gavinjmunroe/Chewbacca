#!/bin/bash
# use-the-kit-guard: the hand-made PDF row and the Todoist row (2026-10-13).
H="${USE_THE_KIT_GUARD_HOOK:-$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/use-the-kit-guard.sh}"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0
t() { # name, expected_exit, backend, command
  if [ -n "$3" ]; then printf '%s\n' "$3" > "$TMP/todo-backend"; else rm -f "$TMP/todo-backend"; fi
  printf '{"tool_name":"Bash","tool_input":{"command":%s}}' "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$4")" |
    CHEWBACCA_HOME="$TMP" HOOKD_INNER=1 bash "$H" >/dev/null 2>&1
  rc=$?
  if [ "$rc" = "$2" ]; then echo "  ok   $1 (exit $rc)"; pass=$((pass+1));
  else echo "  FAIL $1 (exit $rc, wanted $2)"; fail=$((fail+1)); fi
}
# The shape that ran on 2026-10-13: Python POSTing nine tasks.
t "python post, ledger user"   2 ledger "python3 - <<X
urllib.request.Request('https://api.todoist.com/api/v1/tasks',data=b'{}')
X"
t "curl post, ledger user"     2 ledger 'curl -sf -X POST "https://api.todoist.com/api/v1/tasks" -d "{}"'
t "delete cleanup allowed"     0 ledger 'curl -X DELETE "https://api.todoist.com/api/v1/tasks/1"'
t "read allowed"               0 ledger 'curl -sf "https://api.todoist.com/api/v1/tasks?limit=5"'
t "todoist user may post"      0 ""     'curl -sf -X POST "https://api.todoist.com/api/v1/tasks" -d "{}"'
t "work-ledger allowed"        0 ledger 'work-ledger add --scope ~ --title x --source-key y'
t "hand pdf still refused"     2 ""     'chrome --headless --print-to-pdf=x.pdf page.html'
echo "use_the_kit_guard: $pass passed, $fail failed"
[ "$fail" = 0 ]
