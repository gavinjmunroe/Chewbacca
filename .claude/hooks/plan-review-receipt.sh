#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init plan-review-receipt.sh 10
# PostToolUse on Agent and Task, and UserPromptSubmit: when a subagent that was handed a big plan comes back
# with findings, write what it said next to the plan. plan-check won't let a plan
# commit without this.
#
# 2026-11-05: an independent review of big-plan pointed out that a review log entry is
# only text, so an agent could write "reviewer found the Exit vague, tightened it" for
# a review it never got. Commit had a receipt and review didn't. This comes from the
# real tool call, so the findings are what really came back.
#
# It needs the plan's full path in the prompt. Agents here run in the background, so a
# launch writes nothing but a note of which plans that agent was given, and the receipt
# comes when its <task-notification> arrives with the result. The first version treated
# the launch's own response as the review, and a live test on 2026-11-05 caught it
# writing a receipt full of launch metadata before the agent had read a word.
#
# It can't tell whether the prompt leaked the author's reasoning, and a hand-written
# file would still fool it.
set -uo pipefail
PAYLOAD="$(cat)"
PAYLOAD="$PAYLOAD" HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)" python3 -I - <<'PY'
import html, json, os, re, sys, time

try:
    payload = json.loads(os.environ["PAYLOAD"])
except ValueError:
    sys.exit(0)
near = os.path.join(os.environ.get("HOOK_DIR", ""), "..", "..", "bin", "lib")
home = os.path.expanduser("~/.chewbacca/kit/current/bin/lib")
sys.path.insert(0, near if os.path.exists(os.path.join(near, "plan_core.py")) else home)
import plan_core

STATE = os.environ.get("PLAN_REVIEW_STATE") or os.path.expanduser("~/.chewbacca/state/plan-review-pending")


def record(plans, text, label):
    # A one-liner isn't a review. Hall's breakers wrote thousands of characters, and a
    # 3-finding live test wrote 900. 300 is a guess, never measured.
    if len(text.strip()) < 300:
        return
    for plan in plans:
        try:
            body = open(plan, errors="replace").read()
        except OSError:
            continue
        if "## Riskiest assumptions" not in body:
            continue
        where = plan_core.review_path(plan)
        try:
            found = json.load(open(where))
        except (OSError, ValueError):
            found = {"reviews": []}
        found["reviews"].append({"core": plan_core.core_hash(body), "findings": text.strip()[:4000],
                                 "agent": label, "at": time.time()})
        with open(where, "w") as out:
            json.dump(found, out, indent=1)


def safe(agent):
    return re.sub(r"[^A-Za-z0-9_-]", "", str(agent))[:80]


prompt_field = payload.get("prompt")
if isinstance(prompt_field, str):
    # UserPromptSubmit: the harness delivers a finished background agent as a prompt.
    if "<task-notification>" not in prompt_field:
        sys.exit(0)
    task = re.search(r"<task-id>([^<]+)</task-id>", prompt_field)
    done = re.search(r"<status>completed</status>", prompt_field)
    result = re.search(r"<result>(.*?)</result>", prompt_field, re.S)
    if not (task and done and result):
        sys.exit(0)
    pending = os.path.join(STATE, safe(task.group(1)) + ".json")
    try:
        note = json.load(open(pending))
    except (OSError, ValueError):
        sys.exit(0)
    record(note.get("plans", []), html.unescape(result.group(1)), note.get("agent", ""))
    os.remove(pending)
    sys.exit(0)

tool = payload.get("tool_input") or {}
plans = [os.path.expanduser(p) for p in re.findall(r"(?:~|/)[^\s'\"`,)]*?\.md\b", str(tool.get("prompt") or ""))]
plans = [p for p in plans if os.path.isfile(p)]
if not plans:
    sys.exit(0)
response = payload.get("tool_response")
if isinstance(response, dict) and (response.get("isAsync") or response.get("status") == "async_launched"):
    agent = safe(response.get("agentId") or "")
    if agent:
        os.makedirs(STATE, exist_ok=True)
        with open(os.path.join(STATE, agent + ".json"), "w") as out:
            json.dump({"plans": plans, "agent": tool.get("description", "")}, out)
    sys.exit(0)
if isinstance(response, dict):
    content = response.get("content")
    text = "\n".join(c.get("text", "") for c in content if isinstance(c, dict)) if isinstance(content, list) else ""
else:
    text = str(response or "")
if "Async agent launched" in text:
    sys.exit(0)
record(plans, text, tool.get("description", ""))
sys.exit(0)
PY
exit 0
