#!/usr/bin/env python3
"""No kit integration drives an app's window (feedback_cli_not_app_windows).

2026-10-09, twice in a minute, after Slack sending went through the Slack
desktop app by typing once its window title matched: "Always do this for me and
anyone that uses chewb" and "No we need the cli. No one using chewb should ever
have to open an app ever again". Sending moved to slackcli the same night. This
keeps every bin/chewbacca-* integration on a CLI or an API: no AppleScript
keystroke or key code, and no bringing an app to the front. The agent's own
screen tools (mac/bin/chewie, peekaboo) drive windows by design and are not
integrations, so they are out of scope.
"""
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DRIVE = re.compile(r"\bkeystroke\b|\bkey code\b|\bto activate\b|\bactivate application\b")


def offenders(paths):
    out = []
    for f in paths:
        try:
            lines = f.read_text(encoding="utf-8").splitlines()
        except (UnicodeDecodeError, OSError):
            continue
        for i, line in enumerate(lines, 1):
            if line.strip().startswith(("#", "//", "*")):
                continue
            if DRIVE.search(line):
                out.append(f"{f.name}:{i}: {line.strip()[:100]}")
    return out


def main():
    found = offenders(sorted((ROOT / "bin").glob("chewbacca-*")))
    print(("FAIL" if found else "ok  ") + f"  no integration types into or raises an app window ({len(found)})")
    for f in found:
        print("        " + f)
    with tempfile.TemporaryDirectory() as tmp:
        planted = Path(tmp) / "chewbacca-planted"
        planted.write_text('osascript -e \'tell application "System Events" to keystroke "v" using command down\'\n'
                           '# a comment that says keystroke is fine\n')
        caught = offenders([planted])
    ok = len(caught) == 1
    print(("ok  " if ok else "FAIL") + "  the scan catches a planted keystroke and skips comments")
    return 1 if found or not ok else 0


if __name__ == "__main__":
    sys.exit(main())
