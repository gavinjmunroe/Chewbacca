#!/usr/bin/env bash
# tab-rescue: flags a tab whose last reply is a limit error, skips finished tabs,
# automation and tabs that recovered, reports each death once through the hook.
# sim-reap: shuts down a booted simulator only when nothing is driving it.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export CHEWBACCA_LOG_DIR="$T/logs" CHEWBACCA_NO_NOTIFY=1 TAB_RESCUE_PROJECTS="$T/projects"
P="$T/projects/-repo"; mkdir -p "$P"
fail=0
ok() { if eval "$2"; then echo "  ok    $1"; else echo "  FAIL  $1"; fail=$((fail+1)); fi; }

session() {  # session <id> <entrypoint> <cwd> <ask> <last assistant text>
  python3 - "$P/$1.jsonl" "$2" "$3" "$4" "$5" <<'EOF'
import json, sys
path, entry, cwd, ask, last = sys.argv[1:]
rows = [
  {"type": "user", "entrypoint": entry, "cwd": cwd, "message": {"content": ask}},
  {"type": "assistant", "timestamp": "2026-10-10T21:00:00Z",
   "message": {"content": [{"type": "text", "text": "working on it"}]}},
  {"type": "user", "message": {"content": "Stop hook feedback: ignore me"}},
  {"type": "assistant", "timestamp": "2026-10-10T21:47:20Z",
   "message": {"content": [{"type": "text", "text": last}]}},
]
open(path, "w").write("\n".join(json.dumps(r) for r in rows) + "\n")
EOF
}
LIMIT="You've hit your weekly limit · resets Oct 16 at 7am (America/Los_Angeles)"
session dead1 claude-desktop /Users/x/code/site "Fix the sites based on what Tyler just texted" "$LIMIT"
session done1 claude-desktop /Users/x/code/site "Ship the page" "Pushed, all done."
session sdk1  sdk-py /Users/x/code/site "Review this change" "$LIMIT"
session probe claude-desktop /private/tmp "say ok" "$LIMIT"
python3 -c "import json,sys; open(sys.argv[1],'w').write('\\n'.join(json.dumps(r) for r in [{'type':'user','entrypoint':'claude-desktop','cwd':'/Users/x/code','message':{'content':'You are a blind image judge'}},{'type':'assistant','timestamp':'2026-10-10T21:50:00Z','message':{'content':[{'type':'text','text':sys.argv[2]}]}}]))" "$P/oneshot.jsonl" "$LIMIT"

out=$(python3 -I "$ROOT/bin/tab-rescue" --json)
ok "finds the tab that died on the limit" 'printf %s "$out" | python3 -c "import json,sys; d=json.load(sys.stdin); assert [x[\"session\"] for x in d]==[\"dead1\"]"'
ok "reads the reset time" 'printf %s "$out" | grep -q "Oct 16 at 7am"'
ok "prompt points at the transcript and the ask" 'printf %s "$out" | grep -q "dead1.jsonl" && printf %s "$out" | grep -q "Tyler just texted"'

hook=$(python3 -I "$ROOT/bin/tab-rescue" --new --hook)
ok "hook payload is one JSON document" 'printf %s "$hook" | python3 -c "import json,sys; json.load(sys.stdin)"'
ok "hook names Desktop's separate account" 'printf %s "$hook" | grep -q "claude auth status"'
again=$(python3 -I "$ROOT/bin/tab-rescue" --new --hook)
ok "the same death is reported once" '[ -z "$again" ]'

session dead1 claude-desktop /Users/x/code/site "Fix the sites based on what Tyler just texted" "Fixed the nav, pushed."
ok "a tab that recovered is no longer flagged" '[ "$(python3 -I "$ROOT/bin/tab-rescue" --json)" = "[]" ]'

touch -t 202001010000 "$P/sdk1.jsonl"
session old claude-desktop /Users/x/code/a "Old work" "$LIMIT"; touch -t 202001010000 "$P/old.jsonl"
ok "transcripts outside the window are skipped" '[ "$(python3 -I "$ROOT/bin/tab-rescue" --json)" = "[]" ]'

# The hook: stamped, silent when nothing died.
H="$ROOT/.claude/hooks/tab-rescue.sh"
session dead2 claude-vscode /Users/x/code/b "Build the dashboard" "$LIMIT"
out=$(echo '{}' | TAB_RESCUE_BIN="$ROOT/bin/tab-rescue" SIM_REAP_BIN=/nonexistent AGENT_NICE_BIN=/nonexistent bash "$H")
ok "hook speaks about a new death" 'printf %s "$out" | grep -q "Build the dashboard"'
session dead3 claude-vscode /Users/x/code/c "Another one" "$LIMIT"
out=$(echo '{}' | TAB_RESCUE_BIN="$ROOT/bin/tab-rescue" SIM_REAP_BIN=/nonexistent AGENT_NICE_BIN=/nonexistent bash "$H")
ok "hook scans at most once a minute" '[ -z "$out" ]'

# sim-reap with fake simctl and ps.
BOOTED='{"devices":{"ios":[{"name":"iPhone 17 Pro","state":"Booted"}]}}'
export SIM_REAP_LIST_CMD="echo $(printf %q "$BOOTED")" SIM_REAP_SHUTDOWN_CMD="touch $T/shutdown"
out=$(SIM_REAP_PS_CMD="echo /usr/bin/zsh" python3 -I "$ROOT/bin/sim-reap")
ok "orphaned simulator is shut down" '[ -e "$T/shutdown" ] && printf %s "$out" | grep -q "iPhone 17 Pro"'
rm -f "$T/shutdown"
SIM_REAP_PS_CMD="echo /Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild test" python3 -I "$ROOT/bin/sim-reap" >/dev/null
ok "a simulator driven by xcodebuild is left alone" '[ ! -e "$T/shutdown" ]'
SIM_REAP_PS_CMD="echo /Applications/Xcode.app/Contents/Developer/Applications/Simulator.app/Contents/MacOS/Simulator" python3 -I "$ROOT/bin/sim-reap" >/dev/null
ok "an open Simulator.app is left alone" '[ ! -e "$T/shutdown" ]'
SIM_REAP_PS_CMD="echo /usr/bin/zsh" python3 -I "$ROOT/bin/sim-reap" --dry-run >/dev/null
ok "dry run shuts nothing down" '[ ! -e "$T/shutdown" ]'

[ "$fail" -eq 0 ] && echo "tab-rescue ok" || { echo "tab-rescue: $fail failed"; exit 1; }
