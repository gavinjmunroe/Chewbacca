#!/bin/bash
# mail-app-guard refuses Mail.app and lets everything else through.
H="${MAIL_APP_GUARD_HOOK:-$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/mail-app-guard.sh}"
pass=0; fail=0
t() { # name, expected_exit, command
  out=$(printf '{"tool_name":"Bash","tool_input":{"command":%s}}' "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$3")" | HOOKD_INNER=1 bash "$H" 2>/dev/null)
  rc=$?
  if [ "$rc" = "$2" ]; then echo "  ok   $1 (exit $rc)"; pass=$((pass+1));
  else echo "  FAIL $1 (exit $rc, wanted $2)"; fail=$((fail+1)); fi
}
echo "SHOULD BLOCK (exit 2):"
# The two calls from 2026-10-13.
t "the incident search"     2 'mac mail search "fiber" --json 2>&1 | head -c 2000'
t "chained after another"   2 'mac mail accounts --json; mac mail search "invite" --json'
t "after a cd"              2 'cd ~ && mac mail unread --json'
t "inside a substitution"   2 'x=$(mac mail search "Ryan" --json)'
t "AppleScript to Mail"     2 "osascript -e 'tell application \"Mail\" to get unread count of inbox'"
t "the Mail.app store"      2 'sqlite3 ~/Library/Mail/V10/MailData/Envelope\ Index "select 1"'
# Break-it, 2026-10-19: each of these got through, and mac mail send sends.
t "full path to mac"        2 '/Users/x/.local/bin/mac mail send --to a@b.c --body hi'
t "behind env"              2 'env FOO=1 mac mail send --to a@b.c'
t "behind sudo"             2 'sudo mac mail unread'
t "behind time and nice"    2 'time nice -n 10 mac mail unread'
t "inside bash -c"          2 "bash -c 'mac mail send --to a@b.c'"
t "inside eval"             2 "eval 'mac mail unread'"
t "through xargs"           2 'echo x | xargs mac mail search'
t "inside a group"          2 '{ mac mail unread; }'
t "quoted verb"             2 'mac "mail" send --to a@b.c'
t "tell app Mail"           2 "osascript -e 'tell app \"Mail\" to send'"
t "the bundle id"           2 "osascript -e 'tell application id \"com.apple.mail\" to send'"
t "JXA"                     2 "osascript -l JavaScript -e 'Application(\"Mail\").send()'"
echo "SHOULD ALLOW (exit 0):"
t "gmail through the kit"   0 'chewbacca email'
t "connect an inbox"        0 'chewbacca email add calebnew@usc.edu'
t "messages, not mail"      0 'mac messages send +13105550100 "hi" --json'
t "mac calendar"            0 'mac calendar list --json'
t "the word mail in grep"   0 'grep -rn "mac mail" docs/'
t "an email address"        0 'echo jonah@zeutara.com'
echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
