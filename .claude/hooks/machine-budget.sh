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
# Thresholds, measured on this Mac (14 cores, 24 GB). Usable at load 14 to 17
# with 48% free while a dozen tabs idled (chewbacca-jobs' notes); "slow af" at
# 19 with 15% free; unusable at 80+ with 74 MB free. So warm starts at load =
# cores or under 20% free, hot at twice cores or under 10% free.
#
# ~/.chewbacca/load-authorized (touched in the last 10 minutes, the same file
# load-guard reads) lets a fan-out through when Caleb said it's worth it.

set -uo pipefail
type hook_unbuffer >/dev/null 2>&1 && hook_unbuffer  # stderr goes straight to the host from here on
exec /usr/bin/env python3 -I -c '
import json, os, re, subprocess, sys, time

try:
    payload = json.load(sys.stdin)
except ValueError:
    sys.exit(0)

def num(env, fallback):
    try:
        return float(os.environ[env])
    except (KeyError, ValueError):
        return fallback()

def mem_free():
    out = subprocess.run(["sysctl", "-n", "kern.memorystatus_level"],
                         capture_output=True, text=True, timeout=3).stdout.strip()
    return float(out) if out.isdigit() else 100.0

cores = num("MB_CORES", lambda: float(os.cpu_count() or 8))
load = num("MB_LOAD", lambda: os.getloadavg()[0])
free = num("MB_MEMFREE", mem_free)

# A file naming a level forces it, so a live session can prove the rewrite
# lands without waiting for the Mac to get busy.
try:
    forced = open(os.path.expanduser("~/.chewbacca/machine-budget-force")).read().strip()
except OSError:
    forced = ""
if forced in ("warm", "hot"):
    level = forced
elif load >= 2 * cores or free < 10:
    level = "hot"
elif load >= cores or free < 20:
    level = "warm"
else:
    sys.exit(0)

auth = os.path.expanduser("~/.chewbacca/load-authorized")
try:
    authorized = time.time() - os.stat(auth).st_mtime < 600
except OSError:
    authorized = False

state = "load %.0f on %d cores, %d%% memory free" % (load, cores, free)
event = payload.get("hook_event_name", "")
tool = payload.get("tool_name", "")

def emit(obj):
    print(json.dumps(obj))
    sys.exit(0)

def deny(reason):
    emit({"hookSpecificOutput": {"hookEventName": "PreToolUse",
          "permissionDecision": "deny", "permissionDecisionReason": reason}})

if event == "UserPromptSubmit":
    msg = ("The Mac is %s (%s). Caleb is using it. Do this turn in this context: "
           "no Workflow fan-outs%s, builds and test runs one at a time, and anything "
           "long goes through `chewbacca jobs submit`. If he says it is slow, say "
           "what is using it before digging." % (level.upper(), state,
           ", no subagents" if level == "hot" else ""))
    emit({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": msg}})

if event != "PreToolUse" or authorized:
    sys.exit(0)

if tool == "Workflow" or (tool in ("Agent", "Task") and level == "hot"):
    what = "a workflow fan-out" if tool == "Workflow" else "another subagent"
    deny("machine-budget: the Mac is %s (%s) and Caleb is using it, so %s would make it "
         "worse. Do the work in this context, or queue it with `chewbacca jobs submit`. "
         "If he says it is worth the machine: touch ~/.chewbacca/load-authorized "
         "(10 minutes)." % (level, state, what))

sys.exit(0)
'
