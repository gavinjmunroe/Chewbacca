#!/usr/bin/env bash
# Live: the skill router on held-out real prompts does not get worse.
#
# 2026-10-17, re-measured on 284 held-out prompts (126 random, 71 positives) after the
# meaning nudge went opt-in: precision 12.8% (5 of 39), recall 23.9%, typed no-skill 34.7%,
# machine traffic 0%. Today's floors are that run; the 10-16 history follows.
#
# 2026-10-16: backlog 3 said "implemented" while its acceptance (held-out
# precision, misses, latency) had never been measured. tools/skill_route_eval.py
# ran 238 hand-labeled prompts from the week's transcripts (Caleb's typed
# prompts, session briefs, harness and tool traffic), split train/held by a hash
# of the text, through the real hook. Held-out after machine traffic was
# silenced: precision 8.5% (4 of 47 shown), recall 21.1% (4 of 19), a skill
# shown on 38.6% of typed prompts that need none, machine traffic 5.7%, p95 283ms.
# These floors are that measurement, so a change that makes routing worse fails
# here. They are low on purpose: they record where the router is, and raising
# them is the job of whoever improves it, measured the same way.
#
# The labels hold Caleb's prompts, so they live in the private second brain
# (~/second-brain/systems/skill-route-eval.jsonl) and this check skips without them.
source "$(dirname "${BASH_SOURCE[0]}")/harness.sh"
need ollama "— run: chewbacca setup"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LABELS="${SKILL_ROUTE_LABELS:-$HOME/second-brain/systems/skill-route-eval.jsonl}"
if [ ! -s "$LABELS" ]; then
  unproven "no labeled prompts at $LABELS"
  finish
fi

python3 "$REPO/tools/skill_route_eval.py" run --labels "$LABELS" --split held --json >"$LIVE_SCRATCH/held.json" 2>"$LIVE_SCRATCH/held.err"
metric() { python3 -c "import json,sys; v=json.load(open(sys.argv[1]))[sys.argv[2]]; print(-1 if v is None else v)" "$LIVE_SCRATCH/held.json" "$1"; }
at_least() { python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) >= float(sys.argv[2]) else 1)" "$(metric "$1")" "$2"; }
at_most() { python3 -c "import sys; sys.exit(0 if 0 <= float(sys.argv[1]) <= float(sys.argv[2]) else 1)" "$(metric "$1")" "$2"; }

ok "held-out precision at least 12.8% (measured 2026-10-17)"         at_least precision 12.8
ok "held-out recall at least 23.9% (measured 2026-10-17)"            at_least recall 23.9
ok "typed no-skill prompts get a skill at most 34.7% of the time"     at_most false_fire_none_typed 34.7
ok "machine traffic never gets a nudge or gate"                       at_most false_fire_notification 0
ok "p95 hook time at most 2500ms (the Mac runs at load 30 to 100)"    at_most p95_ms 2500
# The floors can fail: a precision floor above 100% must die. Without this
# line the suite's "every live check has a mutant" stayed red (2026-10-19).
mutant "a precision floor of 101% is not met" at_least precision 101
cat "$LIVE_SCRATCH/held.json"
finish
