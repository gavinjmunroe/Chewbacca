#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init thinking-dash-guard.sh 5
# Stop: catch em dashes in the THINKING, which Caleb reads in the editor.
#
# slop-guard reads last_assistant_message, the reply only. On 2026-10-10 he
# wrote "IT KEEPS FORGETTING AND DOING EM DASHES". Over the previous 24 hours
# replies carried none, and 80 thinking blocks did (51 Desktop, 25 SDK, 4
# VS Code). A memory note from 10/7 already said no em dashes in thinking
# either, and said the hook only checked replies. Nothing ever read thinking.
#
# Thinking can't be rewritten once it's on screen, and a refusal only adds a
# duplicate reply, so this never refuses. It counts the dashes in this turn's
# thinking and queues them in voice-flags.pending, which voice-remind.sh puts
# in front of the next turn before anything is written.
set -uo pipefail
INPUT="$(cat)"
STATE="${CHEWBACCA_HOME:-$HOME/.chewbacca}"
TP="$(printf '%s' "$INPUT" | python3 -I -c 'import json,sys
try: print(json.load(sys.stdin).get("transcript_path") or "")
except ValueError: pass' 2>/dev/null)"
[ -n "$TP" ] && [ -f "$TP" ] || exit 0

REPORT="$(python3 -I - "$TP" <<'PY'
import json, sys
path = sys.argv[1]
with open(path, "rb") as fh:
    fh.seek(0, 2)
    size = fh.tell()
    fh.seek(max(0, size - 2_000_000))
    lines = fh.read().splitlines()
turn = []
for raw in lines:
    try:
        rec = json.loads(raw)
    except ValueError:
        continue
    content = (rec.get("message") or {}).get("content")
    if rec.get("type") == "user" and isinstance(content, str) and not content.startswith("<"):
        turn = []
    elif rec.get("type") == "assistant":
        for part in content or []:
            if isinstance(part, dict) and part.get("type") == "thinking":
                turn.append(part.get("thinking") or "")
hits = [t for t in turn if "—" in t or "–" in t]
if hits:
    n = sum(t.count("—") + t.count("–") for t in hits)
    t = hits[-1]
    i = max(t.find("—"), t.find("–"))
    print("%d\t%s" % (n, " ".join(t[max(0, i - 60):i + 40].split())))
PY
)"
[ -n "$REPORT" ] || exit 0
N="${REPORT%%	*}"
EX="${REPORT#*	}"
mkdir -p "$STATE" 2>/dev/null
printf '%s\n' "em-dash in your THINKING last turn ($N), and Caleb reads thinking: write it with commas and periods like the reply. e.g. > $EX" >> "$STATE/voice-flags.pending"
printf '%s\t%s\n' "$(date '+%Y-%m-%d %H:%M')" "thinking-em-dash $N" >> "$STATE/voice-flags.log"
exit 0
