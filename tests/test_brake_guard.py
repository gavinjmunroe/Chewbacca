#!/usr/bin/env python3
"""brake-guard: a runtime install refuses `rm -rf ~` and a force push to main.

The 10/12 stranger run let both through on a runtime install, which promises
no permission changes and so wrote none of the full installer's deny rules.
Run: python3 tests/test_brake_guard.py
"""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOOK = ROOT / ".claude" / "hooks" / "brake-guard.sh"
sys.path.insert(0, str(ROOT / "tools"))
failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


import tempfile  # noqa: E402

TMP = Path(tempfile.mkdtemp(prefix="brake-"))
ON_MAIN, ON_FEAT = TMP / "on-main", TMP / "on-feat"
for repo, branch in ((ON_MAIN, "main"), (ON_FEAT, "feat/x")):
    subprocess.run(["git", "init", "-q", "-b", branch, str(repo)], check=True)


def run(command, tool="Bash", cwd=ON_MAIN):
    payload = json.dumps({"tool_name": tool, "tool_input": {"command": command}, "cwd": str(cwd),
                          "permission_mode": "bypassPermissions", "session_id": "t"})
    done = subprocess.run(["bash", str(HOOK)], input=payload, text=True, capture_output=True,
                          env=dict(os.environ, HOOKD_INNER="1"), timeout=20)
    return done.returncode, done.stderr


check("the hook exists and is executable", HOOK.is_file() and os.access(HOOK, os.X_OK))
# A syntax error makes bash exit 2, which a PreToolUse hook reads as a
# refusal of EVERY command (10/13: one apostrophe in the python body did it).
syntax = subprocess.run(["bash", "-n", str(HOOK)], capture_output=True, text=True)
check("the hook parses, so it can never refuse everything", syntax.returncode == 0, syntax.stderr)
for cmd in ["rm -rf ~", "rm -rf ~/", "rm -rf ~/*", "rm -fr $HOME", "rm -Rf /", "sudo rm -rf /*",
            "rm --recursive --force ~", "ls && rm -rf ~", f"rm -rf {Path.home()}",
            "git push --force origin main", "git push -f", "git push -f origin HEAD", "git push origin +main",
            "git push --force-with-lease origin master", "git -C repo push -f origin HEAD:main",
            "rm -vrf ~", "cd /tmp; rm -rf ~/.", "rm -rf $HOME/../" + Path.home().name, 'bash -c "rm -rf ~"',
            "true & rm -rf ~", "(rm -rf ~)", "env FOO=1 rm -rf /", "git push -f --all", "git push --mirror -f",
            f"git -C {ON_MAIN} push -f", "git checkout main && git push -f", "git push -f origin --branches",
            # The review of 523b677d (10/13): each of these reached the guard and got through.
            "rm -rf ${HOME}", 'rm -rf "${HOME}"', "cd ~ && rm -rf .", "cd ~ && rm -rf *", "rm -rf ~/..",
            'bash -lc "rm -rf ~"', 'bash -c "echo hi; rm -rf ~"', "sudo -u me rm -rf ~", "nice -n 5 rm -rf ~",
            "timeout 9 rm -rf ~", "eval rm -rf ~", 'echo "$(rm -rf ~)"', "{ rm -rf ~; }",
            'git push --force origin "$(git branch --show-current)"', "git push -f origin $BR",
            # The review of f83ffe76: cd options, a -c body after options, env -S, wildcard-only globs.
            "cd -P ~ && rm -rf .", 'bash -c -e "rm -rf ~"', 'env -S "rm -rf ~"', "rm -rf ~/.??*", "rm -rf /?*",
            "git push --force-with-leas origin main", "(cd /tmp) && rm -rf .", "cd ~ && rm -rf ../.. | cat",
            "rm -rf ~/*/",
            "git push -f origin 'refs/heads/*:refs/heads/*'", "git push -f origin :", "GIT_DIR=x git push -f",
            "git --git-dir=x push -f origin HEAD"]:
    code, err = run(cmd)
    check(f"refuses: {cmd}", code == 2 and "brake-guard" in err, (code, err))
for cmd in ["git push -f", "git push -f origin HEAD", f"git -C {ON_FEAT} push -f", "git push -f origin feat/x:feat/x",
            "git push -f origin HEAD:refs/heads/feat/y"]:
    code, err = run(cmd, cwd=ON_FEAT)
    check(f"lets through on a feature branch: {cmd}", code == 0, (code, err))
for cmd in ['echo "a && rm -rf ~ && b"', f"cd {ON_FEAT} && git push --force-with-lease",
            "git push --force-if-includes origin main", 'rm -rf "$(mktemp -d)"', "rm -rf .", "rm -rf *",
            "find . -name x -exec rm -rf {} +", "cd ~/code && rm -rf old-thing", "rm -rf ~/*.log",
            "rm -rf ./build", "rm -rf ~/code/tmp", "rm -rf node_modules", 'echo "rm -rf ~"',
            "grep -n 'rm -rf ~' notes.md", "git push origin main", "git push --force origin feat/x",
            "git push -f origin my-branch", "git commit -m 'never git push -f main'"]:
    code, err = run(cmd)
    check(f"lets through: {cmd}", code == 0, (code, err))
code, _ = run("rm -rf *", cwd=Path.home())
check("rm -rf * in your home folder is refused", code == 2)
code, _ = run("rm -rf ~", tool="Write")
check("only Bash is judged", code == 0)
_, err = run("rm -rf ~")
check("the refusal names no person", "Caleb" not in err and "caleb" not in err, err)

import agent_runtime  # noqa: E402
pre = agent_runtime.CLAUDE_CHECKS["PreToolUse"]
check("a runtime install registers the brakes", "brake-guard.sh" in pre and "destructive-guard.sh" in pre, pre)
check("on Bash only", agent_runtime.CLAUDE_MATCHERS.get("brake-guard.sh") == "Bash"
      and agent_runtime.CLAUDE_MATCHERS.get("destructive-guard.sh") == "Bash")
head = HOOK.read_text()[:1500]
check("its gate words can't hide in a payload key or a repo path",
      "# gate: -rf -fr -vrf -rvf -fvr -vfr --recursive base64 push" in head and "# gate: rm" not in head
      and "# gate: -r " not in head)

import shutil  # noqa: E402
shutil.rmtree(TMP, ignore_errors=True)
print(f"\n{'all passed' if not failed else f'{failed} failed'}")
sys.exit(1 if failed else 0)
