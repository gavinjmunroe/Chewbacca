#!/bin/bash
# attachment-guard refuses an osascript file send to Messages and allows send-file.
# 2026-11-03: an osascript-sent PDF did not open for Gavin.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
H="$ROOT/.claude/hooks/attachment-guard.sh"
fail=0
check() { # want command
  got=$(jq -n --arg c "$2" '{tool_name: "Bash", tool_input: {command: $c}}' | bash "$H" \
    | jq -r '.hookSpecificOutput.permissionDecision // "allow"' 2>/dev/null)
  [ -n "$got" ] || got=allow
  [ "$got" = "$1" ] || { echo "FAIL: want $1, got $got: $2"; fail=1; }
}
check deny 'osascript -e '"'"'tell application "Messages" to send (POSIX file "/Users/x/Downloads/a.pdf") to participant "+15550001111" of (1st account whose service type = iMessage)'"'"''
check allow 'send-file +15550001111 "/Users/x/Downloads/a.pdf" --text "here"'
check allow 'osascript -e "display notification \"done\""'
check allow 'mac messages send +15550001111 "hi"'
[ "$fail" = 0 ] && echo "ok: file texts go through send-file"
exit "$fail"
