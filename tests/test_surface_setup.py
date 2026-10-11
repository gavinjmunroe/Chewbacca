#!/usr/bin/env python3
"""The setup panel: the rest of the install, one press each, on the glass.

Hermetic. Nothing is drawn: the provider's layout and model are read as the
Kyber Lines the display would get, and checked with surface_lint. The press
runs a stand-in runner first, then the real `chewbacca welcome stack` and
`connect mcp` in a scratch HOME with nothing able to open.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "bin" / "lib"))
sys.dont_write_bytecode = True

import surface_intent  # noqa: E402
import surface_lint  # noqa: E402
from surfaces import Context, data_line, make, registry  # noqa: E402
from surfaces.apps import kinds as rail_kinds  # noqa: E402

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


STACK = {"steps": [
    {"id": "mcp", "state": "done", "say": "Already in Claude.", "tap": ""},
    {"id": "google", "state": "blocked", "say": "Google needs a sign-in app.", "tap": "Open the Google page"},
    {"id": "granola", "state": "absent", "say": "Granola isn't on this Mac.", "tap": ""},
    {"id": "engine", "state": "ready", "say": "It builds once.", "tap": "Set up the agent engine"},
    {"id": "hud", "state": "ready", "say": "Say show my agents.", "tap": "Set up the agent engine"},
    {"id": "recording", "state": "ready", "say": "Off until you turn it on. " + "x" * 200, "tap": "Turn on",
     "needs_yes": True}], "next": "google"}


def main() -> int:
    ran: list[list] = []

    def runner(argv):
        ran.append(list(argv))
        if argv[-1] == "stack":
            return 0, json.dumps(STACK), ""
        step = argv[3]
        return 0, json.dumps({"id": step, "ok": True, "say": f"{step} done.", "started": [], "blocked": None}), ""

    ctx = Context(run=runner)
    p = make("setup")
    data = p.fetch(ctx)
    model = p.model(data, None, {}, ctx)
    todo = [r["id"] for r in model["/setup/todo"]]
    done = [r["id"] for r in model["/setup/done"]]
    check("left: the ready and blocked steps, in order", todo == ["google", "engine", "hud", "recording"], todo)
    check("done has no button list and absent steps are not drawn", done == ["mcp"] and "granola" not in todo, done)
    rec = next(r for r in model["/setup/todo"] if r["id"] == "recording")
    check("the recording row says it is off and that everyone on a call has to agree",
          "Off" in rec["time"] and "agree" in rec["time"] and rec["accent"] is True, rec)
    lines = p.layout() + [data_line(k, v) for k, v in model.items()]
    walls = surface_lint.lint(lines)
    check("the panel reads at a glance (surface_lint)", walls == [], walls)

    ran.clear()
    got = p.actions["ks-connect"](ctx, data, {"row": "engine"})
    check("a press on a row runs that one connect, with no --yes", ran == [[sys.executable,
          str(ROOT / "bin" / "chewbacca-welcome"), "connect", "engine"]] and got.ok, ran)
    check("its line becomes the status", got.line == "engine done." and got.refetch, got)
    ran.clear()
    p.actions["ks-connect"](ctx, data, {"row": "recording"})
    check("the recording press is the person's yes: only that row passes --yes",
          ran and ran[0][-2:] == ["recording", "--yes"], ran)
    for row in ("mcp", "granola", "evil; rm -rf ~", ""):
        ran.clear()
        got = p.actions["ks-connect"](ctx, data, {"row": row})
        check(f"a press naming {row!r} (done, absent or not listed) runs nothing", ran == [] and not got.ok, ran)

    check("the setup panel is in the registry and on the launcher rail",
          "setup" in registry() and "setup" in rail_kinds(), rail_kinds())
    for said in ("set up chewbacca", "finish setting up chewbacca", "what's left to set up", "show me setup"):
        cmd = surface_intent.parse(said, resolve_person=lambda _n: None)
        check(f"{said!r} opens the setup panel", cmd is not None and cmd.name == "setup", cmd)
    cmd = surface_intent.parse("set up my permissions", resolve_person=lambda _n: None)
    check("'set up my permissions' still walks permissions", cmd is not None and cmd.name == "permissions", cmd)

    # The real thing, in a scratch HOME: the panel's fetch runs the real
    # stack, and a press on Chewbacca-in-my-apps registers it in Claude.
    t = Path(tempfile.mkdtemp())
    home, apps = t / "home", t / "Applications"
    (apps / "Claude.app").mkdir(parents=True)
    (home / ".local" / "bin").mkdir(parents=True)
    (home / ".local" / "bin" / "chewbacca-mcp").symlink_to(ROOT / "bin" / "chewbacca-mcp")
    recorder = t / "recorder"
    recorder.write_text(f"#!/bin/sh\necho \"$*\" >> {t / 'spawned'}\n")
    recorder.chmod(0o755)
    saved = dict(os.environ)
    os.environ.update(HOME=str(home), CHEWBACCA_APPS_DIR=str(apps), CHEWBACCA_ONBOARD_SPAWN=str(recorder),
                      CHEWBACCA_GOG=str(t / "no-gog"), CHEWBACCA_REALM_DIR=str(t / "realm"),
                      PYTHONDONTWRITEBYTECODE="1")
    try:
        real = Context()
        data = p.fetch(real)
        model = p.model(data, None, {}, real)
        check("live fetch in a scratch HOME lists Chewbacca-in-my-apps as left",
              "mcp" in [r["id"] for r in model["/setup/todo"]], model["/setup/todo"])
        got = p.actions["ks-connect"](real, data, {"row": "mcp"})
        cfg = home / "Library" / "Application Support" / "Claude" / "claude_desktop_config.json"
        check("one press registers it in Claude, no file for the person to edit",
              got.ok and cfg.exists() and "chewbacca" in json.loads(cfg.read_text())["mcpServers"], (got, cfg))
        data = p.fetch(real)
        check("and the next fetch moves it to done",
              "mcp" in [r["id"] for r in p.model(data, None, {}, real)["/setup/done"]])
    finally:
        os.environ.clear()
        os.environ.update(saved)
    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
