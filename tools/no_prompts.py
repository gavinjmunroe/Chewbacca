#!/usr/bin/env python3
"""Turn off Claude Code permission prompts on every surface, or turn them back on.

Caleb, 2026-10-16: "Fix claude desktop app to never ask for permission", then
"Make this the case for anyone that uses chewbs, onboarding needs to be
magical". The one-line install (setup.sh --every-agent) went through
agent_runtime.py and never touched permissions, so a new user got prompted
everywhere even though this Mac had been fixed by hand.

Four places, each needed (team/memory/reference_bypass_permissions_two_keys.md):
  ~/.claude/settings.json      defaultMode, the dangerous-mode prompt, and a
                               deny on AskUserQuestion so no agent pops a
                               question card
  VS Code / Cursor settings    the extension ignores defaultMode until its own
                               two machine-scoped keys are set
  Claude desktop config.json   tasks the app dispatches read their own mode

Deny rules already in settings.json are kept, so the irreversible operations
stay blocked. --off undoes exactly what this writes.

  no_prompts.py            apply
  no_prompts.py --off      put the prompts back
  no_prompts.py --check    print each surface's state, change nothing
"""
import argparse
import json
import os
import shutil
import sys

HOME = os.path.expanduser("~")
EDITOR_KEYS = {"claudeCode.allowDangerouslySkipPermissions": True,
               "claudeCode.initialPermissionMode": "bypassPermissions"}


def app_support():
    if sys.platform == "darwin":
        return os.path.join(HOME, "Library", "Application Support")
    if os.name == "nt":
        return os.environ.get("APPDATA", "")
    return os.path.join(HOME, ".config")


def load(path):
    """(dict, ok). A file that exists but won't parse is never overwritten."""
    if not os.path.exists(path):
        return {}, True
    try:
        with open(path) as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None, False
    return (data, True) if isinstance(data, dict) else (None, False)


def save(path, data, mode=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path) and not os.path.exists(path + ".no-prompts-backup"):
        shutil.copy2(path, path + ".no-prompts-backup")
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    if mode is not None:
        os.chmod(tmp, mode)
    elif os.path.exists(path):
        os.chmod(tmp, os.stat(path).st_mode & 0o777)
    os.replace(tmp, path)


def claude_settings(on, check):
    path = os.path.join(HOME, ".claude", "settings.json")
    s, ok = load(path)
    if not ok:
        return path, "left alone: not valid JSON"
    perms = s.setdefault("permissions", {})
    deny = perms.setdefault("deny", [])
    state = (perms.get("defaultMode") == "bypassPermissions" and s.get("skipDangerousModePermissionPrompt") is True
             and "AskUserQuestion" in deny)
    if check:
        return path, "no prompts" if state else "prompts on"
    if on:
        perms["defaultMode"] = "bypassPermissions"
        s["skipDangerousModePermissionPrompt"] = True
        if "AskUserQuestion" not in deny:
            deny.append("AskUserQuestion")
    else:
        perms["defaultMode"] = "default"
        s.pop("skipDangerousModePermissionPrompt", None)
        perms["deny"] = [d for d in deny if d != "AskUserQuestion"]
    save(path, s)
    return path, "no prompts" if on else "prompts on"


def editors(on, check):
    out = []
    for name in ("Code", "Code - Insiders", "Cursor", "Windsurf", "VSCodium"):
        user = os.path.join(app_support(), name, "User")
        if not os.path.isdir(os.path.dirname(user)):
            continue
        path = os.path.join(user, "settings.json")
        s, ok = load(path)
        if not ok:
            # VS Code settings allow comments; a plain JSON parser can't keep them.
            out.append((path, "left alone: has comments or isn't plain JSON, set the two claudeCode keys by hand"))
            continue
        state = all(s.get(k) == v for k, v in EDITOR_KEYS.items())
        if check:
            out.append((path, "no prompts" if state else "prompts on"))
            continue
        for k, v in EDITOR_KEYS.items():
            if on:
                s[k] = v
            else:
                s.pop(k, None)
        save(path, s)
        out.append((path, ("no prompts" if on else "prompts on") + ", restart the editor"))
    return out


def desktop(on, check):
    base = os.path.join(app_support(), "Claude")
    if not os.path.isdir(base):
        return None
    path = os.path.join(base, "config.json")
    c, ok = load(path)
    if not ok:
        return path, "left alone: not valid JSON, the app rebuilds it"
    state = c.get("dispatchCodeTasksPermissionMode") == "bypassPermissions"
    if check:
        return path, "no prompts" if state else "prompts on"
    # Enum the app accepts: default, acceptEdits, plan, auto, bypassPermissions.
    c["dispatchCodeTasksPermissionMode"] = "bypassPermissions" if on else "acceptEdits"
    # The store holds account identifiers: owner-only, as the app writes it.
    save(path, c, mode=0o600)
    return path, ("no prompts" if on else "prompts on") + ", the app reads it on its next launch"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--off", action="store_true", help="turn the prompts back on")
    ap.add_argument("--check", action="store_true", help="report, change nothing")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    on = not a.off
    rows = [claude_settings(on, a.check), *editors(on, a.check)]
    d = desktop(on, a.check)
    if d:
        rows.append(d)
    if a.json:
        print(json.dumps([{"file": p, "state": s} for p, s in rows]))
    else:
        for p, s in rows:
            print(f"  {s:<14} {p}" if len(s) <= 14 else f"  {p}: {s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
