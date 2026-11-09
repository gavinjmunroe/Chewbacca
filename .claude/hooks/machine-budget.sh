#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init machine-budget.sh 5
# Keeps a dozen agent tabs from taking the Mac away from the person using it.
#
# load-guard refuses parallel local inference and transcode. That left builds,
# test suites and subagent spawns with no budget at all, and on 2026-10-10 Caleb
# said "My slow af rn" at load 19 to 37 on 14 cores with 15% memory free: nine
# tabs, their subagents and per-tab MCP servers, a forgotten simulator. Each
# tab's work was reasonable alone. Nobody was counting the machine.
#
# Three levels, read from the 1-minute load average and free memory:
#
#   calm   nothing happens.
#   warm   Workflow fan-outs are refused, and the next prompt is told the
#          machine is busy so it plans one thing at a time.
#   hot    subagent spawns are refused too: a subagent is a whole claude
#          process plus its own MCP servers.
#
# This is the load half of feedback_too_many_tabs_one_goal (2026-10-09: "Claude
# was tweaking bc there ws too much stuff on my cpu I think I had to stop all
# tabs"). The other half of that lesson, one owner per lane so tabs stop racing
# each other, is repo-overlap-guard.sh and `chewbacca land`, not this.
#
# Priority is handled by bin/agent-nice, run from tab-rescue.sh, which keeps every
# agent process and its children at nice 10 so Caleb's apps win the CPU.
#
# The limits are not here. bin/lib/machine_profile.py owns every load and
# memory limit in the kit, as a share of the Mac it runs on: weighted cores,
# percent of RAM free, cut on battery, raised once nobody has touched the Mac
# for 10 minutes. On this hook's own reference Mac (10P + 4E, 24 GB), present
# and on power, it still gives warm at load 14 and hot at 28. Before 10/13 the
# hook told an idle Mac at 2 a.m. "Caleb is using it" at load 28.
#
# ~/.chewbacca/load-authorized (touched in the last 10 minutes, the same file
# load-guard reads) lets a fan-out through when the person said it's worth it.

set -uo pipefail
type hook_unbuffer >/dev/null 2>&1 && hook_unbuffer  # stderr goes straight to the host from here on
HERE="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" && pwd)"
MB_LIB=""
for cand in "$HERE/../../bin/lib" "$HOME/.chewbacca/kit/current/bin/lib"; do
  [ -f "$cand/machine_profile.py" ] && { MB_LIB="$cand"; break; }
done
[ -n "$MB_LIB" ] || exit 0
export MB_LIB
exec /usr/bin/env python3 -I -c '
import json, os, sys, time
sys.path.insert(0, os.environ["MB_LIB"])
import machine_profile

try:
    payload = json.load(sys.stdin)
except ValueError:
    sys.exit(0)

def env(name):
    try:
        return float(os.environ[name])
    except (KeyError, ValueError):
        return None

prof = machine_profile.read(load=env("MB_LOAD"), mem_free=env("MB_MEMFREE"))
budget = machine_profile.budget(prof)

# A file naming a level forces it, so a live session can prove the rewrite
# lands without waiting for the Mac to get busy.
try:
    forced = open(os.path.expanduser("~/.chewbacca/machine-budget-force")).read().strip()
except OSError:
    forced = ""
level = forced if forced in ("warm", "hot") else budget["level"]
if level == "calm":
    sys.exit(0)

auth = os.path.expanduser("~/.chewbacca/load-authorized")
try:
    authorized = time.time() - os.stat(auth).st_mtime < 600
except OSError:
    authorized = False

state = "load %.0f on %d+%d cores, %d%% memory free" % (prof["load"], prof["p_cores"], prof["e_cores"], prof["mem_free"])
away = budget["mode"] == "away"
who = ("nobody has touched it for %d min" % (prof["idle_s"] // 60)) if away else "someone is using it"
event = payload.get("hook_event_name", "")
tool = payload.get("tool_name", "")

def emit(obj):
    print(json.dumps(obj))
    sys.exit(0)

def deny(reason):
    emit({"hookSpecificOutput": {"hookEventName": "PreToolUse",
          "permissionDecision": "deny", "permissionDecisionReason": reason}})

if event == "UserPromptSubmit":
    msg = ("The Mac is %s (%s; %s). Do this turn in this context: "
           "no Workflow fan-outs%s, builds and test runs one at a time, and anything "
           "long goes through `chewbacca jobs submit`. If they say it is slow, say "
           "what is using it before digging." % (level.upper(), state, who,
           ", no subagents" if level == "hot" else ""))
    emit({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": msg}})

if event != "PreToolUse" or authorized:
    sys.exit(0)

if tool == "Workflow" or (tool in ("Agent", "Task") and level == "hot"):
    what = "a workflow fan-out" if tool == "Workflow" else "another subagent"
    deny("machine-budget: the Mac is %s (%s; %s), so %s would make it "
         "worse. Do the work in this context, or queue it with `chewbacca jobs submit`. "
         "If they say it is worth the machine: touch ~/.chewbacca/load-authorized "
         "(10 minutes)." % (level, state, who, what))

sys.exit(0)
'
