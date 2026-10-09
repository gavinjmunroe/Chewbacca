#!/usr/bin/env python3
"""Write SHA256SUMS.txt for the files an install actually executes.

`curl | bash` with no checksum and no pinned release means every install is a
leap of faith, and the README invites exactly that. This does not make a
compromised repo safe. It catches a truncated download, a proxy that rewrote
something in flight, and a mirror that is not what it claims, and it gives
anyone a way to check that what landed on their machine is what is in git.

  python3 tools/checksums.py            write SHA256SUMS.txt
  python3 tools/checksums.py --check    exit 1 if it is stale (CI)
"""

import hashlib
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "SHA256SUMS.txt"
# The files that run. Documentation changing does not need to invalidate this,
# and a checksum file that churns on every doc edit is one people stop reading.
# bin/lib/people/* is named on its own because a glob does not recurse, and
# bin/people is a dispatcher that runs nothing without the modules there.
PATTERNS = ("*.sh", "*.ps1", "bin/*", "bin/lib/*", "bin/lib/people/*", "tools/*.py", ".claude/hooks/*.sh",
            "config/runtimes/*.json")


def files():
    # --cached ONLY. `--others` used to be here as well, which meant any file
    # sitting untracked in the working tree got a checksum. In a repo where
    # several sessions run at once that is another tab's work in flight, and
    # on 2026-09-21 a routine run wrote a line for an untracked hook another
    # session was still writing. Committing it would have shipped a checksum
    # for a file not in the repo, and install verification fails on exactly
    # that.
    #
    # The manifest describes what ships, and what ships is what is committed.
    # A file this session means to include is staged first, and staging puts
    # it in --cached.
    tracked = set(subprocess.run(["git", "-C", str(REPO), "ls-files", "--cached"],
                                 capture_output=True, text=True).stdout.split())
    out = []
    for pat in PATTERNS:
        for p in sorted(REPO.glob(pat)):
            rel = str(p.relative_to(REPO))
            if p.is_file() and rel in tracked and rel != OUT.name:
                out.append(rel)
    return sorted(set(out))


def blob(ref, rel):
    return subprocess.run(["git", "-C", str(REPO), "show", f"{ref}:{rel}"],
                          capture_output=True, check=True).stdout


def render(ref=None):
    # ref hashes the committed tree instead of the working tree. On 2026-10-09
    # pre-push refused a push whose commits were correct because another tab
    # had an uncommitted edit to tools/team.py; the only way through was
    # pushing from a clean worktree. A push ships commits, so check commits.
    if ref:
        tracked = set(subprocess.run(["git", "-C", str(REPO), "ls-tree", "-r", "--name-only", ref],
                                     capture_output=True, text=True).stdout.split())
        names = [rel for rel in files() if rel in tracked]
    else:
        names = files()
    lines = []
    for rel in names:
        data = blob(ref, rel) if ref else (REPO / rel).read_bytes()
        lines.append(f"{hashlib.sha256(data).hexdigest()}  {rel}")
    return "\n".join(lines) + "\n"


def main():
    ref = sys.argv[sys.argv.index("--ref") + 1] if "--ref" in sys.argv else None
    text = render(ref)
    if "--check" in sys.argv:
        current = blob(ref, OUT.name).decode() if ref else (OUT.read_text() if OUT.is_file() else None)
        if current == text:
            print(f"ok  {len(text.splitlines())} checksums current")
            return 0
        print("SHA256SUMS.txt is stale. Run: python3 tools/checksums.py", file=sys.stderr)
        return 1
    OUT.write_text(text)
    print(f"wrote {OUT.name}: {len(text.splitlines())} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
