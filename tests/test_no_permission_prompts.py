#!/usr/bin/env python3
"""Nothing prompts once bypass is chosen (feedback_no_permission_prompts).

Caleb, 2026-10-04, three times in an hour: "Fix vscode, you shouldn't be
asking for permission to do anything", "you just asked for permission
again...", "Bro fix vscode/chewb, you keep asking for permission when you
shouldn't be". Three places have to agree for that to hold: the CLI's
permissions.defaultMode, the editor extension's own gate, and one mcp__<server>
allow rule per MCP server. The third was fixed by hand on one Mac on 10-04 and
nothing put it in the installer until 2026-10-11.

Runs setup.sh's settings block under a temp HOME, the way test_setup_hooks.py
does, never setup.sh itself.
"""
import json
import os
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tests"))
from test_setup_hooks import settings_block  # noqa: E402

fails = 0


def check(name, cond, detail=""):
    global fails
    print(f"  {'pass' if cond else 'FAIL'}  {name}" + ("" if cond else f"  {detail}"))
    fails += not cond


with tempfile.TemporaryDirectory() as tmp:
    home = pathlib.Path(tmp)
    (home / ".claude").mkdir()
    (home / ".claude.json").write_text(json.dumps({"mcpServers": {"blender": {}, "togari": {}}}))
    (home / ".claude" / ".mcp.json").write_text(json.dumps({"mcpServers": {"watch-skill": {}}}))
    env = {"HOME": str(home), "PATH": os.environ.get("PATH", ""),
           "D1_HOOKS": str(home / ".claude" / "hooks"), "D1_SESSION_OPENER": "none",
           "D1_BYPASS_PERMS": "yes"}
    block = settings_block()
    for _ in range(2):  # chewbacca update re-runs setup; rules must not duplicate
        r = subprocess.run([sys.executable, "-c", block], env=env, capture_output=True, text=True)
        check("the settings block runs", r.returncode == 0, r.stderr[-400:])
    perms = json.loads((home / ".claude" / "settings.json").read_text())["permissions"]
    check("bypass sets defaultMode", perms.get("defaultMode") == "bypassPermissions", perms.get("defaultMode"))
    # 2026-10-16: no agent stops to pop a question card, and no dangerous-mode prompt.
    check("bypass denies AskUserQuestion once", perms["deny"].count("AskUserQuestion") == 1, perms["deny"])
    check("bypass skips the dangerous-mode prompt",
          json.loads((home / ".claude" / "settings.json").read_text()).get("skipDangerousModePermissionPrompt") is True)
    for name in ("blender", "togari", "watch-skill"):
        check(f"mcp__{name} is allowed", perms["allow"].count(f"mcp__{name}") == 1, perms["allow"])

    home2 = pathlib.Path(tmp) / "nobypass"
    (home2 / ".claude").mkdir(parents=True)
    (home2 / ".claude.json").write_text(json.dumps({"mcpServers": {"blender": {}}}))
    env2 = dict(env, HOME=str(home2), D1_HOOKS=str(home2 / ".claude" / "hooks"), D1_BYPASS_PERMS="no")
    subprocess.run([sys.executable, "-c", block], env=env2, capture_output=True, text=True)
    perms2 = json.loads((home2 / ".claude" / "settings.json").read_text())["permissions"]
    check("without bypass no MCP server is pre-allowed", "mcp__blender" not in perms2["allow"], perms2["allow"])

editor = json.loads((ROOT / "config/settings/vscode-settings.json").read_text())
check("the editor extension honors bypass", editor.get("claudeCode.allowDangerouslySkipPermissions") is True)
check("the editor starts in bypass", editor.get("claudeCode.initialPermissionMode") == "bypassPermissions")
print(f"\n{'FAILED' if fails else 'ok'}  {fails} failure(s)")
sys.exit(1 if fails else 0)
