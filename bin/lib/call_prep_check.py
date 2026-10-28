"""call_prep_check: refuse a founder call script that would confuse the room.

Every check here is a failure from the Junto call on 2026-10-28. The script
went through four layered rewrites, Caleb called one "NOT COMPREHENDABLE FOR
US SPEAK ENGLISH", and on the call Reed still asked "are you guys a software?
Are you guys a service?" and raised money with no number on the page.

    python3 bin/lib/call_prep_check.py <script.md>

Exit 0 when it passes, 1 with the problems listed. Warnings never fail.
"""
import re
import sys
from pathlib import Path

# Texting shorthand Gavin can't read live (feedback_call_prep_plain_english_for_gav).
SHORTHAND = re.compile(r"(?<![\w/'])(u|ur|w|rn|abt|bc|tmr|ppl|plz|idk|lmk)(?![\w/'])")

# Insider words that went into the 10/28 Junto doc unexplained. A line that
# says never or don't is telling the reader to avoid the word, so it passes.
JARGON = ("send gate", "list-gate", "list gate", "MCP", "RMM", "GDM", "dirty test list", "desktop app")

# A sentence about what we did to their site; the 10/28 script said "We put it
# at the top" and the number sat 5,350px down.
SITE_CLAIM = re.compile(r"\b(we (put|added|moved|rebuilt|redid)|our version|on ours)\b", re.I)

STEP = re.compile(r"^\s*#*\s*\d+\.\s")


def check(text: str):
    problems, warnings = [], []
    low = text.lower()

    if not re.search(r"what'?s working|working for you", low):
        problems.append('no channel question; ask "What\'s working for you right now, and what isn\'t?"')
    if "service" not in low or not re.search(r"we do (the work|it for you)|do it for you", low):
        problems.append('no one-line answer to "software or service?" (say: a service, we do the work)')
    if "claude" not in low:
        problems.append('no answer to "why not just Claude with a connector?"')
    if not re.search(r"work with us|engagement|lists only|full campaign", low):
        problems.append("the engagement is never described (what working with us looks like)")
    # A dollar figure counts only next to price words; the Junto doc's "$1.5M
    # fundraise" passed an earlier bare \$\d pattern with no price anywhere.
    priced = re.search(r"(price|retainer|pilot costs?|per month|a month|/mo)[^\n]{0,40}\$\s?\d"
                       r"|\$\s?\d[\d,.k]*\s?(/mo|a month|per month|a week|per week)", low)
    if not priced and not re.search(r"\[need: ?price", low):
        problems.append("no price range and no [NEED: price range] marker")

    for n, line in enumerate(text.splitlines(), 1):
        if STEP.match(line) and not re.search(r"\b(gavin|caleb)\b", line, re.I):
            problems.append(f"line {n}: step doesn't say who talks: {line.strip()[:60]}")
        bare = re.sub(r'"[^"]*"', "", line)  # quoted lines are allowed to sound like a person
        m = SHORTHAND.search(bare)
        if m:
            problems.append(f'line {n}: texting shorthand "{m.group(0)}"')
        if not re.search(r"\b(never|don'?t)\b", line, re.I):
            for term in JARGON:
                if term.lower() in line.lower():
                    problems.append(f'line {n}: unexplained jargon "{term}"')
        if SITE_CLAIM.search(line):
            warnings.append(f"line {n}: claim about our site, check it on the live page: {line.strip()[:60]}")
    return problems, warnings


def main(argv) -> int:
    if len(argv) != 2:
        print("usage: call_prep_check.py <script.md>")
        return 2
    problems, warnings = check(Path(argv[1]).read_text())
    for w in warnings:
        print("warn " + w)
    for p in problems:
        print("FAIL " + p)
    if not problems:
        print("ok   call script passes")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
