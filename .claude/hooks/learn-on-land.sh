#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init learn-on-land.sh 10
# Stop hook: a turn that lands code saves its lessons in the same turn.
#
# WHAT HAPPENED, 2026-10-16. Caleb typed "Learn and remember everything you
# should" (or "Peace bro, learn and remember everything you should") 23 times
# across 19 tabs, nine of them between 16:06 and 16:10. Read against each
# transcript, 14 of those 23 came after the tab had landed code with edits
# made after its last lesson write: the work shipped, the lesson didn't, and
# he was the one who remembered to ask.
#
# WHAT IT ENFORCES. When this turn ran `chewbacca land` or `git push`, and the
# session edited code after its last write to a lesson store (team/memory,
# the second brain, a SKILL.md, .claude/rules, gtme-lessons), the turn may not
# end until it saves what it learned there, or says "No new lesson:" and why.
# Refuses once per stop (stop_hook_active lets the next one through).

command -v jq >/dev/null 2>&1 || exit 0
INPUT=$(cat)
[ "$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0
MSG=$(printf '%s' "$INPUT" | jq -r '.last_assistant_message // empty')
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty')
[ -f "$TRANSCRIPT" ] || exit 0
printf '%s' "$MSG" | grep -qi 'no new lesson' && exit 0

VERDICT=$(LL_TRANSCRIPT="$TRANSCRIPT" python3 -I - <<'PY'
import json, os, re

LESSON = re.compile(r"(team/memory/|second-brain/|/memory/[^/\s\"']+\.md|SKILL\.md|\.claude/rules/|gtme-lessons)")
LAND = re.compile(r"\bchewbacca land\b|\bgit push\b")
WRITE_SHELL = re.compile(r"(>|\btee\b|<<|\bmv\b|\bcp\b)")
events = []          # (kind, in_this_turn) with kind M lesson, C code, L land
turn_start = 0
with open(os.environ["LL_TRANSCRIPT"], encoding="utf-8", errors="replace") as fh:
    for line in fh:
        try:
            row = json.loads(line)
        except ValueError:
            continue
        content = (row.get("message") or {}).get("content")
        if row.get("type") == "user":
            words = content if isinstance(content, str) else " ".join(
                b.get("text", "") for b in content or []
                if isinstance(b, dict) and b.get("type") == "text")
            if words.strip() and not words.lstrip().startswith("<"):
                turn_start = len(events)
            continue
        if row.get("type") != "assistant" or not isinstance(content, list):
            continue
        for b in content:
            if not isinstance(b, dict) or b.get("type") != "tool_use":
                continue
            inp = b.get("input") or {}
            name = b.get("name", "")
            if name in ("Write", "Edit", "MultiEdit", "NotebookEdit"):
                events.append("M" if LESSON.search(str(inp.get("file_path", ""))) else "C")
            elif name == "Bash":
                cmd = str(inp.get("command", ""))
                if LAND.search(cmd):
                    events.append("L")
                elif LESSON.search(cmd) and WRITE_SHELL.search(cmd):
                    events.append("M")

landed_now = "L" in events[turn_start:]
last_lesson = max((i for i, e in enumerate(events) if e == "M"), default=-1)
code_after = events[last_lesson + 1:].count("C")
print("save" if landed_now and code_after else "ok")
PY
)

if [ "$VERDICT" = "save" ]; then
  {
    echo "learn-on-land: this turn landed code, and the session changed code after its"
    echo "last lesson write. Save what you learned before ending the turn."
    echo
    echo "On 2026-10-16 Caleb typed \"Learn and remember everything you should\" 23 times;"
    echo "14 came right after a land like this one."
    echo
    echo "Write the lesson where its owner reads it: team/memory (one fact per file plus"
    echo "its MEMORY.md line) for Amber, Chewbacca or Firm Foundation, the brain's memory/"
    echo "for him, the owning SKILL.md for a procedure, a test for a mechanical failure."
    echo "If there truly is nothing new, say \"No new lesson:\" and why, in the reply."
  } >&2
  exit 2
fi
exit 0
