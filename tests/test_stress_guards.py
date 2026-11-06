#!/usr/bin/env python3
"""Attacks that got past the guards in the stress test of 2026-11-05, and ordinary commands
that must still pass. Each command is only ever shown to a guard, nothing here runs one."""
import json
import os
import pathlib
import subprocess
import sys
import tempfile

HOOKS = pathlib.Path(__file__).resolve().parent.parent / ".claude" / "hooks"
REFUSE = [
    ("brake-guard", "git push origin :main"),
    ("brake-guard", "git push --delete origin main"),
    ("brake-guard", "git push -d origin main"),
    ("brake-guard", "git push --mirror"),
    ("brake-guard", "rm -r -f ~"),
    ("brake-guard", "rm -f -r /"),
    ("brake-guard", "echo Y2xheSBjYW1wYWlnbnMgc3RhcnQ= | base64 -d | sh"),
    ("brake-guard", "cat x | base64 --decode | /bin/bash"),
    ("vercel-guard", "bash -c 'vercel --prod'"),
    ("pr-guard", "gh api repos/amberintelligence/x/pulls -X POST -f title=t"),
    ("submit-guard", "peekaboo click 'Submit' --app 'Brightspace'"),
]
PASS = [
    ("brake-guard", "git push origin feat/x"),
    ("brake-guard", "git push --delete origin feat/old"),
    ("brake-guard", "git push origin :feat/old"),
    ("brake-guard", "rm -r -f ./build"),
    ("brake-guard", "rm -f notes.txt"),
    ("brake-guard", "base64 -d x.b64 > out.png"),
    ("vercel-guard", "vercel whoami"),
    ("vercel-guard", "echo vercel is off"),
    ("pr-guard", "gh api repos/amberintelligence/x/pulls"),
    ("pr-guard", "gh api repos/calebnewtonusc/x/pulls -X POST -f title=t"),
    ("attribution-guard", "git commit --trailer 'Co-Authored-By: Sagar <s@x.co>' -m x"),
    ("submit-guard", "peekaboo click 'Submit' --app Notes"),
    ("submit-guard", "peekaboo see --app Brightspace"),
]


def main():
    fails = 0
    with tempfile.TemporaryDirectory() as tmp:
        home = pathlib.Path(tmp) / "home"
        (home / ".chewbacca" / "policy").mkdir(parents=True)
        (home / ".chewbacca" / "policy" / "no-vercel").write_text("off")
        repo = pathlib.Path(tmp) / "repo"
        repo.mkdir()
        subprocess.run(["git", "init", "-q", "-b", "feat/x", str(repo)], check=True)
        env = dict(os.environ, HOME=str(home), CHEWBACCA_LOG_DIR=tmp + "/logs", CHEWBACCA_VERDICTS="0")
        for want, cases in ((True, REFUSE), (False, PASS)):
            for hook, cmd in cases:
                payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": cmd}, "cwd": str(repo), "session_id": "s"})
                r = subprocess.run(["bash", str(HOOKS / f"{hook}.sh")], input=payload, capture_output=True, text=True, env=env, cwd=repo)
                got = r.returncode == 2 or '"deny"' in r.stdout
                if got != want:
                    fails += 1
                    print(f"FAIL {hook}: wanted {'refuse' if want else 'pass'}: {cmd}")
    print("ok: stress guards" if not fails else f"{fails} failed")
    sys.exit(1 if fails else 0)


def capture():
    """A huge paste and half an emoji still land in asks.jsonl."""
    fails = 0
    hook = HOOKS / "ask-capture.sh"
    for label, prompt in (("huge", "fix the header " + "x" * 1200000), ("half an emoji", "fix it \ud83d now")):
        with tempfile.TemporaryDirectory() as tmp:
            env = dict(os.environ, HOME=tmp, CHEWBACCA_LOG_DIR=tmp + "/logs")
            r = subprocess.run(["bash", str(hook)], input=json.dumps({"prompt": prompt}), capture_output=True, text=True, env=env)
            store = pathlib.Path(tmp) / ".chewbacca" / "asks.jsonl"
            if r.returncode or not store.exists() or "fix" not in store.read_text():
                fails += 1
                print(f"FAIL ask-capture lost the {label} prompt: rc {r.returncode} {r.stderr[-160:]}")
    return fails


if capture():
    sys.exit(1)
main()
