#!/usr/bin/env bash
# focus-guard on every case it has to get right. The first assertions are
# refusals, so a guard that returns early can never pass this file.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
GUARD="$ROOT/.claude/hooks/focus-guard.sh"
FAILED=0
note() { echo "    $1"; }
fail() { echo "    FAIL: $1"; FAILED=1; }

run() {
  local cmd; cmd="$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$1")"
  printf '{"session_id":"t","tool_name":"%s","tool_input":{"command":%s}}' "${2:-Bash}" "$cmd" \
    | bash "$GUARD" >/dev/null 2>&1
  echo $?
}
blocks() { local got; got="$(run "$1")"; [ "$got" = "2" ] && note "blocks: $1" || fail "$1 exited $got, expected 2"; }
allows() { local got; got="$(run "$1" "${2:-Bash}")"; [ "$got" = "0" ] && note "allows: $1" || fail "$1 exited $got, expected 0"; }

[ -x "$GUARD" ] || { echo "    FAIL: $GUARD is not executable"; exit 1; }

blocks 'open https://app.clay.com/workspaces/1/home'
blocks 'open -a "Google Chrome" https://brightspace.usc.edu/d2l/home'
blocks 'open -na "Google Chrome" --args --profile-directory="Profile 1" https://x.example'
blocks 'cd ~/code && open http://localhost:3000'
blocks 'FOO=1 /usr/bin/open ~/Downloads/report.pdf'
blocks 'osascript -e '"'"'tell application "Google Chrome" to activate'"'"
allows 'open -g https://app.clay.com/workspaces/1/home'
allows 'open -g -a "Google Chrome" https://x.example'
blocks 'open -gna "Google Chrome" --args --new-window https://x.example'
blocks 'open -g -na "Google Chrome" --args --profile-directory="Profile 1" https://brightspace.usc.edu/d2l/home'
allows 'open -g -n /Applications/Calculator.app'
allows 'open -R ~/Downloads/report.pdf'
allows 'open "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Calendars"'
allows 'open https://x.example  # foreground: Caleb asked to see it'
allows 'git log --oneline | head'
allows 'echo "we open at nine"'
allows 'open https://x.example' Read

exit $FAILED
