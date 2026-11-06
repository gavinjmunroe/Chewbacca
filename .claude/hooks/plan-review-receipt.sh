#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init plan-review-receipt.sh 10
# PostToolUse on Agent and Task: when a subagent that was handed a big plan comes back
# with findings, write what it said next to the plan. plan-check won't let a plan
# commit without this.
#
# 2026-11-05: an independent review of big-plan pointed out that a review log entry is
# only text, so an agent could write "reviewer found the Exit vague, tightened it" for
# a review it never got. Commit had a receipt and review didn't. This comes from the
# real tool call, so the findings are what really came back.
#
# It needs the plan's full path in the prompt, and a foreground agent: a background one
# returns only a launch notice here, which writes nothing. It can't tell whether the
# prompt leaked the author's reasoning, and a hand-written file would still fool it.
set -uo pipefail
PAYLOAD="$(cat)"
PAYLOAD="$PAYLOAD" HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)" python3 -I - <<'PY'
import json, os, re, sys, time

try:
    payload = json.loads(os.environ["PAYLOAD"])
except ValueError:
    sys.exit(0)
prompt = str((payload.get("tool_input") or {}).get("prompt") or "")
plans = [os.path.expanduser(p) for p in re.findall(r"(?:~|/)[^\s'\"`,)]*?\.md\b", prompt)]
plans = [p for p in plans if os.path.isfile(p)]
if not plans:
    sys.exit(0)
response = payload.get("tool_response")
if isinstance(response, dict):
    content = response.get("content", response)
    if isinstance(content, list):
        text = "\n".join(c.get("text", "") for c in content if isinstance(c, dict))
    else:
        text = str(content)
else:
    text = str(response or "")
# A launch notice or a one-liner isn't a review. Hall's breakers wrote thousands of
# characters. 300 is a guess, never measured.
if "Async agent launched" in text or len(text.strip()) < 300:
    sys.exit(0)
near = os.path.join(os.environ.get("HOOK_DIR", ""), "..", "..", "bin", "lib")
home = os.path.expanduser("~/.chewbacca/kit/current/bin/lib")
sys.path.insert(0, near if os.path.exists(os.path.join(near, "plan_core.py")) else home)
import plan_core

for plan in plans:
    try:
        body = open(plan, errors="replace").read()
    except OSError:
        continue
    if "## Riskiest assumptions" not in body:
        continue
    where = plan_core.review_path(plan)
    try:
        record = json.load(open(where))
    except (OSError, ValueError):
        record = {"reviews": []}
    record["reviews"].append({"core": plan_core.core_hash(body), "findings": text.strip()[:4000],
                              "agent": (payload.get("tool_input") or {}).get("description", ""), "at": time.time()})
    with open(where, "w") as out:
        json.dump(record, out, indent=1)
sys.exit(0)
PY
exit 0
