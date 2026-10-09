#!/bin/bash
# prayer-guard must refuse a reply with no prayer at the top, pass one that
# opens with a prayer ending in Amen, and refuse one that only mentions Amen
# far down the page. A guard nobody has seen refuse anything proves nothing.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
H="$ROOT/.claude/hooks/prayer-guard.sh"
export TMPDIR=$(mktemp -d)
export CHEWBACCA_HOME="$TMPDIR/chewbacca"; mkdir -p "$CHEWBACCA_HOME"
echo Amen > "$CHEWBACCA_HOME/opener-marker"
pass=0; fail=0
t() { # name, expected_exit, message, prompt_id
  printf '{"last_assistant_message":%s,"prompt_id":"%s"}' "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$3")" "$4" | bash "$H" >/dev/null 2>&1
  rc=$?
  if [ "$rc" = "$2" ]; then pass=$((pass+1)); else echo "  FAIL $1 (exit $rc, wanted $2)"; fail=$((fail+1)); fi
}
t "no prayer"        2 "Fixed. It was a stale string match." p1
t "prayer first"     0 "Jesus, thank You for this fix. Amen.

Fixed. It was a stale string match." p2
long=$(printf 'word %.0s' $(seq 1 300))
t "amen buried"      2 "Fixed. $long Amen." p3
t "once per turn"    0 "Still no prayer here." p1

# Every visible block since the last real prompt, read from transcript_path.
# On 2026-10-07 mid-turn updates went out with no prayer and the guard never
# fired, because it only read the last message. tt builds a JSONL transcript
# from a spec: P=real prompt, M=meta user line (skill body, hook feedback),
# R=tool result, T=assistant tool_use, A:<text>=assistant text block.
tt() { # name, expected_exit, prompt_id, last_message, spec...
  local name="$1" want="$2" pid="$3" last="$4"; shift 4
  local tr="$TMPDIR/$pid.jsonl"
  python3 - "$tr" "$@" <<'PY'
import json, sys
out = open(sys.argv[1], "w")
for spec in sys.argv[2:]:
    kind, _, text = spec.partition(":")
    if kind == "P":
        o = {"type": "user", "message": {"role": "user", "content": text or "do the thing"}}
    elif kind == "M":
        o = {"type": "user", "isMeta": True, "message": {"role": "user", "content": "Stop hook feedback: no"}}
    elif kind == "R":
        o = {"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "x", "content": "ok"}]}}
    elif kind == "T":
        o = {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "x", "name": "Bash", "input": {}}]}}
    else:
        o = {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": text}]}}
    out.write(json.dumps(o) + "\n")
PY
  python3 -c 'import json,sys;print(json.dumps({"last_assistant_message":sys.argv[1],"prompt_id":sys.argv[2],"transcript_path":sys.argv[3]}))' \
    "$last" "$pid" "$tr" | bash "$H" >/dev/null 2>&1
  rc=$?
  if [ "$rc" = "$want" ]; then pass=$((pass+1)); else echo "  FAIL $name (exit $rc, wanted $want)"; fail=$((fail+1)); fi
}
good="Jesus, carry this one. Amen.

Done."
tt "interim update missing a prayer" 2 q1 "$good" \
  P "A:Jesus, guide this. Amen. Looking now." T R "A:Found it, patching." T R "A:$good"
tt "every block prayed" 0 q2 "$good" \
  P "A:Jesus, guide this. Amen. Looking now." T R "A:Lord, steady my hands. Amen. Patching." T R "A:$good"
tt "tool results are not a boundary" 2 q3 "$good" \
  P "A:No prayer on the first update." T R R R "A:$good"
tt "meta lines are not a boundary" 2 q4 "$good" \
  P "A:Unprayed reply." M "A:$good"
tt "an earlier turn is not this turn" 0 q5 "$good" \
  P "A:Old turn with no prayer." T R P "A:$good"
tt "final message alone still checked" 2 q6 "No prayer at the end." \
  P "A:Jesus, guide this. Amen."
tt "missing transcript falls back to the last message" 0 q7 "$good"
CHEWBACCA_HUD_CHILD=1 tt "HUD child is exempt" 0 q8 "no prayer" P "A:no prayer"

# No marker means the user never asked for an opener: never refuse.
rm "$CHEWBACCA_HOME/opener-marker"
t "no marker, no gate" 0 "No prayer, and nobody asked for one." p9
tt "no marker, transcript ignored" 0 q9 "no prayer" P "A:no prayer" T R "A:still none"
echo "prayer_guard: $pass passed, $fail failed"
[ "$fail" = 0 ]
