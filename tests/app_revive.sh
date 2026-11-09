#!/usr/bin/env bash
# app-revive restarts only a windowed app with no renderer left, and only on
# the second run in a row. Rows copy the 2026-10-26 Granola and Slack crashes.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
cat > "$T/ps.txt" <<'PS'
    1     0 06-20:01:00 /sbin/launchd
91021     1 02-21:57:01 /Applications/Granola.app/Contents/MacOS/Granola
91042 91021 02-21:57:00 /Applications/Granola.app/Contents/Frameworks/Granola Helper.app/Contents/MacOS/Granola Helper --type=gpu-process
46239 91021    01:21:43 /Applications/Granola.app/Contents/Frameworks/Granola Helper.app/Contents/MacOS/Granola Helper --type=utility --utility-sub-type=network.mojom.NetworkService
 2389     1 03-01:00:00 /Applications/Claude.app/Contents/MacOS/Claude
 2400  2389 03-01:00:00 /Applications/Claude.app/Contents/Frameworks/Claude Helper (Renderer).app/Contents/MacOS/Claude Helper (Renderer) --type=renderer
 3000     1 01-00:00:00 /Applications/Clawd on Desk.app/Contents/MacOS/Clawd on Desk
 4000     1 01-00:00:00 /Applications/Todoist.app/Contents/MacOS/Todoist
 5000     1       00:30 /Applications/Linear.app/Contents/MacOS/Linear
 6000     1 01-00:00:00 /Applications/Claude.app/Contents/Helpers/disclaimer -- /usr/bin/sandbox-exec -D HELPER_BUNDLE=/Applications/Claude.app/Contents/Helpers/Claude iOS Sim.app /Applications/Claude.app/Contents/Helpers/Claude iOS Sim.app/Contents/MacOS/Claude iOS Sim
PS
# Windows: Granola (blank), Claude (healthy), Clawd on Desk (blank, name has
# spaces), Linear (just launched). Todoist has no window: closed to the menu bar.
echo '[91021, 2389, 3000, 5000, 6000]' > "$T/win.json"
export APP_REVIVE_PS="$T/ps.txt" APP_REVIVE_WINDOWS="$T/win.json" APP_REVIVE_STATE="$T/state.json"
fail=0
out="$(/usr/bin/python3 "$ROOT/bin/app-revive" --json)"
has() { printf '%s' "$out" | python3 -c "import json,sys; sys.exit(0 if $1 in [r['pid'] for r in json.load(sys.stdin)] else 1)"; }
for pid in 91021 3000; do
  has "$pid" && echo "  ok    finds blank $pid" || { echo "  FAIL  missed $pid"; fail=$((fail+1)); }
done
for pid in 2389 2400 4000 5000 6000 91042 46239; do
  has "$pid" && { echo "  FAIL  would restart $pid"; fail=$((fail+1)); } || echo "  ok    spares $pid"
done
first="$(/usr/bin/python3 "$ROOT/bin/app-revive" --fix --dry-run)"
[ -z "$first" ] && echo "  ok    first sighting restarts nothing" || { echo "  FAIL  restarted on first sighting: $first"; fail=$((fail+1)); }
second="$(/usr/bin/python3 "$ROOT/bin/app-revive" --fix --dry-run)"
case "$second" in *"would restart Granola (pid 91021)"*) echo "  ok    second sighting restarts Granola";; *) echo "  FAIL  second run: $second"; fail=$((fail+1));; esac
# A busy audio helper means a meeting is recording: leave the app alone.
printf '35.0 /Applications/Granola.app/Contents/Frameworks/Granola Helper.app/Contents/MacOS/Granola Helper --type=utility --utility-sub-type=audio.mojom.AudioService\n' > "$T/cpu.txt"
rec="$(APP_REVIVE_PS_CPU="$T/cpu.txt" /usr/bin/python3 "$ROOT/bin/app-revive" --fix --dry-run)"
case "$rec" in *"left Granola alone: recording"*) echo "  ok    a recording Granola is left alone";; *) echo "  FAIL  recording run: $rec"; fail=$((fail+1));; esac
printf '0.0 /Applications/Granola.app/Contents/Frameworks/Granola Helper.app/Contents/MacOS/Granola Helper --type=utility --utility-sub-type=audio.mojom.AudioService\n' > "$T/cpu.txt"
idle="$(APP_REVIVE_PS_CPU="$T/cpu.txt" /usr/bin/python3 "$ROOT/bin/app-revive" --fix --dry-run)"
case "$idle" in *"would restart Granola"*) echo "  ok    an idle Granola still restarts";; *) echo "  FAIL  idle run: $idle"; fail=$((fail+1));; esac
# A renderer coming back between runs clears it.
echo '[2389]' > "$T/win.json"
/usr/bin/python3 "$ROOT/bin/app-revive" --fix --dry-run >/dev/null
echo '[91021, 2389, 3000, 5000]' > "$T/win.json"
again="$(/usr/bin/python3 "$ROOT/bin/app-revive" --fix --dry-run)"
[ -z "$again" ] && echo "  ok    a gap resets the count" || { echo "  FAIL  restarted after a gap: $again"; fail=$((fail+1)); }
exit $fail
