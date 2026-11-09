"""The permission walkthrough on the glass: `chewbacca permissions walk`.

Codex's computer use points at the switch it needs; this does the same over
System Settings. For each grant `chewbacca-permissions plan` says is missing,
most useful first, it opens the exact Privacy pane, reads the pane's
accessibility tree, and puts Kyber's guide ring and a one-line bubble on the
app's switch ("Turn on Kyber"). The moment the grant is detected it moves to
the next one, and it ends with a toast naming what is on.

When the app is not in the list yet, which on a drag pane means nobody has
added it, the Anarlog card from mac/permission-guide floats over Settings with
the app to drag in (team memory feedback_onboarding_like_anarlog). When the
tree cannot be read at all, the ring goes on the list area of the window, so
the person is still looking at the right place.

Hands stay the person's. Nothing here clicks, toggles, drags or resets a
grant, and nothing runs tccutil: `tccutil reset` revokes grants that work
(team memory feedback_tccutil_reset_is_destructive). Every step has Skip and
Stop on the glass.

Everything that touches the Mac comes in through `Deps`, so the tests drive
a whole walk with a fake pane opener, a fake tree and a fake detector.
"""
from __future__ import annotations

import json
import socket
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Protocol

import hud_events

# Same anchors as mac/permission-guide/.../Permission.swift; the walk's test
# fails if the two ever disagree.
ANCHORS = {
    "accessibility": "Privacy_Accessibility",
    "screen-recording-and-system-audio": "Privacy_ScreenCapture",
    "microphone": "Privacy_Microphone",
    "full-disk-access": "Privacy_AllFiles",
    "calendars": "Privacy_Calendars",
    "contacts": "Privacy_Contacts",
    "automation": "Privacy_Automation",
}
# Panes with a + button, where an app that never asked has to be added by
# hand, so the drag card is worth showing. The others only list apps that
# already asked macOS (Permission.swift, CardMode).
DRAG_PANES = {"accessibility", "screen-recording-and-system-audio", "full-disk-access"}

# What each grant unlocks, which is the order the walk takes them in. Lower
# goes first. The reasons are the ranking rule, said out loud:
UNLOCK_RANK = {
    # Both TCC databases open only with it, so once it is on every later step
    # is detected the moment its switch flips, instead of waiting for Skip.
    "host.full-disk-access": 0,
    # Kyber reads and drives other apps with it; it is also what lets the
    # display answer a press on the guide ring itself.
    "kyber.accessibility": 1,
    # Kyber seeing the screen is what every on-screen answer starts from.
    "kyber.screen-recording-and-system-audio": 2,
    "kyber.microphone": 3,
    # Meeting capture: without screen and system audio a call records only
    # your own side, the one people miss (chewbacca-permissions CAPTURE_NEEDS).
    "host.screen-recording-and-system-audio": 4,
    "host.microphone": 5,
    "host.automation.messages": 6,
    "runtime.full-disk-access": 7,
}

SURFACE = "perm-walk"
DONE_SURFACE = "perm-done"
# Seconds between grant checks. A grant lands in TCC within half a second of
# the switch (mac/permission-guide Session.swift probeInterval), so one second
# keeps "the moment it's on" honest without a sqlite open every frame.
# Guessed, never measured.
POLL_S = 1.0
# Seconds between tree reads. The ring follows the row if the list scrolls or
# the app appears after a drag; a read costs a helper launch, so not every
# poll. Guessed, never measured.
LOCATE_EVERY_S = 3.0
# Per step. Matches the card's own default in mac/permission-guide: long
# enough to find + and type a password, short enough that a forgotten walk
# does not sit over Settings all day.
STEP_TIMEOUT_S = 600.0
# The toast at the end closes itself after this many seconds.
TOAST_LIFE_S = 8
# System Settings' sidebar is a fixed 220 points on Ventura through Sequoia
# (Anarlog's layout.rs, mac/permission-guide Geometry.sidebarWidth); the title
# strip above the list is about 52. Used only when the tree is unreadable.
SIDEBAR_W = 220
TITLE_H = 52
SWITCH_ROLES = {"AXSwitch", "AXCheckBox", "AXToggle"}
NAME_ROLES = {"AXStaticText", "AXCell", "AXRow", "AXGroup", "AXImage", "AXButton"} | SWITCH_ROLES


def pane_url(permission: str) -> str:
    return f"x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?{ANCHORS[permission]}"


def ordered(steps: list[dict]) -> list[dict]:
    """Most useful first; anything unranked keeps the plan's own order, last."""
    position = {id(step): index for index, step in enumerate(steps)}
    return sorted(steps, key=lambda s: (UNLOCK_RANK.get(s["id"], 100), position[id(s)]))


@dataclass
class Spot:
    """Where on the screen the step lives, in top-left global points."""

    kind: str          # switch, row, absent (read the list, app not in it), list (could not read it)
    frame: list[int]
    state: int | None = None  # a switch's 0 or 1, when the tree said

    def key(self) -> tuple:
        return (self.kind, tuple(self.frame))


def _rect(value) -> tuple[float, float, float, float] | None:
    try:
        if isinstance(value, dict):
            return (float(value["x"]), float(value["y"]), float(value["width"]), float(value["height"]))
        (x, y), (w, h) = value
        return (float(x), float(y), float(w), float(h))
    except (TypeError, ValueError, KeyError):
        return None


def list_area(window: tuple[float, float, float, float]) -> list[int]:
    x, y, w, h = window
    return [round(x + SIDEBAR_W + 10), round(y + TITLE_H), round(max(w - SIDEBAR_W - 18, 40)),
            round(max(h - TITLE_H - 10, 40))]


def find_spot(snapshot: dict | None, app_name: str, matches: Callable[[list[dict], str], list]) -> Spot | None:
    """The app's switch, else its row, else the list it belongs in.

    `matches` is hud-guide's own name matcher, so "Kyber" finds the row the
    way `hud-guide find Kyber` would. Only a match that contains the whole
    name counts (score 2 and up): a fuzzy near miss on a privacy list is a
    different app, and a ring on the wrong app's switch is worse than none.
    """
    if not snapshot:
        return None
    window = _rect(snapshot.get("windowBounds"))
    elements = snapshot.get("uiMap") or {}
    if isinstance(elements, dict):
        elements = list(elements.values())
    named: list[dict] = []
    switches: list[dict] = []
    for element in elements:
        if not isinstance(element, dict):
            continue
        frame = _rect(element.get("frame"))
        role = str(element.get("role") or "")
        if frame is None or frame[2] < 4 or frame[3] < 4:
            continue
        entry = {"id": str(element.get("id") or ""), "role": role, "frame": [round(v) for v in frame],
                 "state": element.get("state")}
        if role in SWITCH_ROLES:
            switches.append(entry)
        name = next((str(element[k]).strip() for k in ("label", "title", "value")
                     if isinstance(element.get(k), str) and str(element[k]).strip()), "")
        if name and role in NAME_ROLES:
            named.append({**entry, "name": name[:80]})
    hits = [control for score, control in matches(named, app_name) if score >= 2.0]
    for hit in hits:
        if hit["role"] in SWITCH_ROLES:
            return Spot("switch", hit["frame"], hit.get("state"))
    for hit in hits:
        x, y, w, h = hit["frame"]
        centre = y + h / 2
        beside = [s for s in switches
                  if abs((s["frame"][1] + s["frame"][3] / 2) - centre) <= max(h, s["frame"][3]) * 0.75
                  and s["frame"][0] > x]
        if beside:
            nearest = min(beside, key=lambda s: s["frame"][0] - x)
            return Spot("switch", nearest["frame"], nearest.get("state"))
    if hits:
        return Spot("row", hits[0]["frame"])
    if window is None:
        return None
    if snapshot.get("readable") and elements:
        return Spot("absent", list_area(window))
    return Spot("list", list_area(window))


def bubble_words(step: dict, spot: Spot) -> str:
    app = step.get("app_name") or "the app"
    if spot.kind in ("switch", "row"):
        return f"Turn on {app}"
    if spot.kind == "absent" and step["permission"] in DRAG_PANES:
        return f"Drag {app} into this list"
    if spot.kind == "absent":
        return f"{app} shows up here once it asks"
    return f"Find {app} here and turn it on"


def step_text(step: dict, spot: Spot | None, detectable: bool) -> str:
    app = step.get("app_name") or "the app"
    pane = step["pane"]
    lines = [f"Turn on {app} in {pane}, so it can {step['why']}."]
    if spot is not None and spot.kind == "absent" and step["permission"] in DRAG_PANES:
        lines.append(f"{app} isn't in the list yet. Drag it in from the card.")
    elif spot is not None and spot.kind == "absent" and step["permission"] == "microphone":
        if step["target"] == "kyber":
            lines.append(f"{app} shows up after it asks once: hold the globe key, then switch it on.")
        else:
            lines.append(f"{app} shows up after it asks once: run room-capture start in it.")
    if not detectable:
        lines.append("This Mac won't say when it's on, so press Skip once it is.")
    return " ".join(lines)


class Display(Protocol):
    def send(self, lines: list[str]) -> bool: ...
    def take(self) -> list[dict]: ...
    def close(self) -> None: ...


class CardHandle(Protocol):
    def stop(self) -> None: ...


@dataclass
class Deps:
    open_pane: Callable[[str], bool]
    snapshot: Callable[[], dict | None]
    detect: Callable[[dict], str]
    display: Display
    matches: Callable[[list[dict], str], list]
    mark_line: Callable[[list[int], str, int], str]
    drag_card: Callable[[dict], CardHandle | None] = lambda step: None
    prompt_automation: Callable[[dict], bool] = lambda step: False
    clock: Callable[[], float] = time.monotonic
    sleep: Callable[[float], None] = time.sleep
    log: Callable[[str], None] = lambda line: None


@dataclass
class Result:
    step: dict
    outcome: str  # on, skipped, unconfirmed, timed out, stopped, not installed, settings would not open, no app


@dataclass
class Walk:
    steps: list[dict]
    deps: Deps
    poll_s: float = POLL_S
    locate_every_s: float = LOCATE_EVERY_S
    timeout_s: float = STEP_TIMEOUT_S
    already_on: list[dict] = field(default_factory=list)
    results: list[Result] = field(default_factory=list)

    def run(self) -> list[Result]:
        steps = ordered(self.steps)
        stopped = False
        for number, step in enumerate(steps, 1):
            if stopped:
                self.results.append(Result(step, "stopped"))
                continue
            outcome = self.one(step, number, len(steps))
            self.results.append(Result(step, outcome))
            stopped = outcome == "stopped"
        self.finish()
        return self.results

    def panel(self, step: dict, number: int, total: int, spot: Spot | None, detectable: bool) -> None:
        text = step_text(step, spot, detectable)
        self.deps.display.send([
            f"@ {SURFACE} at=topRight w=360",
            f"c s Screen title={json.dumps(f'PERMISSIONS {number} OF {total}')}",
            f"c t Text value={json.dumps(text)}",
            "c row Stack direction=grid cols=2 gap=2",
            'c skip Button label="Skip" action=perm-skip',
            'c stop Button label="Stop" action=perm-stop',
            "> s t row",
            "> row skip stop",
            "r s",
        ])

    def one(self, step: dict, number: int, total: int) -> str:
        deps = self.deps
        if step["status"] == "app-missing":
            deps.log(f"{number} of {total}: skipped, {step['app']} is not installed")
            return "not installed"
        if step["status"] == "host-unknown":
            deps.log(f"{number} of {total}: skipped, could not tell which app runs this session")
            return "no app"
        if step["permission"] == "automation" and step["status"] in ("not-asked", "unknown"):
            # Never asked: macOS's own Allow prompt is one click, no Settings.
            if deps.prompt_automation(step):
                return "on"
        deps.log(f"{number} of {total}: {step['pane']} for {step['app_name']}")
        if not deps.open_pane(pane_url(step["permission"])):
            return "settings would not open"
        detectable = step["status"] != "unknown"
        # A second press on Skip meant for the last step must not skip this one.
        deps.display.take()
        card: CardHandle | None = None
        spot: Spot | None = None
        shown: tuple | None = None
        self.panel(step, number, total, None, detectable)
        started = deps.clock()
        next_look = started
        try:
            while True:
                now = deps.clock()
                for event in deps.display.take():
                    if event.get("name") == "perm-stop":
                        return "stopped"
                    if event.get("name") == "perm-skip":
                        # Skip is how a Mac that can't report the grant moves
                        # on, so it is not evidence the switch is still off.
                        return "skipped" if detectable else "unconfirmed"
                    if event.get("name") == "hit":
                        # The display takes a ring down when it is pressed.
                        # The check below decides whether that press was the
                        # switch; if not, the ring goes back up on the next look.
                        shown, next_look = None, now
                if deps.detect(step) == "granted":
                    return "on"
                if now - started >= self.timeout_s:
                    return "timed out"
                if now >= next_look:
                    next_look = now + self.locate_every_s
                    found = find_spot(deps.snapshot(), step.get("app_name") or "", deps.matches)
                    if found is not None and found.key() != shown:
                        changed_kind = spot is None or spot.kind != found.kind
                        spot, shown = found, found.key()
                        deps.display.send([deps.mark_line(found.frame, bubble_words(step, found), 0)])
                        if changed_kind:
                            self.panel(step, number, total, found, detectable)
                        if card is None and found.kind in ("absent", "list") and step["permission"] in DRAG_PANES:
                            card = deps.drag_card(step)
                deps.sleep(self.poll_s)
        finally:
            deps.display.send(["u guide"])
            if card is not None:
                card.stop()

    def finish(self) -> None:
        on = [r.step for r in self.results if r.outcome == "on"] + self.already_on
        unsure = [r.step for r in self.results if r.outcome == "unconfirmed"]
        off = [r.step for r in self.results if r.outcome not in ("on", "unconfirmed")]
        title = "ALL SET" if not off and not unsure else "PERMISSIONS"
        parts = []
        if on:
            parts.append("On: " + ", ".join(f"{s['pane']} for {s['app_name']}" for s in on) + ".")
        if unsure:
            parts.append("This Mac can't confirm: " + ", ".join(f"{s['pane']} for {s['app_name']}"
                                                              for s in unsure) + ".")
        if off:
            parts.append("Still off: " + ", ".join(f"{s['pane']} for {s.get('app_name') or 'an unknown app'}"
                                                   for s in off) + ". Say fix my permissions to pick it up.")
        self.deps.display.send([
            f"- {SURFACE}",
            f"@ {DONE_SURFACE} at=top w=420 life={TOAST_LIFE_S}",
            f"c s Screen title={json.dumps(title)}",
            f"c t Text value={json.dumps(' '.join(parts) or 'Nothing to turn on.')}",
            "> s t",
            "r s",
        ])


class HudDisplay:
    """One subscribed connection to Kyber for the length of the walk.

    Subscribing needs the per-start token (hud/CLAUDE.md, "Who hears events");
    the reader thread keeps only this walk's presses and the ring's hit.
    """

    def __init__(self, socket_path: str) -> None:
        self.path = socket_path
        self.sock: socket.socket | None = None
        self.events: list[dict] = []
        self.lock = threading.Lock()

    def open(self) -> bool:
        try:
            sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            sock.settimeout(2)
            sock.connect(self.path)
            sock.settimeout(None)
            sock.sendall((hud_events.listen_line(self.path) + "\n").encode("utf-8"))
        except OSError:
            return False
        self.sock = sock
        threading.Thread(target=self._read, daemon=True).start()
        return True

    def _read(self) -> None:
        buffer = b""
        while self.sock is not None:
            try:
                chunk = self.sock.recv(4096)
            except OSError:
                return
            if not chunk:
                return
            buffer += chunk
            while b"\n" in buffer:
                raw, buffer = buffer.split(b"\n", 1)
                got = hud_events.event(raw.decode("utf-8", "replace"))
                if got and (got.get("name") in ("perm-skip", "perm-stop")
                            or (got.get("name") == "hit" and got.get("component") == "guide")):
                    with self.lock:
                        self.events.append(got)

    def send(self, lines: list[str]) -> bool:
        if self.sock is None:
            return False
        try:
            self.sock.sendall(("\n".join(lines) + "\n").encode("utf-8"))
            return True
        except OSError:
            return False

    def take(self) -> list[dict]:
        with self.lock:
            taken, self.events = self.events, []
        return taken

    def close(self) -> None:
        sock, self.sock = self.sock, None
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass


class HelperCard:
    """The Anarlog drag card from mac/permission-guide, for as long as a step needs it."""

    def __init__(self, process: subprocess.Popen) -> None:
        self.process = process

    def stop(self) -> None:
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()


def helper_snapshot(helper: Path, out: Path) -> dict | None:
    """One read of the Settings tree through the helper's `snapshot`, or None."""
    try:
        done = subprocess.run([str(helper), "snapshot", "--out", str(out)], capture_output=True, text=True,
                              timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if done.returncode != 0:
        return None
    try:
        return json.loads(out.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
