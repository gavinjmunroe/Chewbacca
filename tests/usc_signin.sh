#!/bin/bash
# A signed-out Brightspace signs itself back in from a background tab, asks for
# Duo only when USC really wants it, and never adds a tab from an unwatched read.
# On 2026-10-26 `brightspace submit` answered BLOCKED minutes after a deadline
# while this sign-in existed only inside `chewbacca usc`.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
HOME="$T" CHEWBACCA_SIGNIN_WAIT=1 CHEWBACCA_SIGNIN_APPROVE_WAIT=1 python3 -I - "$ROOT/bin/lib" <<'PY'
import os, sys
sys.path.insert(0, sys.argv[1])
import usc_signin as u
u.time.sleep = lambda s: None
fail = []
def run(session_after, env_block=False):
    calls = {"add": 0, "close": [], "tell": []}
    n = {"polls": 0}
    def has():
        n["polls"] += 1
        return n["polls"] > session_after
    def add():
        calls["add"] += 1
        return "tab-1"
    if u.STAMP.exists():
        u.STAMP.unlink()
    if env_block:
        os.environ["CHEWBACCA_NO_OPEN"] = "1"
    try:
        ok = u.signin(has, add_tab=add, close=calls["close"].append, tell=calls["tell"].append)
    finally:
        os.environ.pop("CHEWBACCA_NO_OPEN", None)
    return ok, calls
ok, c = run(0)
if not (ok and c["close"] == ["tab-1"] and not c["tell"]):
    fail.append(f"SSO still alive should sign in quietly and close its tab: {ok} {c}")
ok, c = run(10**9)
if ok or len(c["tell"]) != 1 or c["close"]:
    fail.append(f"no session should ask for Duo once and leave the sign-in tab: {ok} {c}")
ok, c = run(0, env_block=True)
if ok or c["add"]:
    fail.append(f"CHEWBACCA_NO_OPEN must never add a tab: {ok} {c}")
for f in fail:
    print("  FAIL", f)
if not fail:
    print("  ok   brightspace signs back in from a background tab, Duo only when asked")
sys.exit(1 if fail else 0)
PY
