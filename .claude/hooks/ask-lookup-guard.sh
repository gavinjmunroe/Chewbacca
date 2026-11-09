#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init ask-lookup-guard.sh 5
# PreToolUse on the next-step box (mcp__ccd_turn__wrap_up) and AskUserQuestion:
# a question to Caleb about a fact a lookup finds (a meeting's time or day, an
# address, an email, a phone number) is refused until this turn ran a lookup.
#
# 2026-10-28 4:04pm: the box asked "What time Friday?" about the OPTRA call,
# which sat on his USC calendar the whole time. He wrote "Why would you ask me
# something you can find the answer yourself". reply-lessons.sh already had
# this rule, but it reads the reply text, and the question was in the box,
# which nothing read. Refusing here, before the box draws, costs nothing on
# his screen.
#
# A lookup is any tool call this turn that reads the calendar, contacts, the
# people store, mail or `chewbacca resolve`. Override: put LOOKED_UP: <where>
# in the ask's recap when the sources really came back empty.

set -uo pipefail
command -v python3 >/dev/null 2>&1 || exit 0
INPUT="$(cat)" python3 -I - <<'PY'
import json, os, re, sys

try:
    data = json.loads(os.environ["INPUT"])
except (KeyError, ValueError):
    sys.exit(0)
ti = data.get("tool_input") or {}
asks = [str(ti.get("ask") or "")]
for q in ti.get("questions") or []:
    if isinstance(q, dict):
        asks.append(str(q.get("question") or ""))
ask = " ".join(a for a in asks if a).strip()
if not ask or "LOOKED_UP:" in str(ti.get("recap") or ""):
    sys.exit(0)

FACT = re.compile(
    r"\b(what|which)\s+(time|day|date)\b|"
    r"\bwhen(?:'s|\s+is|\s+are|\s+was)\b[^?]{0,40}\b(call|meeting|class|interview|appointment|event|it)\b|"
    r"\b(what'?s|what\s+is|need|send\s+me)\b[^?]{0,30}\b(address|email|phone|number|zip|website|link)\b",
    re.I)
if not FACT.search(ask):
    sys.exit(0)

LOOKUP = re.compile(
    r"(list_events|search_events|get_event|calendar|gog\b|\bpeople\s+(brief|find|texts)|"
    r"chewbacca\s+resolve|\bmac\s+(contacts|calendar)|contacts|search_threads|get_thread|"
    r"person_brief|who_do_i_know)", re.I)

def turn_tools(path):
    """Tool calls since the last thing Caleb typed."""
    try:
        lines = open(path, encoding="utf-8", errors="replace").read().splitlines()
    except OSError:
        return None
    rows = []
    for line in lines:
        try:
            rows.append(json.loads(line))
        except ValueError:
            continue
    calls = []
    for row in rows:
        msg = row.get("message") or {}
        content = msg.get("content")
        if row.get("type") == "user":
            typed = isinstance(content, str) or any(
                isinstance(c, dict) and c.get("type") == "text" for c in (content or []))
            if typed:
                calls = []
            continue
        if row.get("type") == "assistant" and isinstance(content, list):
            for c in content:
                if isinstance(c, dict) and c.get("type") == "tool_use":
                    calls.append(c.get("name", "") + " " + json.dumps(c.get("input", {})))
    return calls

calls = turn_tools(data.get("transcript_path") or "")
if calls is None:
    sys.exit(0)
if any(LOOKUP.search(c) for c in calls):
    sys.exit(0)
print("ask-lookup-guard: this asks Caleb a fact a lookup finds (" + ask[:80] + "). "
      "Check his calendar, contacts, the people store or `chewbacca resolve` first, then answer it yourself. "
      "Caleb, 2026-10-28: \"Why would you ask me something you can find the answer yourself\". "
      "If every source really came back empty, say where you looked with LOOKED_UP: <where> in the recap.",
      file=sys.stderr)
sys.exit(2)
PY
