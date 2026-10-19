#!/usr/bin/env python3
"""Every relative link in the docs points at something that exists.

On 2026-09-21 docs/reference/REFERENCE.md had 57 broken links, all one bug: it used
repo-root-relative paths while living in docs/, so every link to a skill, a
template or a snippet was missing ../. The file reads fine and every link is
dead, which is why nobody noticed.

Collects every broken link and exits 1 if there is one, so it can gate a commit.
A %20 in a target is a space, and links inside fenced code blocks are examples,
not links: both were reported broken (break-it, 2026-10-19).
"""
import pathlib, re, sys, urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
SKIP = re.compile(r"^(https?:|#|mailto:|/)")

def main():
    bad = []
    for md in sorted(set(list(ROOT.glob("*.md")) + list(ROOT.glob("docs/**/*.md"))
                         + list(ROOT.glob("library/methods/*.md")) + list(ROOT.glob("skills/**/*.md")))):
        try:
            text = md.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        text = re.sub(r"^(```|~~~).*?^\1[^\n]*$", "", text, flags=re.S | re.M)
        for m in re.finditer(r"\[([^\]]*)\]\(([^)\s]+)\)", text):
            target = urllib.parse.unquote(m.group(2).split("#")[0])
            if not target or SKIP.match(target):
                continue
            if not (md.parent / target).exists():
                bad.append(f"{md.relative_to(ROOT)}: [{m.group(1)[:34]}] -> {target}")
    for b in bad:
        print(f"  {b}")
    print(f"  {len(bad)} broken relative link(s)")
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(main())
