#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init open-work-guard.sh 10
# Stop hook: refuse ending a turn that names its own unfinished work.
#
# WHAT HAPPENED, 2026-10-16. Fourteen of Caleb's messages that day were pushes
# to keep going: "Are you done with your work? There's noting more you could
# do?" (three tabs, 14:47 to 14:49), "There's still way too much work to do",
# "Lock in bruv", "LOCK TF IN". The turns he answered had stopped while their
# own closing words listed work left in their lane:
#
#   "The view-filter and view-columns writes are gated and haven't been sent
#    live."                                          (f7901545, 14:47)
#   "The Friday numbers to Maggie haven't gone out." plus the ask "Want the
#    Friday numbers text for Maggie to paste before u log off?"
#                                                    (2bb3894f, 14:49, 15:12)
#   "They also list what's still open."              (faf1c561, 14:49)
#   "The other 6 ranked changes aren't built." plus "Build ... next?"
#                                                    (2bb3894f, 14:16)
#
# Each time he had to read the recap, notice the leftover, and type the push.
#
# WHAT IT ENFORCES. The closing text (the last reply plus this turn's wrap_up
# recap and ask) may not name its own unfinished work, or offer to do work as
# a "Want me to / Want the ... ?" question, unless it also carries a BLOCKED:
# line saying what needs his hands. So the agent does the leftover, or names
# the real blocker. It refuses once per stop: when Claude Code reports
# stop_hook_active the turn may end, so this never loops.
#
# WHAT IT DOESN'T DO. It can't tell whose lane a leftover is in. Work another
# tab owns can be named as "waiting on <tab or person>", which it lets through.

command -v jq >/dev/null 2>&1 || exit 0
INPUT=$(cat)
[ "$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0
MSG=$(printf '%s' "$INPUT" | jq -r '.last_assistant_message // empty')
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty')

VERDICT=$(OW_MSG="$MSG" OW_TRANSCRIPT="$TRANSCRIPT" python3 -I - <<'PY'
import json, os, re

text = os.environ.get("OW_MSG", "")
path = os.environ.get("OW_TRANSCRIPT", "")
# This turn's wrap_up recap and ask: the desktop app shows those as the
# closing words, and on 10/16 they were where the leftovers were named.
if path and os.path.isfile(path):
    turn = []
    with open(path, encoding="utf-8", errors="replace") as fh:
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
                    turn = []          # a prompt he typed starts a new turn
                continue
            if row.get("type") == "assistant" and isinstance(content, list):
                for b in content:
                    if isinstance(b, dict) and b.get("type") == "tool_use" \
                            and str(b.get("name", "")).endswith("wrap_up"):
                        inp = b.get("input") or {}
                        turn.append(str(inp.get("recap", "")))
                        turn.append(str(inp.get("ask", "")))
    text = text + "\n" + "\n".join(turn)

if "BLOCKED:" in text:
    print("ok"); raise SystemExit

LEFT = re.compile(
    r"\b(?:haven't|hasn't|have not|has not) (?:gone out|been (?:sent|built|run|landed|wired|pushed|merged|verified|done|checked)"
    r"|(?:sent|built|run|landed|wired|pushed|merged|verified|finished|started)\b)"
    r"|\b(?:aren't|isn't|are not|is not) (?:built|wired|done|landed|sent|finished)\b"
    r"|\bstill open\b|\bleft to do\b|\bstill to do\b|\bnot (?:yet )?(?:built|wired|landed)\b"
    r"|\bremaining (?:work|items|steps)\b",
    re.I)
OFFER = re.compile(r"(?:^|\n|[.!?] )\s*(?:Want (?:me to|the|a|it)\b|Should I\b|Shall I\b|Do you want me to\b)[^?\n]*\?", re.I)
WAITING = re.compile(r"\bwaiting on\b|\b(?:another|the other|that) (?:tab|session)\b|\bits own (?:tab|session)\b", re.I)

for pat in (LEFT, OFFER):
    for m in pat.finditer(text):
        start = max(text.rfind(".", 0, m.start()), text.rfind("\n", 0, m.start())) + 1
        ends = [i for i in (text.find(".", m.end()), text.find("\n", m.end())) if i != -1]
        sentence = text[start:min(ends) if ends else len(text)]
        if WAITING.search(sentence):
            continue
        print("left:" + sentence.strip()[:160]); raise SystemExit
print("ok")
PY
)

case "$VERDICT" in
  left:*)
    {
      echo "open-work-guard: refusing to end the turn. The closing words name work that"
      echo "isn't done: \"${VERDICT#left:}\""
      echo
      echo "On 2026-10-16 Caleb typed \"Are you done with your work? There's noting more"
      echo "you could do?\" into three tabs whose recaps each named a leftover like this."
      echo
      echo "Do the leftover now. If it truly needs his hands (a credential, a physical"
      echo "step, a decision only he can make), put it on its own line as BLOCKED: <what>."
      echo "If another tab owns it, say \"waiting on <that tab>\". Don't offer it as a question."
    } >&2
    exit 2 ;;
esac
exit 0
