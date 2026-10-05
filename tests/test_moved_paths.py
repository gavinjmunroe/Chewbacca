#!/usr/bin/env python3
"""Code must not reach a top-level folder that moved into library/, config/ or
apps/ on 2026-10-05.

The suite passed on the move and four paths were still wrong, because nothing
it runs touched them: bin/realm-engine joined parent.parent / "data", the
LinkedIn procedures counted `:h` modifiers to find bin/chrome-js, start.ps1
used Windows separators, and bin/propose matched "settings/" as a prefix. Each
one failed silently on a real machine. This reads the code for those shapes
instead of waiting for someone to run the path."""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOVED = ("procedures methods crafts maps learning decisions prompts templates snippets "
         "examples research settings runtimes instructions patches data surfaces genui "
         "fanout call extensions mcp texts work").split()
NAMES = "|".join(MOVED)

# Each pattern is an anchor that means "the repo root", followed by a moved name.
SHAPES = [
    re.compile(r"\b(?:ROOT|REPO|fx\.ROOT|parent\.parent)\s*/\s*[\"'](" + NAMES + r")[\"']"),
    re.compile(r"\$\{?(?:ROOT|REPO|SCRIPT_DIR|DIR)\}?/(" + NAMES + r")[/\"]"),
    re.compile(r"pwd\)/(" + NAMES + r")/"),
    re.compile(r"Join-Path \$\w+ \"(" + NAMES + r")\\"),
    re.compile(r"[\"'](" + NAMES + r")/[\"'],"),
]
CODE = re.compile(r"\.(py|sh|mjs|js|ts|ps1)$")

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


def code_files():
    tracked = subprocess.check_output(["git", "ls-files"], cwd=ROOT, text=True).splitlines()
    for rel in tracked:
        if rel.startswith(("plynn/", "tests/")) or rel == "tests/test_moved_paths.py":
            continue
        p = ROOT / rel
        if not p.is_file() or p.is_symlink():
            continue
        if CODE.search(rel) or rel.startswith("bin/") and "." not in p.name:
            yield rel, p


def main() -> int:
    hits = []
    for rel, p in code_files():
        try:
            text = p.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for n, line in enumerate(text.splitlines(), 1):
            if any(s.search(line) for s in SHAPES):
                hits.append(f"{rel}:{n}: {line.strip()[:100]}")
    check("no code reaches a moved folder at its old top-level path", not hits, hits)

    # The zsh procedures find bin/chrome-js by stripping path components. Expand
    # the exact expression each script uses and make sure it lands on a file.
    for rel in ("library/procedures/linkedin-skills/run.sh", "library/procedures/linkedin-ux/map.sh"):
        line = next(l for l in (ROOT / rel).read_text().splitlines() if "/bin/chrome-js" in l and "=" in l)
        script = f"0={ROOT / rel}; {line}; print -r -- $C"
        got = subprocess.run(["zsh", "-fc", script], capture_output=True, text=True).stdout.strip()
        check(f"{rel} finds bin/chrome-js", Path(got).is_file(), got)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
