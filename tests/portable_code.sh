#!/bin/bash
# Code that ships in Chewbacca works for whoever installs it, not only on the
# machine it was written on. Caleb, 2026-10-11: "When we build things for
# chewbacca it should automatically build in a way that would work for everyone
# else too". That night shipped code still carried his work email as the Chrome
# profile default and as the SEC contact, so every user ran as him.
#
# Fails on a non-comment line in shipped code holding a home directory, a
# personal mailbox, or a client's Clay workspace id. Per-user values come from
# the environment, the user's own config, or `git config`. The few that predate
# this check are listed in tests/portable_allow.txt and may only shrink.
set -u
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
python3 - "$ROOT" <<'PY'
import re, subprocess, sys
root = sys.argv[1]
pats = [r"/Users/[a-z][a-z0-9_-]+/", r"[A-Za-z0-9._%+-]+@(gmail\.com|usc\.edu|bluemodernadvisory\.com|icloud\.com)",
        r"\b1372623\b"]
comment = re.compile(r"""^\s*(#|//|\*|/\*|<!--)""")
allow = set()
try:
    allow = {l.strip() for l in open(f"{root}/tests/portable_allow.txt") if l.strip() and not l.startswith("#")}
except OSError:
    pass
out = subprocess.run(["git", "-C", root, "grep", "-nIE", "|".join(pats), "--", "bin", "tools", "mac",
                      ".claude/hooks", "hud/Sources", "apps", ":!*test*", ":!*fixture*"],
                     capture_output=True, text=True).stdout
bad = []
for line in out.splitlines():
    path, no, text = line.split(":", 2)
    if comment.match(text) or path in allow:
        continue
    bad.append(f"{path}:{no}: {text.strip()[:120]}")
stale = [p for p in allow if not any(l.startswith(p + ":") for l in out.splitlines())]
for b in bad:
    print("FAIL  only works on one machine:", b)
for s in stale:
    print("FAIL  fixed, so drop it from tests/portable_allow.txt:", s)
if not bad and not stale:
    print("ok    no shipped code hardcodes a home path, a personal mailbox or a client workspace id")
sys.exit(1 if bad or stale else 0)
PY
