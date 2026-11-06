#!/usr/bin/env python3
"""Breaks the stress test of 2026-11-05 found in tools, kept fixed. Runs in a box: temp HOME,
and launchctl is a stub that fails the test if a tool reaches for it."""
import json
import os
import pathlib
import stat
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
fails = []


def check(name, ok, got=""):
    if not ok:
        fails.append(name)
        print(f"FAIL {name}: {str(got)[-200:]}")


with tempfile.TemporaryDirectory() as tmp:
    log = pathlib.Path(tmp) / "reached"
    shim = pathlib.Path(tmp) / "shim"
    shim.mkdir()
    stub = shim / "launchctl"
    stub.write_text(f"#!/bin/sh\necho launchctl >> {log}\n")
    stub.chmod(stub.stat().st_mode | stat.S_IEXEC)
    env = dict(os.environ, HOME=tmp, PATH=f"{shim}:{os.environ['PATH']}", CHEWBACCA_NO_SEND="1")

    def run(tool, *args):
        return subprocess.run([str(ROOT / "bin" / tool), *args], capture_output=True, text=True, env=env, timeout=20, stdin=subprocess.DEVNULL)

    r = run("hud-autostart", "--help")
    check("hud-autostart --help", r.returncode == 0 and "usage" in r.stdout, r.stderr)
    r = run("hud-autostart", "instal")
    check("hud-autostart typo stops", r.returncode == 2, r.returncode)
    check("neither one touched launchctl", not log.exists(), "launchctl ran")
    r = run("closeout", "--help")
    check("closeout --help", r.returncode == 0 and r.stdout.strip(), r.stderr)
    r = run("edit-cut", "--help")
    check("edit-cut --help", r.returncode == 0, r.stderr)
    for tool, args in (("prose-check", ["/nonexistent-x.md"]), ("untrusted-screen", ["/nonexistent-x.md"]),
                       ("seo-check", ["http://stress-test.invalid"])):
        r = run(tool, *args)
        check(f"{tool} bad argument has no traceback", r.returncode != 0 and "Traceback" not in r.stderr, r.stderr)

    # The send hold: off with no file, on with one, and never on an ordinary command.
    hook = ROOT / ".claude" / "hooks" / "client-post-guard.sh"

    def hold(cmd):
        p = json.dumps({"tool_name": "Bash", "tool_input": {"command": cmd}})
        return subprocess.run(["bash", str(hook)], input=p, capture_output=True, text=True, env=dict(env, CHEWBACCA_LOG_DIR=tmp)).returncode

    SENDS = ["mac messages send +13105551212 hi", "people texts send jonah hi", "people send jonah hi", "wacli send +1 hi",
             "text-group +1,+2 hi", "cd x && gog gmail send --to a@b.c", "chewbacca email send a@b.c",
             "curl -X POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send -d x",
             "/Users/x/.local/bin/text-blast list.csv", "slackcli messages send '#c' hi",
             "bash -c 'mac messages send +1 hi'"]
    for cmd in SENDS:
        check(f"no hold file, passes: {cmd}", hold(cmd) == 0)
    policy = pathlib.Path(tmp) / ".chewbacca" / "policy"
    policy.mkdir(parents=True)
    (policy / "send-hold").write_text("Caleb")
    for cmd in SENDS:
        check(f"hold on, refused: {cmd}", hold(cmd) == 2)
    for cmd in ["ls", "people texts drafts add jonah hi", "people texts jonah", "mac messages read", "grep -n send-file bin/x"]:
        check(f"hold on, still passes: {cmd}", hold(cmd) == 0)

print("ok: stress tools" if not fails else f"{len(fails)} failed")
sys.exit(1 if fails else 0)
