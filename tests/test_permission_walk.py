#!/usr/bin/env python3
"""`chewbacca permissions walk`: the ring on each switch, advancing on detection.

Hermetic. The pane opener, the Settings tree, the grant detector, the drag
card and the clock are all fakes; the display is a Unix socket in a temp
folder. Nothing opens System Settings, reads this Mac's TCC databases, or
draws on the real glass. PERMISSION_WALK_TRANSCRIPT=1 prints every line the
three-grant walk sent to the fake display.
"""
from __future__ import annotations

import argparse
import importlib.machinery
import importlib.util
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bin" / "lib"))
import permission_walk as pw  # noqa: E402
import surface_intent as si  # noqa: E402


def load(name: str, path: Path):
    loader = importlib.machinery.SourceFileLoader(name, str(path))
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


guide_tool = load("hud_guide", ROOT / "bin" / "hud-guide")
perms = load("chewbacca_permissions", ROOT / "bin" / "chewbacca-permissions")

failures = 0


def check(name: str, ok: bool, detail: object = "") -> None:
    global failures
    print(f"  {'ok  ' if ok else 'FAIL'} {name}" + (f": {detail}" if detail and not ok else ""))
    if not ok:
        failures += 1


# A Settings window at 700,60, 715 by 860, as the live CoreGraphics read saw
# the Microphone pane on 2026-10-10 (766,59 715x861), rounded.
WINDOW = [[700, 60], [715, 860]]


def el(id: str, role: str, x: int, y: int, w: int, h: int, **names) -> dict:
    return {"id": id, "role": role, "frame": [[x, y], [w, h]], **names}


def tree(*elements: dict, readable: bool = True) -> dict:
    return {"uiMap": {e["id"]: e for e in elements}, "windowBounds": WINDOW, "readable": readable}


def step(id: str, target: str, permission: str, app_name: str, status: str = "denied") -> dict:
    return {"id": id, "target": target, "permission": permission, "app": f"/Applications/{app_name}.app",
            "app_name": app_name, "status": status, "automates": None,
            "pane": dict(perms.PERMISSIONS)[permission][0], "why": "do the thing"}


class FakeDisplay:
    def __init__(self) -> None:
        self.lines: list[str] = []
        self.queued: list[tuple[int, dict]] = []  # (after this many takes, event)
        self.takes = 0

    def send(self, lines: list[str]) -> bool:
        self.lines += lines
        return True

    def take(self) -> list[dict]:
        self.takes += 1
        ready = [e for at, e in self.queued if at <= self.takes]
        self.queued = [(at, e) for at, e in self.queued if at > self.takes]
        return ready

    def close(self) -> None:
        pass


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0
        self.sleeps = 0

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps += 1
        self.now += seconds


class FakeCard:
    def __init__(self, log: list, step: dict) -> None:
        self.log, self.step = log, step
        log.append(("card", step["id"]))

    def stop(self) -> None:
        self.log.append(("card-stop", self.step["id"]))


def make_deps(display, clock, *, snapshots, grant_after, log):
    """grant_after: step id -> how many detector calls before it reads granted."""
    calls: dict[str, int] = {}
    current = {"id": None}

    def open_pane(url: str) -> bool:
        log.append(("open", url))
        return True

    def detect(s: dict) -> str:
        current["id"] = s["id"]
        calls[s["id"]] = calls.get(s["id"], 0) + 1
        after = grant_after.get(s["id"])
        return "granted" if after is not None and calls[s["id"]] > after else "denied"

    def snapshot():
        log.append(("look", current["id"]))
        return snapshots.get(current["id"])

    return pw.Deps(open_pane=open_pane, snapshot=snapshot, detect=detect, display=display,
                   matches=guide_tool.matches, mark_line=guide_tool.mark_line,
                   drag_card=lambda s: FakeCard(log, s), clock=clock, sleep=clock.sleep), calls


def test_anchors_match_swift() -> None:
    source = (ROOT / "mac/permission-guide/Sources/PermissionGuide/Permission.swift").read_text()
    swift = dict(re.findall(r'id: "([a-z-]+)".*?anchor: "(Privacy_[A-Za-z]+)"', source, re.S))
    check("the walk opens the same Privacy anchors as the Swift card", swift == pw.ANCHORS, (swift, pw.ANCHORS))
    check("and covers every permission the CLI knows", set(pw.ANCHORS) == set(perms.PERMISSIONS))
    check("the pane URL is the Ventura extension form",
          pw.pane_url("microphone") == "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension"
          "?Privacy_Microphone")


def test_order() -> None:
    steps = [step("runtime.full-disk-access", "runtime", "full-disk-access", "Chewbacca"),
             step("kyber.microphone", "kyber", "microphone", "Kyber"),
             step("kyber.accessibility", "kyber", "accessibility", "Kyber"),
             step("host.full-disk-access", "host", "full-disk-access", "Code")]
    got = [s["id"] for s in pw.ordered(steps)]
    check("full disk access first, then Kyber's grants, runtime last",
          got == ["host.full-disk-access", "kyber.accessibility", "kyber.microphone", "runtime.full-disk-access"], got)


def test_find_spot() -> None:
    m = guide_tool.matches
    beside = tree(el("e1", "AXStaticText", 960, 300, 60, 20, value="Kyber"),
                  el("e2", "AXSwitch", 1360, 298, 38, 24, state=0),
                  el("e3", "AXStaticText", 960, 340, 60, 20, value="Zoom"),
                  el("e4", "AXSwitch", 1360, 338, 38, 24, state=1))
    spot = pw.find_spot(beside, "Kyber", m)
    check("the switch on the app's own row, not the one below it",
          spot is not None and spot.kind == "switch" and spot.frame == [1360, 298, 38, 24] and spot.state == 0, spot)
    labelled = tree(el("e1", "AXCheckBox", 1360, 298, 38, 24, label="Kyber"))
    spot = pw.find_spot(labelled, "Kyber", m)
    check("a switch named for the app is the switch", spot is not None and spot.kind == "switch", spot)
    row = tree(el("e1", "AXStaticText", 960, 300, 60, 20, value="Kyber"))
    spot = pw.find_spot(row, "Kyber", m)
    check("a row with no switch rings the row", spot is not None and spot.kind == "row", spot)
    absent = tree(el("e3", "AXStaticText", 960, 340, 60, 20, value="Zoom"),
                  el("e4", "AXSwitch", 1360, 338, 38, 24))
    spot = pw.find_spot(absent, "Kyber", m)
    check("a readable list without the app is absent, ringed on the list area",
          spot is not None and spot.kind == "absent" and spot.frame == [930, 112, 477, 798], spot)
    near = tree(el("e3", "AXStaticText", 960, 340, 60, 20, value="Kiber"),
                el("e4", "AXSwitch", 1360, 338, 38, 24))
    spot = pw.find_spot(near, "Kyber", m)
    check("a near-miss name never gets the ring", spot is not None and spot.kind == "absent", spot)
    # The live shape on 2026-10-10: the window answered with no controls.
    blind = {"uiMap": {}, "windowBounds": WINDOW, "readable": False}
    spot = pw.find_spot(blind, "Kyber", m)
    check("an unreadable tree still rings the list area of the window",
          spot is not None and spot.kind == "list" and spot.frame == [930, 112, 477, 798], spot)
    check("no window and no tree is no ring", pw.find_spot({"uiMap": {}}, "Kyber", m) is None)


def test_three_grant_walk() -> list[str]:
    display, clock, log = FakeDisplay(), FakeClock(), []
    steps = [step("kyber.microphone", "kyber", "microphone", "Kyber"),
             step("kyber.accessibility", "kyber", "accessibility", "Kyber"),
             step("host.full-disk-access", "host", "full-disk-access", "Code")]
    snapshots = {
        "host.full-disk-access": tree(el("e1", "AXStaticText", 960, 300, 60, 20, value="Code"),
                                      el("e2", "AXSwitch", 1360, 298, 38, 24, state=0)),
        "kyber.accessibility": tree(el("e3", "AXStaticText", 960, 340, 60, 20, value="Zoom"),
                                    el("e4", "AXSwitch", 1360, 338, 38, 24, state=1)),
        "kyber.microphone": {"uiMap": {}, "windowBounds": WINDOW, "readable": False},
    }
    deps, calls = make_deps(display, clock, snapshots=snapshots,
                            grant_after={"host.full-disk-access": 2, "kyber.accessibility": 4,
                                         "kyber.microphone": 3}, log=log)
    results = pw.Walk(steps, deps, already_on=[step("kyber.screen", "kyber",
                                                    "screen-recording-and-system-audio", "Kyber", "granted")]).run()
    opened = [entry[1].rsplit("?", 1)[1] for entry in log if entry[0] == "open"]
    check("three panes opened, most useful first",
          opened == ["Privacy_AllFiles", "Privacy_Accessibility", "Privacy_Microphone"], opened)
    check("every step advanced the moment its grant was detected",
          [r.outcome for r in results] == ["on", "on", "on"]
          and calls == {"host.full-disk-access": 3, "kyber.accessibility": 5, "kyber.microphone": 4}, (results, calls))
    marks = [line for line in display.lines if line.startswith("m guide")]
    check("the ring lands on Code's switch with words",
          marks[0] == 'm guide 1360 298 38 24 label="Turn on Code" tone=guide life=0', marks)
    check("Kyber missing from Accessibility gets the drag words on the list",
          marks[1] == 'm guide 930 112 477 798 label="Drag Kyber into this list" tone=guide life=0', marks)
    check("an unreadable Microphone pane still rings where Kyber will be",
          marks[2] == 'm guide 930 112 477 798 label="Find Kyber here and turn it on" tone=guide life=0', marks)
    check("the ring comes down after every step", display.lines.count("u guide") == 3)
    check("the drag card shows for the drag pane only, and is put away on grant",
          [e for e in log if e[0].startswith("card")] == [("card", "kyber.accessibility"),
                                                          ("card-stop", "kyber.accessibility")], log)
    check("each step's panel has Skip and Stop",
          display.lines.count('c skip Button label="Skip" action=perm-skip') >= 3
          and display.lines.count('c stop Button label="Stop" action=perm-stop') >= 3)
    toast = [line for line in display.lines if line.startswith("c t Text")][-1]
    check("it ends on an all-set toast listing what's on",
          '@ perm-done at=top w=420 life=8' in display.lines and 'c s Screen title="ALL SET"' in display.lines
          and "Full Disk Access for Code" in toast and "Accessibility for Kyber" in toast
          and "Microphone for Kyber" in toast and "Screen & System Audio Recording for Kyber" in toast, toast)
    check("the walk panel is taken down before the toast", "- perm-walk" in display.lines)
    check("polls were capped by the grants, not run forever", clock.sleeps <= 12, clock.sleeps)
    return display.lines


def test_skip_and_stop() -> None:
    display, clock, log = FakeDisplay(), FakeClock(), []
    steps = [step("kyber.accessibility", "kyber", "accessibility", "Kyber"),
             step("kyber.microphone", "kyber", "microphone", "Kyber"),
             step("runtime.full-disk-access", "runtime", "full-disk-access", "Chewbacca")]
    display.queued = [(2, {"name": "perm-skip", "component": "skip"}),
                      (4, {"name": "hit", "component": "guide"}),
                      (5, {"name": "perm-stop", "component": "stop"})]
    deps, _ = make_deps(display, clock, snapshots={}, grant_after={}, log=log)
    results = pw.Walk(steps, deps).run()
    check("Skip moves on, Stop ends the walk and leaves the rest untouched",
          [r.outcome for r in results] == ["skipped", "stopped", "stopped"], [r.outcome for r in results])
    check("a stopped walk never opens the panes it did not reach",
          [e for e in log if e[0] == "open"].__len__() == 2, log)
    check("and says what is still off",
          'c s Screen title="PERMISSIONS"' in display.lines
          and any("Still off: Accessibility for Kyber" in line for line in display.lines))


def test_timeout_and_unknown() -> None:
    display, clock, log = FakeDisplay(), FakeClock(), []
    blind = step("kyber.accessibility", "kyber", "accessibility", "Kyber", status="unknown")
    deps, calls = make_deps(display, clock, snapshots={}, grant_after={}, log=log)
    results = pw.Walk([blind], deps, timeout_s=30).run()
    check("a grant that never lands times out at the cap",
          results[0].outcome == "timed out" and 30 <= clock.now <= 32 and calls[blind["id"]] <= 32,
          (results[0].outcome, clock.now))
    check("a Mac that can't tell says to press Skip",
          any("press Skip once it is" in line for line in display.lines))

    display, clock, log = FakeDisplay(), FakeClock(), []
    display.queued = [(1, {"name": "perm-skip", "component": "skip"}),
                      (3, {"name": "perm-skip", "component": "skip"})]
    deps, _ = make_deps(display, clock, snapshots={}, grant_after={}, log=log)
    results = pw.Walk([blind], deps).run()
    check("a stale Skip from before the step is dropped, and Skip on a blind step is unconfirmed, not off",
          results[0].outcome == "unconfirmed" and display.takes >= 3
          and any("This Mac can't confirm: Accessibility for Kyber" in line for line in display.lines)
          and not any("Still off" in line for line in display.lines), (results[0].outcome, display.lines[-3:]))


def test_ring_returns_after_a_press() -> None:
    display, clock, log = FakeDisplay(), FakeClock(), []
    one = step("kyber.accessibility", "kyber", "accessibility", "Kyber")
    snap = tree(el("e1", "AXStaticText", 960, 300, 60, 20, value="Kyber"),
                el("e2", "AXSwitch", 1360, 298, 38, 24, state=0))
    # The person presses the ring (the display takes it down) and misses the
    # switch; the grant lands a few polls later.
    display.queued = [(3, {"name": "hit", "component": "guide"})]
    deps, _ = make_deps(display, clock, snapshots={"kyber.accessibility": snap},
                        grant_after={"kyber.accessibility": 5}, log=log)
    pw.Walk([one], deps).run()
    marks = [line for line in display.lines if line.startswith("m guide")]
    check("a press on the ring that missed puts the ring back", len(marks) == 2 and marks[0] == marks[1], marks)


def test_app_missing_and_automation_prompt() -> None:
    display, clock, log = FakeDisplay(), FakeClock(), []
    gone = step("kyber.accessibility", "kyber", "accessibility", "Kyber", status="app-missing")
    auto = {**step("host.automation.messages", "host", "automation", "Code", status="not-asked"),
            "automates": "com.apple.MobileSMS", "pane": "Automation > Messages"}
    deps, _ = make_deps(display, clock, snapshots={}, grant_after={}, log=log)
    deps.prompt_automation = lambda s: True
    results = pw.Walk([gone, auto], deps).run()
    check("an app that isn't installed is skipped and an automation prompt needs no pane",
          [r.outcome for r in results] == ["not installed", "on"] and not [e for e in log if e[0] == "open"],
          (results, log))


def test_hud_display_socket() -> None:
    with tempfile.TemporaryDirectory(dir="/tmp") as tmp:
        path = Path(tmp) / "hud.sock"
        (Path(tmp) / "hud.token").write_text("a" * 64)
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        server.bind(str(path))
        server.listen(1)
        got: list[str] = []

        def serve() -> None:
            conn, _ = server.accept()
            conn.settimeout(3)
            data = b""
            while b"\n" not in data:
                data += conn.recv(4096)
            got.append(data.decode().split("\n")[0])
            conn.sendall(b'v! "kyber/1"\ne perm-skip skip surface="perm-walk"\ne action reply row="x" '
                         b'surface="messages"\ne hit guide label="Turn on Kyber"\n')
            time.sleep(0.3)
            conn.close()

        thread = threading.Thread(target=serve, daemon=True)
        thread.start()
        display = pw.HudDisplay(str(path))
        opened = display.open()
        thread.join(3)
        time.sleep(0.2)
        events = display.take()
        display.close()
        server.close()
        check("the walk subscribes with the display's token", opened and got == ["listen token=" + "a" * 64], got)
        check("and hears its own Skip and the ring's hit, nothing else",
              [(e["name"], e["component"]) for e in events] == [("perm-skip", "skip"), ("hit", "guide")], events)


def test_cli_walk_paths() -> None:
    args = argparse.Namespace(only=None, host_app=None, for_="chewbacca", timeout=600)
    granted = {"host": {"app": "/A.app", "detected_by": "flag"}, "missing": [],
               "needs": [step("kyber.accessibility", "kyber", "accessibility", "Kyber", "granted")]}
    missing = {"host": {"app": "/A.app", "detected_by": "flag"}, "missing": ["kyber.accessibility"],
               "needs": [step("kyber.accessibility", "kyber", "accessibility", "Kyber")]}
    original_plan, original_guide = perms.plan, perms.guide
    fell_back: list[argparse.Namespace] = []
    try:
        perms.plan = lambda host, which="chewbacca": granted
        check("nothing missing means nothing opens", perms.walk(args) == 0)
        perms.plan = lambda host, which="chewbacca": missing
        perms.guide = lambda a: fell_back.append(a) or 0
        with tempfile.TemporaryDirectory(dir="/tmp") as tmp:
            os.environ["BOB_HUD_SOCKET"] = str(Path(tmp) / "nobody.sock")
            code = perms.walk(args)
        check("without Kyber running it falls back to the cards", code == 0 and len(fell_back) == 1
              and fell_back[0].include_granted is False)
    finally:
        perms.plan, perms.guide = original_plan, original_guide
        os.environ.pop("BOB_HUD_SOCKET", None)
    bad = argparse.Namespace(only="nonsense", host_app=None, for_="chewbacca", timeout=600)
    check("--only refuses a permission it doesn't know", perms.walk(bad) == 2)


def test_never_toggles() -> None:
    sources = (ROOT / "bin/lib/permission_walk.py").read_text()
    cli = (ROOT / "bin/chewbacca-permissions").read_text()
    walk_src = cli[cli.index("def walk("):cli.index("def _load_hud_guide")]
    check("the walk never runs tccutil", "tccutil" not in walk_src and "tccutil" not in sources.split('"""', 2)[2])
    check("and never presses: no AXPress, click or mouse event anywhere in it",
          not re.search(r"AXPress|kAXPressAction|CGEvent|click\(|peekaboo click|osascript", sources + walk_src))
    swift = (ROOT / "mac/permission-guide/Sources/PermissionGuide/AXSnapshot.swift").read_text()
    check("the tree reader only reads", "AXUIElementPerformAction" not in swift
          and "AXUIElementSetAttributeValue" not in swift)


def test_voice_phrase() -> None:
    for said in ("Set up my permissions", "fix my permissions", "Kyber, fix my mac permissions please",
                 "walk me through my permissions"):
        command = si.parse(said)
        check(f'"{said}" starts the walk', command is not None and (command.verb, command.name) == ("walk", "permissions"),
              command)
    for said in ("show my permissions settings", "fix my permissions and text Sam", "what are permissions"):
        check(f'"{said}" still goes to the model', si.parse(said) is None, si.parse(said))
    spawned: list[list[str]] = []

    def spawn(argv, **kwargs):
        spawned.append(argv)
        check("the walk is detached from the voice request", kwargs.get("start_new_session") is True)

    with tempfile.TemporaryDirectory(dir="/tmp") as tmp:
        si.WALK_LOG = Path(tmp) / "perm-walk.log"
        outcome = si.perform(si.Command("walk", "permissions"), spawn=spawn)
    check("and the voice answers in one line while it runs",
          outcome.ok and outcome.line == "Opening Settings. Follow the ring."
          and spawned == [[str(ROOT / "bin" / "chewbacca-permissions"), "walk"]], (outcome, spawned))


def test_hud_guide_peekaboo3() -> None:
    """peekaboo 3 refuses --timeout; hud-guide retries with --timeout-seconds."""
    with tempfile.TemporaryDirectory(dir="/tmp") as tmp:
        root = Path(tmp)
        fake = root / "bin" / "peekaboo"
        fake.parent.mkdir()
        payload = {"success": True, "data": {"application_name": "System Settings", "window_title": "Microphone",
                                             "ui_elements": [{"id": "elem_1", "ax_role": "AXSwitch",
                                                              "bounds": [[1360, 298], [38, 24]], "label": "Kyber",
                                                              "is_actionable": True}]}}
        fake.write_text("#!/bin/sh\n"
                        'for a in "$@"; do [ "$a" = "--timeout" ] && { echo "Error: Unknown option --timeout"; '
                        "exit 64; }; done\n"
                        f"echo '{json.dumps(payload)}'\n")
        fake.chmod(0o755)
        env = {**os.environ, "PATH": f"{fake.parent}:{os.environ['PATH']}", "BOB_DIR": str(root / "bob")}
        env.pop("HUD_GUIDE_SNAPSHOT", None)
        done = subprocess.run([sys.executable, str(ROOT / "bin" / "hud-guide"), "--app", "System Settings",
                               "--json", "find", "Kyber"], capture_output=True, text=True, env=env, timeout=30)
        found = json.loads(done.stdout or "[]") if done.returncode == 0 else []
        check("hud-guide reads the screen with peekaboo 3's --timeout-seconds",
              done.returncode == 0 and found and found[0]["frame"] == [1360, 298, 38, 24], done.stderr or done.stdout)


def main() -> int:
    print("permission walk")
    test_anchors_match_swift()
    test_order()
    test_find_spot()
    lines = test_three_grant_walk()
    test_skip_and_stop()
    test_timeout_and_unknown()
    test_app_missing_and_automation_prompt()
    test_ring_returns_after_a_press()
    test_hud_display_socket()
    test_cli_walk_paths()
    test_never_toggles()
    test_voice_phrase()
    test_hud_guide_peekaboo3()
    if os.environ.get("PERMISSION_WALK_TRANSCRIPT"):
        print("\n".join(lines))
    print(f"{'FAILED ' + str(failures) if failures else 'all passed'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
