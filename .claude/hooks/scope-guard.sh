#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init scope-guard.sh 10
# Stop hook: refuse a reply that shrinks scope Caleb set as "all".
#
# WHAT HAPPENED, 2026-10-09. Caleb: "Graph engineer finding a ton of creators
# like him across youtube, x, instagram, github and then scraping all their
# stuff too." The session found 238 creators, then decided on its own to
# ingest 36 of them, capped each channel at 10 videos and 90 days, and put X,
# Instagram and TikTok "on hold". Every cut was announced, so it read as
# transparency, but none was his. Next morning: "You didn't listen to me. Fix
# chewb so this never happens again."
#
# Announcing a cut doesn't make it agreed. A real limit (no access, a rate
# limit, a credential only he has) is a BLOCKED: line he can act on. Taste
# about what's "enough" is not a limit.
#
# WHAT IT ENFORCES. When one of his recent prompts uses a totality word (all,
# every, everything, entire, whole, a ton), a reply that carries scope-cut
# language (top N, N of M picked, capped, tier 1, on hold, skipped, set aside,
# not ingested) is refused unless it also has a BLOCKED: line naming the hard
# limit. So the agent either keeps going at full scope or names the real
# blocker.
#
# WHAT IT DOESN'T DO. It can't tell an honest blocker from an excuse dressed
# as one; review catches that. It closes the hole that actually happened: a
# self-chosen cut reported as a plan.

command -v jq >/dev/null 2>&1 || exit 0
INPUT=$(cat)
MSG=$(printf '%s' "$INPUT" | jq -r '.last_assistant_message // empty')
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty')
[ -n "$MSG" ] && [ -f "$TRANSCRIPT" ] || exit 0

VERDICT=$(SG_MSG="$MSG" SG_TRANSCRIPT="$TRANSCRIPT" python3 -I - <<'PY'
import json, os, re

msg = os.environ["SG_MSG"]
prompts = []
with open(os.environ["SG_TRANSCRIPT"], encoding="utf-8", errors="replace") as fh:
    for line in fh:
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if row.get("type") != "user":
            continue
        content = (row.get("message") or {}).get("content")
        if isinstance(content, str):
            text = content
        elif isinstance(content, list):
            text = " ".join(b.get("text", "") for b in content
                            if isinstance(b, dict) and b.get("type") == "text")
        else:
            continue
        # Hook and system injections ride in user rows too. His own words
        # don't start with a tag.
        if text.strip() and not text.lstrip().startswith("<"):
            prompts.append(text)

# Five prompts back: a scope he set stays set through "Continue" and "lock in".
recent = " ".join(prompts[-5:]).lower()
total = re.search(r"\b(all|every|everything|entire|whole)\b|\ba ton\b|\btons of\b", recent)
if not total:
    print("ok"); raise SystemExit

# "Top N" is also how ranking is described: a reranker re-sorting the top 30
# candidates for every question cuts nothing. On 2026-10-10 that sentence was
# refused twice. A top-N inside a sentence about ranking is a parameter.
RANKING = re.compile(r"\b(rerank\w*|re-sort\w*|candidates?|recall@\d+|retriev\w*|ranked|results? per)\b", re.I)


def ranking_param(m):
    start = max(msg.rfind(".", 0, m.start()), msg.rfind("\n", 0, m.start())) + 1
    ends = [i for i in (msg.find(".", m.end()), msg.find("\n", m.end())) if i != -1]
    return bool(RANKING.search(msg[start:min(ends) if ends else len(msg)]))


# 2026-10-28, one session, three refusals of replies that cut nothing: "Read the
# top 3" (rows of a 164 list to read aloud on a call, his own script), "only
# exist in the notes file for now" (where a file lives), and "only the 1 to 3
# questions" inside a prompt fenced for another tab. Quoted words and fenced
# blocks are someone else's text, and "top N" or "for now" is a cut only in a
# sentence that does the work on fewer things.
def blank(s):
    return " " * len(s.group(0))


# \x60 is a backtick: a literal one inside this $( heredoc ) breaks bash 3.2.
scan = re.sub(r"\x60{3}.*?\x60{3}", blank, msg, flags=re.S)
scan = re.sub(r"\x60[^\x60\n]*\x60|\"[^\"\n]*\"|“[^”\n]*”", blank, scan)
WORK = re.compile(r"\b(ingest\w*|scrap\w*|pull\w*|process\w*|enrich\w*|send\w*|sent|kept|keep\w*|"
                  r"build\w*|load\w*|queu\w*|focus\w*|skip\w*|hold|park\w*|drop\w*|leav\w* out|later)\b", re.I)


def sentence(m):
    start = max(scan.rfind(".", 0, m.start()), scan.rfind("\n", 0, m.start())) + 1
    ends = [i for i in (scan.find(".", m.end()), scan.find("\n", m.end())) if i != -1]
    return scan[start:min(ends) if ends else len(scan)]


cut = None
for m in re.finditer(
        r"\btop \d+\b|\b\d+ of (the )?\d+\b.*\b(picked|chosen|closest|fit)|\bcapped\b|\bcap(ped)? at\b"
        r"|\btier[- ]?1\b|\bon hold\b|\bset aside\b|\bnot ingested\b|\bskipped\b|\bfor now\b"
        r"|\bonly the \d+\b|\bnarrow(ed)? (it|the scope)\b",
        scan, re.I):
    word = m.group(0).lower()
    if word.startswith("top ") and ranking_param(m):
        continue
    if (word.startswith("top ") or word == "for now") and not WORK.search(sentence(m)):
        continue
    cut = m
    break
if cut and "BLOCKED:" not in msg:
    print("cut:" + cut.group(0))
else:
    print("ok")
PY
)

case "$VERDICT" in
  cut:*)
    {
      echo "scope-guard: refusing. Caleb asked for all of it (a recent prompt says all,"
      echo "every, entire or a ton), and this reply cuts scope: \"${VERDICT#cut:}\"."
      echo
      echo "On 2026-10-09 a creator ingest he asked for in full was cut to 36 of 238,"
      echo "10 videos each, with three platforms on hold, and he said \"You didn't"
      echo "listen to me.\""
      echo
      echo "Either keep going at the scope he set, or name each hard limit on its own"
      echo "line as BLOCKED: <what needs his hands or what refused>. Deciding what's"
      echo "enough is his call."
    } >&2
    exit 2 ;;
esac
exit 0
