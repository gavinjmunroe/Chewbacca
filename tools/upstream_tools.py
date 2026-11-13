#!/usr/bin/env python3
"""Which PATH tools upstream/main has that this fork's main doesn't.

    python3 -I tools/upstream_tools.py [--repo DIR] [--ours REF] [--theirs REF] [--json]

A fork of Chewbacca installs its kit from its own origin/main. Caleb's docs in
shared repos name tools the day he lands them upstream, so a fork that hasn't
merged upstream gets "command not found" on a step the doc calls required.

On 2026-11-13 Firm Foundation's ops/SITE-BAR.md (Caleb, 11/12) said every church
preview must pass `ux-bar` before it ships. ux-bar landed in calebnewtonusc/Chewbacca
as 6d0451ea; gavinjmunroe/Chewbacca's main was 139 commits behind upstream, so
`command -v ux-bar` came back empty on Gavin's Mac in the middle of starting two
church previews. Nothing in doctor compared the fork to upstream: the Version
section only compares the installed kit to origin/main, which agreed.

Reads local refs only (no fetch, no network), so it is safe inside doctor.
Stdlib only, Python 3.9.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from typing import Dict, List, Optional, Set


def git(repo: str, *args: str) -> Optional[str]:
    p = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)
    return p.stdout if p.returncode == 0 else None


def tools_in(repo: str, ref: str) -> Optional[Set[str]]:
    """Files directly under bin/ or apps/<app>/bin/ in `ref`'s tree, the shapes
    the kit links onto PATH. None when the ref doesn't exist."""
    out = git(repo, "ls-tree", "-r", "--name-only", ref, "--", "bin", "apps")
    if out is None:
        return None
    found = set()
    for path in out.splitlines():
        parts = path.split("/")
        if len(parts) == 2 and parts[0] == "bin":
            found.add(path)
        elif len(parts) == 4 and parts[0] == "apps" and parts[2] == "bin":
            found.add(path)
    return found


def compare(repo: str, ours: str = "origin/main", theirs: str = "upstream/main") -> Dict:
    have = tools_in(repo, ours)
    want = tools_in(repo, theirs)
    if have is None or want is None:
        return {"available": False, "ours": ours, "theirs": theirs}
    behind = git(repo, "rev-list", "--count", f"{ours}..{theirs}")
    missing: List[str] = sorted(want - have)
    return {
        "available": True,
        "ours": ours,
        "theirs": theirs,
        "behind": int(behind.strip()) if behind and behind.strip().isdigit() else None,
        "missing": missing,
        "missing_names": [m.rsplit("/", 1)[-1] for m in missing],
    }


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="upstream_tools", description=__doc__.split("\n")[0])
    ap.add_argument("--repo", default=".")
    ap.add_argument("--ours", default="origin/main")
    ap.add_argument("--theirs", default="upstream/main")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    r = compare(a.repo, a.ours, a.theirs)
    if a.json:
        print(json.dumps(r))
        return 0
    if not r["available"]:
        print(f"no {a.theirs} ref here, nothing to compare")
        return 0
    print(f"{a.ours} is {r['behind']} commit(s) behind {a.theirs}")
    for m in r["missing"]:
        print(f"  missing: {m}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
