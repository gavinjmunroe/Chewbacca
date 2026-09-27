#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init plan-guard.sh 10
# PreToolUse: refuse an edit that skips the phase the repo's own plan is on.
#
# Caleb, 2026-09-27: "Fix chewbacca so you actually go through with the plans
# you say you're going to."
#
# THE FAILURE. A PLAN.md was written whose first phase was a measurement pass,
# titled "Stop flying blind". It was never run. Seven sections got built from
# impressions overnight instead, and the whole of the next day went on
# measuring them one at a time and finding every one wrong. Then a SECOND plan
# was written, with the same measure-first phase, for the same reason.
#
# Writing the plan was never the problem. Two good plans exist. Neither was
# followed, and nothing in the session could tell that it was not being
# followed, because a plan is prose and prose does not fail.
#
# `feedback_enforce_dont_document`: a mistake made repeatedly needs something
# that refuses it. So the plan now carries a machine readable PLAN-GATES block
# and this hook reads it:
#
#   - walk the phases in order
#   - the first phase whose `requires` files do not all exist is ACTIVE
#   - a write outside that phase's `allows` prefixes is refused
#
# The effect is that you cannot start building until the measurement phase has
# produced its artifacts, which is exactly the step that got skipped twice.
#
# WHAT IT DELIBERATELY DOES NOT DO. It does not check that the artifacts are
# any GOOD, only that they exist. A hook cannot read a delta ledger and know
# whether it is honest. It closes the "never started" hole, which is the one
# that actually happened, and leaves the "started badly" hole to review.
set -uo pipefail

INPUT=$(cat)
command -v jq >/dev/null 2>&1 || exit 0

FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')
[ -n "$FILE" ] || exit 0

# Walk up from the edited file for a PLAN.md carrying a gate block. No plan,
# or a plan without the block, means this hook has nothing to say.
DIR=$(dirname "$FILE"); ROOT=""
for _ in 1 2 3 4 5 6 7 8; do
  if [ -f "$DIR/PLAN.md" ] && grep -q '^<!-- PLAN-GATES' "$DIR/PLAN.md" 2>/dev/null; then
    ROOT="$DIR"; break
  fi
  [ "$DIR" = "/" ] && break
  DIR=$(dirname "$DIR")
done
[ -n "$ROOT" ] || exit 0

# The path as the plan writes it, relative to the repo root.
REL="${FILE#"$ROOT"/}"

ACTIVE=$(ROOT="$ROOT" REL="$REL" python3 - <<'PY'
import os, re, sys, pathlib

root = pathlib.Path(os.environ["ROOT"])
rel  = os.environ["REL"]
text = (root / "PLAN.md").read_text()

m = re.search(r"^<!-- PLAN-GATES(.*?)^-->", text, re.S | re.M)
if not m:
    sys.exit(0)

phases, cur = [], None
for line in m.group(1).splitlines():
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    if line.startswith("phase "):
        parts = line.split(None, 2)
        cur = {"n": parts[1], "name": parts[2] if len(parts) > 2 else "",
               "requires": [], "allows": []}
        phases.append(cur)
    elif cur is not None and line.startswith("requires "):
        cur["requires"] = line.split()[1:]
    elif cur is not None and line.startswith("allows "):
        cur["allows"] = line.split()[1:]

for ph in phases:
    missing = [r for r in ph["requires"] if not (root / r).exists()]
    if not missing:
        continue                      # phase satisfied, move on
    # This is the active phase. Is the target inside it?
    if any(rel == a or rel.startswith(a) for a in ph["allows"]):
        sys.exit(0)
    print(f'{ph["n"]}\t{ph["name"]}\t{" ".join(missing)}\t{" ".join(ph["allows"])}')
    sys.exit(0)
PY
) || exit 0

[ -n "$ACTIVE" ] || exit 0

IFS=$'\t' read -r PN PNAME PMISSING PALLOWS <<< "$ACTIVE"

cat >&2 <<EOF
plan-guard: $ROOT/PLAN.md is still on phase $PN, "$PNAME", and this write is
outside it.

  writing    $REL
  missing    $PMISSING
  writable   $PALLOWS

Phase $PN has not produced its artifacts, so nothing downstream of it is
measured yet. This is the gate for the thing that has now happened twice on
this repo: a plan opens with a measurement phase, the measurement is skipped,
the building starts, and the next day goes on discovering that everything
built was wrong.

Produce the missing file, or edit the plan if the phase itself is wrong. Do
not route around it by writing somewhere else.
EOF
exit 2
