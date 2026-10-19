#!/usr/bin/env python3
"""Every repo path a hook names exists.

Hooks inject their text into prompts, so a path in one is an instruction to
open that file. On 2026-10-19 design-context.sh told every UI session to read
tools/stances.py, which never existed; the file is apps/ux-engine/tools/stances.py.
Placeholders (x.py, anything with * { $ <) are examples, not paths.
"""
import glob
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
tracked = set(subprocess.run(["git", "ls-files"], capture_output=True, text=True).stdout.splitlines())
dirs = {os.path.dirname(t) for t in tracked}
dead = []
for f in sorted(glob.glob(".claude/hooks/*.sh")):
    for i, line in enumerate(open(f, errors="replace"), 1):
        for m in re.finditer(r"(?<![\w/.-])((?:bin|tools|tests|skills|docs|config|apps)/[A-Za-z0-9_./-]+)", line):
            p = m.group(1).rstrip(".,:;)")
            if any(c in p for c in "*{$<") or os.path.basename(p) in ("x.py", "x.sh", "x"):
                continue
            if p in tracked or p.rstrip("/") in dirs or any(d.startswith(p.rstrip("/") + "/") for d in dirs):
                continue
            dead.append(f"{f}:{i}: {p}")
if dead:
    print("FAIL hooks name repo paths that don't exist:")
    print("\n".join(dead))
    sys.exit(1)
print("ok   every repo path a hook names exists")
