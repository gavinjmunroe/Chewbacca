#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init draft-source-guard.sh 10
# Stop hook: a draft Caleb will send names where each of its numbers came from.
#
# WHAT HAPPENED, 2026-10-16, 1:56 to 2:12pm, the Zeutara weekly text to Ryan
# and Jonah. Eleven replies carried blockquoted drafts with numbers and not one
# said where a number came from. Caleb had to ask: "Wait is 1% actually the bar
# where did u get that", "15 is pretty shit are u sure we can't count more of
# the 100", then "Good to send?". Only that last question made the agent read
# its own draft, and it found three lines that wouldn't hold, including "about
# 100 have replied personally" (an estimate; Clay counts 122 replies) and
# "median time to answer a reply is under five minutes" (3 replies; one waited
# almost 7 days). Zeutara's standing ruling: every number real.
#
# The break-it hook checks the done recap against what ran. This one covers the
# other place a made-up number does damage: text that goes out under his name.
#
# WHAT IT ENFORCES. When the reply holds a blockquoted draft (lines starting
# with ">") with digits in it, the reply also carries a line starting
# "Sources:" that names every one of those numbers and where it came from
# (a command, a table, a file, his own words, or "my estimate"). A number it
# can't source becomes [NEED: ...] in the draft. Dates (a month name before the
# number) and years are skipped. Refuses once per stop.
#
# WHAT IT DOESN'T DO. It can't tell a true source from a made-up one, and it
# doesn't read absolute words like "every send". It makes the provenance
# visible before he sends, which is where the 10/16 draft went wrong.

command -v jq >/dev/null 2>&1 || exit 0
INPUT=$(cat)
[ "$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0
MSG=$(printf '%s' "$INPUT" | jq -r '.last_assistant_message // empty')
printf '%s' "$MSG" | grep -qE '^[[:space:]]*>' || exit 0

VERDICT=$(DS_MSG="$MSG" python3 -I - <<'PY'
import os, re
msg = os.environ["DS_MSG"]
quote, rest = [], []
for line in msg.splitlines():
    (quote if line.lstrip().startswith(">") else rest).append(line)
draft = "\n".join(quote)
MONTH = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?"
# Drop dates ("October 22 or 23", "Oct 9 to 16") and years before reading numbers.
draft = re.sub(rf"\b{MONTH}\s+\d{{1,2}}(?:\s*(?:,|or|to|and|-)\s*\d{{1,2}})*\b", " ", draft, flags=re.I)
draft = re.sub(r"\b(?:19|20)\d\d\b", " ", draft)
nums = []
for n in re.findall(r"(?<![\w.$])\$?\d[\d,]*(?:\.\d+)?%?", draft):
    key = n.lstrip("$").replace(",", "").rstrip("%")
    if key not in nums:
        nums.append(key)
if not nums:
    print("ok"); raise SystemExit
sources = ""
# A Sources line may go on for a few lines as a list.
m = re.search(r"(?im)^\s*sources?\s*:.*(?:\n(?![ \t]*\n).*)*", "\n".join(rest))
if m:
    sources = m.group(0)
named = set(n.replace(",", "").rstrip("%") for n in re.findall(r"\d[\d,]*(?:\.\d+)?%?", sources))
missing = [n for n in nums if n not in named]
print("missing:" + ", ".join(missing[:8]) if missing else "ok")
PY
)

case "$VERDICT" in
  missing:*)
    {
      echo "draft-source-guard: refusing. This reply has a draft for Caleb to send, and these"
      echo "numbers in it have no source named: ${VERDICT#missing:}"
      echo
      echo "On 2026-10-16 the Zeutara update to Ryan and Jonah went through eleven drafts"
      echo "before \"Good to send?\" made the agent check them, and \"about 100 have replied"
      echo "personally\" turned out to be an estimate. Caleb had asked \"where did u get that\"."
      echo
      echo "Add a line starting \"Sources:\" that names each number and where it came from"
      echo "(the command or table you read, his own words, or \"my estimate\"). A number you"
      echo "can't source goes in the draft as [NEED: what's missing]."
    } >&2
    exit 2 ;;
esac
exit 0
