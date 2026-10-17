#!/usr/bin/env bash
# Live: the skill router on held-out real prompts does not get worse.
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

ok "held-out precision at least 8.5% (measured 2026-10-16)"          at_least precision 8.5
ok "held-out recall at least 21.1% (measured 2026-10-16)"            at_least recall 21.1
ok "typed no-skill prompts get a skill at most 38.6% of the time"     at_most false_fire_none_typed 38.6
ok "machine traffic gets a nudge or gate at most 5.7% of the time"    at_most false_fire_notification 5.7
ok "p95 hook time at most 1500ms"                                     at_most p95_ms 1500
cat "$LIVE_SCRATCH/held.json"
finish
