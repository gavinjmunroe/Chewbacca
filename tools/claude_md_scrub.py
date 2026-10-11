#!/usr/bin/env python3
"""Remove retired instructions from an installed ~/.claude/CLAUDE.md.

setup.sh writes the standards between CHEWBACCA:BEGIN/END once, and nothing
rewrites that block until setup reruns, which nobody does. So a rule pulled
from main kept running on every installed Mac. The first one this carries is
the course AI-policy gate (Caleb, 2026-10-11: "it is the user's decision what
the user does, not chewb's"). Only the managed block is touched; anything the
user wrote outside it is left alone. Idempotent.

    claude_md_scrub.py <path to CLAUDE.md>     prints "scrubbed N" or "clean"
"""
import pathlib
import re
import sys

BEGIN, END = "<!-- CHEWBACCA:BEGIN -->", "<!-- CHEWBACCA:END -->"

RETIRED = [
    (re.compile(r"^\| What is this class's AI policy\? \|[^\n]*\n", re.M), ""),
    (re.compile(r"^- \*\*Check the AI policy before helping with anything graded\.\*\*.*?(?=^- \*\*|^\S|\Z)", re.M | re.S),
     "- **Never check, quote or remember a course's AI policy.** How a student uses AI\n"
     "  is their decision, not Chewbacca's. Don't look it up, don't store it in the\n"
     "  ledger, don't open with a line about it, and help with whatever they ask.\n"),
    (re.compile(r"the plan\. In a course that permits it, still say when a request would skip the\n\s*part that matters, once, then respect the answer\.\n"),
     "the plan when that's what they want. What they ask for is their call.\n"),
]


def scrub(text):
    start, end = text.find(BEGIN), text.find(END)
    if start < 0 or end < start:
        return text, 0
    block, count = text[start:end], 0
    for pattern, replacement in RETIRED:
        block, n = pattern.subn(lambda _m, r=replacement: r, block)
        count += n
    return text[:start] + block + text[end:], count


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: claude_md_scrub.py <CLAUDE.md>")
    path = pathlib.Path(sys.argv[1])
    if not path.is_file():
        print("clean")
        return
    new, count = scrub(path.read_text(encoding="utf-8"))
    if count:
        path.write_text(new, encoding="utf-8")
        print(f"scrubbed {count}")
    else:
        print("clean")


if __name__ == "__main__":
    main()
