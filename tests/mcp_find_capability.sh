#!/usr/bin/env bash
# find_capability is the only door a browser agent has into the kit's reads:
# if "am I recording" ranks screen time first, the agent answers the wrong
# question with full confidence. These are the questions Caleb actually asks
# (from the 2026-10-11 brief), each with the one id that must come back first.
# The registry grew from 16 entries to 88 that night, and plain word overlap
# had every "people" question tie on the word "people".
set -uo pipefail
ROOT="${1:?repo root}"
MCP="$ROOT/bin/chewbacca-mcp"

python3 - "$MCP" <<'PY'
import json, subprocess, sys

CASES = [
    ("what's due this week", "coursework.due"),
    ("which agents need me", "agents.needs"),
    ("who do I know at Stripe", "people.search"),
    ("am I recording", "meetings.recorder"),
    ("what did we decide in my last call", "meetings.recent"),
    ("how much time on my Mac", "screen_time"),
    ("which tabs died", "dead_tabs"),
    ("what's on my calendar today", "calendar.today"),
    ("what do I owe people", "people.owed"),
    ("who haven't I talked to in a while", "people.reconnect"),
    ("what's the late policy for WRIT 150", "coursework.policy"),
    ("where does my grade stand in BISC 101", "coursework.grade"),
    ("what's on the team board", "team.board"),
    ("whose birthday is coming up", "people.birthdays"),
    ("what jobs are running on my Mac", "jobs.list"),
    ("can I miss class Wednesday", "coursework.attendance"),
    ("what did I ask the voice assistant", "voice.recent"),
]

# SEALED. Written after CASES were tuned to pass, and never tuned against:
# the honest number for a question nobody wrote an `asks` line for. First run
# 2026-10-11: 6 of 10 first, 7 of 10 in the top three. The floor is that
# first run, so it catches a regression and does not pretend to be a target.
# Never edit an entry's `asks` to fix one of these; add a new sealed set.
SEALED = [
    ("any homework coming up", "coursework.due"),
    ("is anyone waiting on a text from me", "people.owed"),
    ("whats my schedule tomorrow", "calendar.today"),
    ("did any claude sessions crash", "dead_tabs"),
    ("who works at Google that I know", "people.search"),
    ("what was decided in the meeting with Sagar", "meetings.recent"),
    ("what is Gavin working on", "team.board"),
    ("how many absences do I have left", "coursework.attendance"),
    ("is the mic on", "meetings.recorder"),
]
# 4afcaa75 (10/11) deleted the sealed "can I use AI on the WRIT essay" with the
# AI-policy read it pointed at, and that question ranked first: the same code
# went from 6 of 10 to 5 of 9 (both runs on 10/13), so the floor follows the set.
SEALED_FLOOR = 5

def ranked(cases):
    lines = [json.dumps({"jsonrpc": "2.0", "id": i, "method": "tools/call",
                         "params": {"name": "find_capability", "arguments": {"query": q}}})
             for i, (q, _) in enumerate(cases)]
    out = subprocess.run([sys.argv[1]], input="\n".join(lines) + "\n", capture_output=True, text=True, timeout=60).stdout
    replies = {r["id"]: r for r in map(json.loads, filter(None, out.split("\n")))}
    for i, (q, want) in enumerate(cases):
        text = replies.get(i, {}).get("result", {}).get("content", [{}])[0].get("text", "")
        yield q, want, [l.split(":")[0] for l in text.split("\n") if l]

bad = [f"  {q!r}: wanted {want}, got {ids[0] if ids else '(nothing)'}"
       for q, want, ids in ranked(CASES) if not ids or ids[0] != want]
if bad:
    sys.exit(f"find_capability ranked {len(bad)} of {len(CASES)} wrong:\n" + "\n".join(bad))
first = sum(1 for _, want, ids in ranked(SEALED) if ids and ids[0] == want)
print(f"find_capability: {len(CASES)}/{len(CASES)} brief questions first, sealed {first}/{len(SEALED)} first")
if first < SEALED_FLOOR:
    sys.exit(f"sealed questions fell to {first}/{len(SEALED)} first (floor {SEALED_FLOOR})")
PY
