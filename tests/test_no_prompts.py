"""tools/no_prompts.py turns permission prompts off on every surface and back on.

Hermetic: a scratch HOME with a fake ~/.claude, VS Code, Cursor and Claude
desktop store. Caleb, 2026-10-16: "Make this the case for anyone that uses
chewbs, onboarding needs to be magical".
"""
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOL = os.path.join(ROOT, "tools", "no_prompts.py")
checks = 0


def ok(cond, msg):
    global checks
    assert cond, msg
    checks += 1


def run(home, *args):
    env = dict(os.environ, HOME=home)
    p = subprocess.run([sys.executable, "-I", TOOL, "--json", *args], capture_output=True, text=True, env=env, timeout=30)
    ok(p.returncode == 0, p.stderr)
    return {r["file"]: r["state"] for r in json.loads(p.stdout)}


def read(p):
    with open(p) as f:
        return json.load(f)


def main():
    home = tempfile.mkdtemp()
    sup = os.path.join(home, "Library", "Application Support") if sys.platform == "darwin" else os.path.join(home, ".config")
    claude = os.path.join(home, ".claude", "settings.json")
    os.makedirs(os.path.dirname(claude))
    deny = ["Bash(rm -rf /)", "Read(./.env)"]
    with open(claude, "w") as f:
        json.dump({"permissions": {"deny": list(deny), "allow": ["Bash(ls:*)"]}, "hooks": {"Stop": []}}, f)
    vscode = os.path.join(sup, "Code", "User", "settings.json")
    os.makedirs(os.path.dirname(vscode))
    with open(vscode, "w") as f:
        json.dump({"editor.fontSize": 14}, f)
    cursor = os.path.join(sup, "Cursor", "User", "settings.json")
    os.makedirs(os.path.dirname(cursor))
    with open(cursor, "w") as f:
        f.write('{\n  // a comment the user wrote\n  "editor.tabSize": 2\n}\n')
    desk = os.path.join(sup, "Claude", "config.json")
    os.makedirs(os.path.dirname(desk))
    with open(desk, "w") as f:
        json.dump({"dispatchCodeTasksPermissionMode": "acceptEdits", "account": "x"}, f)

    before = run(home, "--check")
    ok(before[claude] == "prompts on" and before[vscode] == "prompts on" and before[desk] == "prompts on", before)
    ok(read(claude) == {"permissions": {"deny": deny, "allow": ["Bash(ls:*)"]}, "hooks": {"Stop": []}}, "--check changes nothing")

    after = run(home)
    s = read(claude)
    ok(s["permissions"]["defaultMode"] == "bypassPermissions" and s["skipDangerousModePermissionPrompt"] is True, s)
    ok(s["permissions"]["deny"] == deny + ["AskUserQuestion"], "existing deny rules kept, AskUserQuestion added")
    ok(s["hooks"] == {"Stop": []} and s["permissions"]["allow"] == ["Bash(ls:*)"], "unrelated settings untouched")
    v = read(vscode)
    ok(v["claudeCode.allowDangerouslySkipPermissions"] is True and v["claudeCode.initialPermissionMode"] == "bypassPermissions"
       and v["editor.fontSize"] == 14, v)
    ok("left alone" in after[cursor] and "a comment the user wrote" in open(cursor).read(), "a commented editor file is never rewritten")
    d = read(desk)
    ok(d["dispatchCodeTasksPermissionMode"] == "bypassPermissions" and d["account"] == "x", d)
    ok(oct(os.stat(desk).st_mode & 0o777) == "0o600", "the desktop store stays owner-only")
    ok(os.path.exists(claude + ".no-prompts-backup"), "a backup of the first version is kept")

    run(home)
    ok(read(claude)["permissions"]["deny"].count("AskUserQuestion") == 1, "running twice adds nothing twice")
    ok(run(home, "--check")[claude] == "no prompts", "check reads the new state")

    run(home, "--off")
    s = read(claude)
    ok(s["permissions"]["defaultMode"] == "default" and "skipDangerousModePermissionPrompt" not in s
       and s["permissions"]["deny"] == deny, ("--off undoes exactly what it wrote", s))
    ok("claudeCode.initialPermissionMode" not in read(vscode), "--off clears the editor keys")
    ok(read(desk)["dispatchCodeTasksPermissionMode"] == "acceptEdits", "--off resets dispatched tasks")

    bad = tempfile.mkdtemp()
    os.makedirs(os.path.join(bad, ".claude"))
    with open(os.path.join(bad, ".claude", "settings.json"), "w") as f:
        f.write("{not json")
    r = run(bad)
    ok("left alone" in r[os.path.join(bad, ".claude", "settings.json")], "a broken settings.json is never overwritten")
    print(f"no-prompts: {checks} checks passed")


if __name__ == "__main__":
    main()
