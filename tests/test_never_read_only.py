#!/usr/bin/env python3
"""No scope list in the kit asks for read-only access (feedback_never_read_only).

Caleb said it five times in three days: 2026-10-09 "NOTHING on chewb should
ever be read only that is stupid", 2026-10-10 twice, 2026-10-11 "CHEWBS SHOULD
NEVER BE READ ONLY! ... always literally just ask for full access" after a
Google token holding read-only Drive 403'd a doc write, and 2026-10-11 "Never
read only, find a way to write too". A narrower scope is a future 403, so this
fails on any Google `.readonly` scope or Microsoft Graph `.Read`-only scope
written into the kit's code. Writes are made safe with a snapshot and an undo,
never by asking for less.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GOOGLE = re.compile(r"googleapis\.com/auth/[\w.]+\.readonly\b")
GRAPH = re.compile(r"graph\.microsoft\.com/(\w+)\.(Read(?:Basic)?(?:\.All)?)\b(?!Write)")
# User.Read is sign-in identity, not data access: there is no User.ReadWrite
# a CLI needs, so it is the one read scope allowed.
ALLOWED = {("User", "Read")}


def offenders(root=ROOT):
    out = []
    for folder in ("bin", "tools", "mac", "apps", "config"):
        base = root / folder
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            if not path.is_file() or path.stat().st_size > 2_000_000 or "node_modules" in path.parts:
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            for m in GOOGLE.finditer(text):
                out.append(f"{path.relative_to(root)}: {m.group(0)}")
            for m in GRAPH.finditer(text):
                if (m.group(1), m.group(2)) not in ALLOWED:
                    out.append(f"{path.relative_to(root)}: {m.group(0)}")
    return out


def main():
    fails = 0
    found = offenders()
    print(("FAIL" if found else "ok  ") + f"  no read-only scopes in the kit ({len(found)} found)")
    for f in found:
        print("        " + f)
    fails += bool(found)
    # The check itself must be able to fail.
    probe = 'SCOPES = "https://www.googleapis.com/auth/drive.readonly https://graph.microsoft.com/Mail.Read"'
    caught = len(GOOGLE.findall(probe)) + len([m for m in GRAPH.finditer(probe) if (m.group(1), m.group(2)) not in ALLOWED])
    ok = caught == 2 and not GRAPH.search("https://graph.microsoft.com/Mail.ReadWrite")
    print(("ok  " if ok else "FAIL") + "  the scan catches a planted read-only scope and passes ReadWrite")
    fails += not ok
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
