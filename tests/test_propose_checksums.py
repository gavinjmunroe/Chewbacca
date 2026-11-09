#!/usr/bin/env python3
"""propose refreshes SHA256SUMS.txt for the change in the working tree,
without staging anything.

tools/checksums.py hashes the index. Before 2026-10-10 propose ran it on the
real index, so an edited file kept its old hash and the suite's "start.sh's
own checksum gate" failed in every candidate that edited a tracked file, which
the gate reads as a newly failing test and refuses. And evolve reads the
change as `git diff`, so staging it to fix the hash would empty the diff.
"""
import hashlib
import importlib.util
import shutil
import subprocess
import sys
import tempfile
from importlib.machinery import SourceFileLoader
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    loader = SourceFileLoader("propose", str(ROOT / "bin" / "propose"))
    propose = importlib.util.module_from_spec(importlib.util.spec_from_loader("propose", loader))
    loader.exec_module(propose)
    with tempfile.TemporaryDirectory() as tmp:
        repo = Path(tmp)
        (repo / "bin").mkdir()
        (repo / "tools").mkdir()
        shutil.copy(ROOT / "tools" / "checksums.py", repo / "tools" / "checksums.py")
        (repo / "bin" / "tool").write_text("old\n")
        g = lambda *a: subprocess.run(["git", "-C", str(repo), *a], capture_output=True,
                                      text=True, check=True).stdout
        g("init", "-q")
        g("config", "user.email", "t@t")
        g("config", "user.name", "t")
        g("add", "bin/tool", "tools/checksums.py")
        subprocess.run([sys.executable, "tools/checksums.py"], cwd=repo, check=True,
                       capture_output=True)
        g("add", "SHA256SUMS.txt")
        g("commit", "-qm", "base")

        # What a proposal leaves behind: an edited tracked file and a new one.
        (repo / "bin" / "tool").write_text("new\n")
        (repo / "bin" / "parser").write_text("added\n")
        propose.refresh_checksums(repo)

        sums = (repo / "SHA256SUMS.txt").read_text()
        want = lambda rel: hashlib.sha256((repo / rel).read_bytes()).hexdigest() + "  " + rel
        problems = []
        if want("bin/tool") not in sums:
            problems.append("the edited file kept its old hash")
        if want("bin/parser") not in sums:
            problems.append("the new file is missing or carries the empty blob's hash")
        if g("diff", "--cached", "--name-only").strip():
            problems.append("the real index was staged: " + g("diff", "--cached", "--name-only"))
        diff = g("diff", "--name-only").split()
        if not {"bin/tool", "bin/parser", "SHA256SUMS.txt"} <= set(diff):
            problems.append(f"git diff no longer shows the whole change: {diff}")
    for p in problems:
        print("FAIL " + p)
    print("ok   propose refreshes checksums for the working tree, staging nothing"
          if not problems else f"{len(problems)} failed")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
