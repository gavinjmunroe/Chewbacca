"""call_prep_check: refuse a founder call script that would confuse the room.

Every check here is a failure from the Junto call on 2026-10-28. The script
went through four layered rewrites, Caleb called one "NOT COMPREHENDABLE FOR
US SPEAK ENGLISH", and on the call Reed still asked "are you guys a software?
Are you guys a service?" and raised money with no number on the page.

    python3 bin/lib/call_prep_check.py <script.md> [--absent Gavin]
    python3 bin/lib/call_prep_check.py --doc <google-doc-id> [--tab Firebox] [--absent Gavin]

--doc reads the live Google Doc through gws and checks every tab on its own
(or just --tab), since the scripts Caleb reads on a call live there, not in a
.md. Exit 0 when it passes, 1 with the problems listed. Warnings never fail.
"""
import argparse
import json
import re
import subprocess
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

# 10/28, 15 minutes before the Firebox call, a 1,000-word section drew "Bro
# its wayyy too dense speak english"; the rewrite he read live was 431 words.
MAX_WORDS = 450

# A founder heading carries the call time, like "Firebox: 4:30 to 5:00". Three
# of them in one tab had to be split into doc tabs mid call day (10/28).
FOUNDER_HEADING = re.compile(r"^\s*#*\s*[A-Z][\w .&'-]{1,40}:.*\b\d{1,2}:\d{2}\b")


def check(text: str, absent=()):
    problems, warnings = [], []
    low = text.lower()

    words = len(text.split())
    if words > MAX_WORDS:
        problems.append(f"{words} words, read live it has to fit {MAX_WORDS}; move detail to the sheet")
    heads = [l.strip() for l in text.splitlines() if FOUNDER_HEADING.match(l)]
    if len(heads) > 1:
        problems.append(f"{len(heads)} founder calls in one script, give each its own doc tab: " + "; ".join(h[:30] for h in heads))
    # 10/28: Gavin couldn't make the Firebox call and one leftover line drew
    # "bro gav cant make it". Someone not on the call isn't in the script at all.
    for name in absent:
        for n, line in enumerate(text.splitlines(), 1):
            if re.search(rf"\b({re.escape(name)}|{re.escape(name[:3])})\b", line, re.I):
                problems.append(f"line {n}: {name} isn't on this call, take him out: {line.strip()[:60]}")

    if not re.search(r"what'?s working|working for you", low):
        problems.append('no channel question; ask "What\'s working for you right now, and what isn\'t?"')
    # Caleb's 10/28 line for founders new to outbound has no "service" in it:
    # "Right now we do it for you." Either form answers the question.
    if not re.search(r"we do (the work|it for you)|do it for you", low):
        problems.append('no one-line answer to "software or service?" (say: a service, we do the work)')
    if "claude" not in low:
        problems.append('no answer to "why not just Claude with a connector?"')
    if not re.search(r"work with us|engagement|lists only|full campaign|\bpilot\b", low):
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


def doc_tabs(doc_id: str):
    """(title, text) for every tab of a Google Doc, read with gws."""
    out = subprocess.run(["gws", "docs", "documents", "get", "--params",
                          json.dumps({"documentId": doc_id, "includeTabsContent": True})],
                         capture_output=True, text=True, check=True).stdout
    d = json.loads(out[out.find("{"):])
    tabs = []
    for t in d.get("tabs", []):
        body = t["documentTab"]["body"]["content"]
        text = "".join(e.get("textRun", {}).get("content", "")
                       for el in body if "paragraph" in el for e in el["paragraph"]["elements"])
        tabs.append((t["tabProperties"]["title"], text))
    return tabs


def report(label, text, absent) -> int:
    problems, warnings = check(text, absent)
    for w in warnings:
        print(f"warn {label}{w}")
    for p in problems:
        print(f"FAIL {label}{p}")
    if not problems:
        print(f"ok   {label}call script passes")
    return 1 if problems else 0


def main(argv) -> int:
    ap = argparse.ArgumentParser(prog="call_prep_check.py")
    ap.add_argument("path", nargs="?")
    ap.add_argument("--doc")
    ap.add_argument("--tab")
    ap.add_argument("--absent", action="append", default=[])
    a = ap.parse_args(argv[1:])
    if bool(a.path) == bool(a.doc):
        ap.print_usage()
        return 2
    if a.path:
        return report("", Path(a.path).read_text(), a.absent)
    rc = 0
    for title, text in doc_tabs(a.doc):
        if a.tab and title.lower() != a.tab.lower():
            continue
        rc |= report(f"[{title}] ", text, a.absent)
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv))
