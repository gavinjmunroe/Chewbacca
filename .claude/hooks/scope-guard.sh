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
# every, everything, entire, whole, a ton), a reply Jev reads as doing part of it
# is refused unless it also has a BLOCKED: line naming the hard limit. His words
# stay on this Mac, so that gate is still a word list, listed in
# docs/reference/INTENT-INVENTORY.md. So the agent either keeps going at full scope or names the real
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

print("check" if "BLOCKED:" not in msg else "ok")
PY
)

[ "$VERDICT" = "check" ] || exit 0

# Whether a reply cuts scope is a judgment. A word list lost this one for a month:
# "Read the top 3" (rows of his own script), "only exist in the notes file for now"
# and a reranker's top 30 were all refused as cuts (2026-10-10, 10-28), and each
# refusal showed Caleb the reply twice. Jev down means no refusal.
# The line came from 160 real closing turns of 2026-10-16 (tests/eval_reply_judges_jev.py
# --replay), not from incident cases: 0.5 fired far more than the word list did.
# shellcheck disable=SC2016
JUDGE_Q='An AI agent wrote this reply about a job it was given. Does it say the agent itself is doing only part of the work: only the top few, a capped amount, a sample, skipping the rest, leaving some for later, or putting some on hold? Say no if it did all of it, if the limit is a setting inside a tool such as a reranker, or if it only describes where something lives or a list someone else wrote.'
P=$(printf '%s' "$MSG" | sed -E 's/"[^"]*"//g; s/`[^`]*`//g' | hook_judge scope-guard "$JUDGE_Q")
hook_judge_yes "$P" "${SCOPE_GUARD_LINE:-0.7}" || exit 0

{
  echo "scope-guard: refusing. Caleb asked for all of it (a recent prompt says all,"
  echo "every, entire or a ton), and this reply does part of it by its own choice."
  echo
  echo "On 2026-10-09 a creator ingest he asked for in full was cut to 36 of 238,"
  echo "10 videos each, with three platforms on hold, and he said \"You didn't"
  echo "listen to me.\""
  echo
  echo "Either keep going at the scope he set, or name each hard limit on its own"
  echo "line as BLOCKED: <what needs his hands or what refused>. Deciding what's"
  echo "enough is his call."
} >&2
exit 2
