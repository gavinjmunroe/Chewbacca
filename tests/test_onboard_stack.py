#!/usr/bin/env python3
"""chewbacca welcome stack / connect, end to end in a scratch HOME.

A new person's Mac with Claude, Cursor, ChatGPT, Granola and Kyber installed
and none of tonight's pieces set up. Every step runs through the real CLI on
the stock macOS Python (a fresh Mac has no other), against the real kit tools
where they are local and safe (meeting-autopilot, chewbacca-mcp --register,
realm-engine install, granola-import status, chewbacca-permissions plan).
Anything that would open a browser, a Settings pane or run for minutes goes
through CHEWBACCA_ONBOARD_SPAWN, a recorder, so nothing real ever opens.
gog and launchctl are stand-ins that write down what they were asked.

What is held: stack writes nothing; recording is off on a fresh Mac and
connect refuses it without --yes; each other step is one connect with no
typing, and the stack reads done afterwards.
"""
import json
import os
import subprocess
import time
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = os.environ.get("STOCK_PYTHON") or ("/usr/bin/python3" if Path("/usr/bin/python3").exists() else sys.executable)
failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


def tree(root: Path) -> dict:
    out = {}
    for p in sorted(root.rglob("*")):
        if "Library/Caches" in str(p):  # the stock Python's bytecode cache, not ours
            continue
        try:
            out[str(p.relative_to(root))] = (p.is_dir(), p.stat().st_mtime_ns, p.stat().st_size)
        except OSError:
            pass
    return out


def main() -> int:
    t = Path(tempfile.mkdtemp())
    home, apps = t / "home", t / "Applications"
    for app in ("Claude.app", "Cursor.app", "ChatGPT.app", "Granola.app", "Kyber.app"):
        (apps / app).mkdir(parents=True)
    (home / ".local" / "bin").mkdir(parents=True)
    (home / ".local" / "bin" / "chewbacca-mcp").symlink_to(ROOT / "bin" / "chewbacca-mcp")

    spawned = t / "spawned.log"
    recorder = t / "recorder"
    recorder.write_text(f"#!/bin/sh\nprintf '%s\\n' \"$*\" >> {spawned}\n")
    gog_state = t / "gog"
    gog_state.mkdir()
    gog = t / "gog-bin"
    gog.write_text(f"""#!/bin/sh
S={gog_state}
echo "$*" >> $S/calls
case "$*" in
  "auth list --json") if [ -f $S/account ]; then echo '{{"accounts":[{{"email":"rose@example.com"}}]}}'; else echo '{{"accounts":[]}}'; fi ;;
  "auth credentials list --json") if [ -f $S/client ]; then echo '{{"clients":[{{"client":"default"}}]}}'; else echo '{{"clients":[]}}'; fi ;;
  "auth credentials set "*) cp "$4" $S/client ;;
  *) exit 2 ;;
esac
""")
    launchctl_log = t / "launchctl.log"
    launchctl = t / "launchctl"
    launchctl.write_text(f"#!/bin/sh\necho \"$*\" >> {launchctl_log}\n")
    for exe in (recorder, gog, launchctl):
        exe.chmod(0o755)
    realm = t / "realm"
    env = {**os.environ, "HOME": str(home), "CHEWBACCA_HOME": str(home / ".chewbacca"),
           "CHEWBACCA_APPS_DIR": str(apps), "CHEWBACCA_ONBOARD_SPAWN": str(recorder),
           "CHEWBACCA_GOG": str(gog), "CHEWBACCA_LAUNCHCTL": str(launchctl),
           "CHEWBACCA_REALM_DIR": str(realm), "CHEWBACCA_REALM_HOME": str(home / ".chewbacca" / "realm"),
           "PYTHONDONTWRITEBYTECODE": "1"}

    def welcome(*args):
        done = subprocess.run([PY, str(ROOT / "bin" / "chewbacca-welcome"), *args], env=env,
                              capture_output=True, text=True, timeout=120)
        try:
            return done.returncode, json.loads(done.stdout)
        except ValueError:
            return done.returncode, {"raw": done.stdout, "err": done.stderr[-500:]}

    def stack():
        code, body = welcome("stack")
        return {s["id"]: s for s in body.get("steps", [])}, body

    def spawns():
        return spawned.read_text().splitlines() if spawned.exists() else []

    # ── a fresh Mac ──────────────────────────────────────────────────────
    before = tree(home)
    steps, body = stack()
    check("stack lists all six pieces on the stock Python", sorted(steps) == sorted(
        ["mcp", "google", "granola", "engine", "hud", "recording"]), body)
    check("stack writes nothing and opens nothing", tree(home) == before and not spawns(), spawns())
    check("fresh Mac: recording is off and asks for a yes",
          steps["recording"]["state"] == "ready" and steps["recording"].get("needs_yes") is True)
    check("fresh Mac: the recording line says everyone on the call has to agree",
          "everyone has to agree" in steps["recording"]["say"])
    check("fresh Mac: Google is blocked on the missing sign-in app, and says so",
          steps["google"]["state"] == "blocked" and "sign-in app" in steps["google"]["say"])
    check("every step that needs a tap names the button", all(
        s["tap"] for s in steps.values() if s["state"] == "ready"), steps)
    check("no line asks the person to type a command", not any(
        w in s["say"] for s in steps.values() for w in ("run `", "Terminal", "type ")), steps)

    # ── recording: never without a yes ───────────────────────────────────
    flag = home / ".chewbacca" / "meeting-autopilot" / "on"
    code, got = welcome("connect", "recording")
    check("connect recording without --yes refuses and turns nothing on",
          code == 1 and got.get("blocked") and not flag.exists(), got)
    code, got = welcome("connect", "recording", "--yes")
    check("connect recording --yes turns it on through meeting-autopilot", code == 0 and flag.exists(), got)
    asked = set(got.get("permissions") or [])
    # The recorder runs detached, so a loaded Mac writes its line a moment later.
    for _ in range(50):
        guides = [s for s in spawns() if s.startswith("recording-permissions")]
        if guides or not asked:
            break
        time.sleep(0.1)
    check("it opens the Settings walk only for the recording grants still missing",
          asked <= {"microphone", "screen-recording-and-system-audio"}
          and (not asked or (len(guides) == 1 and "guide --only" in guides[0])), (asked, guides))
    steps, _ = stack()
    check("stack then reads recording as on", steps["recording"]["state"] == "done")
    status = subprocess.run([PY, str(ROOT / "bin" / "meeting-autopilot"), "status", "--json"], env=env,
                            capture_output=True, text=True, timeout=30)
    check("and the real autopilot agrees it is no longer off",
          json.loads(status.stdout or "{}").get("off") in (None, False), status.stdout)

    # ── MCP into their own apps ──────────────────────────────────────────
    code, got = welcome("connect", "mcp")
    hosts = {h["host"]: h["state"] for h in got.get("hosts") or []}
    check("connect mcp registers in Claude, Cursor and Codex with no file to edit",
          code == 0 and hosts.get("Claude Desktop") == "registered" and hosts.get("Cursor") == "registered"
          and hosts.get("Codex") == "registered", got)
    check("and says ChatGPT's own chat is reached through Codex", "Codex" in got.get("say", "")
          and hosts.get("ChatGPT chat") == "not-possible", got)
    steps, _ = stack()
    check("stack then reads mcp as done", steps["mcp"]["state"] == "done", steps["mcp"])

    # ── Granola ──────────────────────────────────────────────────────────
    code, got = welcome("connect", "granola")
    check("connect granola starts the import with the browser opened for them",
          code == 0 and any(s.startswith("granola ") and s.endswith("connect --open") for s in spawns()), spawns())

    # ── the agent engine, not built yet: builds then installs, in the background
    code, got = welcome("connect", "engine")
    check("connect engine on a Mac with no build runs build then install in the background",
          code == 0 and any(s.startswith("engine ") and " build && " in s and s.rstrip('"').endswith("install")
                            for s in spawns()) and not launchctl_log.exists(), spawns())
    # ... built: one connect loads the login agent, now
    main_js = realm / "apps" / "server" / "dist" / "main.js"
    main_js.parent.mkdir(parents=True)
    main_js.write_text("// fake\n")
    steps, _ = stack()
    check("built engine reads as one tap to start", steps["engine"]["state"] == "ready"
          and "One tap" in steps["engine"]["say"], steps["engine"])
    code, got = welcome("connect", "engine")
    agent = home / "Library" / "LaunchAgents" / "com.chewbacca.realm.plist"
    check("connect engine on a built Mac writes the login agent and loads it",
          code == 0 and agent.exists() and "bootstrap" in launchctl_log.read_text(), got)

    # ── Google ───────────────────────────────────────────────────────────
    code, got = welcome("connect", "google")
    check("no sign-in app: connect opens the Google Cloud page and says BLOCKED plainly",
          code == 1 and got.get("blocked") and any(s.startswith("google-console ") for s in spawns()), got)
    gws = home / ".config" / "gws"
    gws.mkdir(parents=True)
    (gws / "client_secret.json").write_text('{"installed":{"client_id":"x","project_id":"p"}}')
    steps, _ = stack()
    check("with the kit's other Google sign-in app on disk, Google is one tap",
          steps["google"]["state"] == "ready", steps["google"])
    code, got = welcome("connect", "google")
    calls = (gog_state / "calls").read_text()
    check("connect google hands gws's client to gog, then opens the account page",
          code == 0 and f"auth credentials set {gws / 'client_secret.json'}" in calls
          and any(s.startswith("google-signin ") and "auth manage" in s for s in spawns()), (calls, spawns()))
    (gog_state / "account").write_text("1")
    steps, _ = stack()
    check("after Allow, stack reads Google as done with the account", steps["google"]["state"] == "done"
          and "rose@example.com" in steps["google"]["say"], steps["google"])

    # ── the HUD panels ───────────────────────────────────────────────────
    check("panels: Kyber is installed, so the panels are reachable by voice",
          "show my agents" in steps["hud"]["say"], steps["hud"])

    # Nothing outside the scratch folder: every path any step wrote is under t.
    # The kit's own path is allowed: a checkout under ~/code is under the real
    # home, and every spawn names a tool in it (2026-10-13: three false reds,
    # each only the repo's own bin/ path).
    for line in spawns():
        line = line.replace(str(ROOT), "<kit>")
        if str(Path.home()) in line and str(t) not in line:
            check("a spawned command named the real home folder", False, line)
    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
