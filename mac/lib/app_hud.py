#!/usr/bin/env python3
"""chewie app ask: find the control, show it on the glass, press only on a tap.

1. `see` the app and pick the control (exact label in code, else Jev).
2. Draw a bracket on the control's real screen rectangle and a card beside it:
   "Press <label> in <App>?" with Press it / Not this.
3. Press it runs `appctl press <i> --yes`, because the tap on the card IS the
   person's yes for that exact control. Not this, x, a closed socket or the
   timeout presses nothing.

AX frames are already screen points from the top-left of the main display,
which is the space Kyber's `m` and `near=` lines take, so the rectangle goes
from `where` to the glass with no conversion (rules/spatial-one-mapping.md).
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Optional

HERE = Path(__file__).resolve()
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / "bin" / "lib"))
sys.path.insert(0, str(HERE.parent))
import hud_events  # noqa: E402
import app_find  # noqa: E402

SURFACE = "appctl-ask"
MARK = "appctl-target"
# Long enough to read the card and decide; past it nothing is pressed.
# Guessed, never measured.
WAIT_S = float(os.environ.get("APP_ASK_WAIT_S", "90"))


def q(text: str) -> str:
    return json.dumps(str(text), ensure_ascii=False)


def run(appctl: str, *args: str) -> tuple[int, dict, str]:
    done = subprocess.run([appctl, *args], capture_output=True, text=True)
    try:
        out = json.loads(done.stdout) if done.stdout.strip() else {}
    except json.JSONDecodeError:
        out = {}
    return done.returncode, out, done.stderr.strip()


def card(app: str, label: str, rect: Optional[list[int]], note: str = "") -> list[str]:
    """`rect` is None when the app's window isn't on screen: a bracket there
    would frame whatever happens to be in front, so the card sits at the
    right and names the control instead."""
    if rect:
        x, y, w, h = rect
        lines = [f"m {MARK} {x - 4} {y - 4} {w + 8} {h + 8} life=0",
                 f"@ {SURFACE} near={x},{y},{w},{h} side=right chrome=window w=300"]
    else:
        lines = [f"@ {SURFACE} at=right chrome=window w=300"]
    lines += [
        f"c s Screen title={q(app.upper())}",
        f"c t Text value={q(f'Press {label} in {app}?')}",
    ]
    kids = ["t"]
    if note:
        lines.append(f"c n Text value={q(note)}")
        kids.append("n")
    lines += [
        'c go Button label="Press it" action=appctl-go variant=primary',
        'c no Button label="Not this" action=appctl-no',
        f"> s {' '.join(kids)} go no",
        "r s",
    ]
    return lines


def clear() -> list[str]:
    return [f"u {MARK}", f"- {SURFACE}"]


class Glass:
    def __init__(self) -> None:
        self.path = os.environ.get("BOB_HUD_SOCKET", str(Path.home() / ".bob" / "hud.sock"))
        self.sock: Optional[socket.socket] = None
        self.answer: Optional[str] = None
        self.done = threading.Event()

    def open(self) -> bool:
        listen = hud_events.listen_line(self.path)
        if listen == "listen":
            return False  # no token, so Kyber would never pass the tap back
        try:
            s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            s.connect(self.path)
        except OSError:
            return False
        self.sock = s
        self.send([listen])
        threading.Thread(target=self._read, daemon=True).start()
        return True

    def send(self, lines: list[str]) -> None:
        if self.sock is None:
            return
        try:
            self.sock.sendall(("\n".join(lines) + "\n").encode("utf-8"))
        except OSError:
            self._finish("dismissed")

    def _finish(self, answer: str) -> None:
        if self.answer is None:
            self.answer = answer
        self.done.set()

    def _read(self) -> None:
        buf = b""
        while not self.done.is_set():
            try:
                chunk = self.sock.recv(4096) if self.sock else b""
            except OSError:
                chunk = b""
            if not chunk:
                self._finish("dismissed")
                return
            buf += chunk
            while b"\n" in buf:
                raw, buf = buf.split(b"\n", 1)
                line = raw.decode("utf-8", "replace").strip()
                if line == "x" or line.startswith("x "):
                    self._finish("dismissed")
                    continue
                ev = hud_events.event(line)
                if not ev:
                    continue
                if ev["name"] in ("appctl-go", "go"):
                    self._finish("go")
                elif ev["name"] in ("appctl-no", "no"):
                    self._finish("no")

    def close(self) -> None:
        self.send(clear())
        if self.sock:
            try:
                self.sock.close()
            except OSError:
                pass
            self.sock = None


def main() -> int:
    if len(sys.argv) != 4:
        print("usage: app_hud.py <appctl> <app> <what you want>", file=sys.stderr)
        return 2
    appctl, app, intent = sys.argv[1:]
    code, snap, err = run(appctl, "see", app)
    if code != 0:
        print(err, file=sys.stderr)
        return code
    found = app_find.find(snap, intent)
    if found.get("i") is None:
        print(json.dumps({"found": found}, indent=2))
        return 3
    code, where, err = run(appctl, "where", app, str(found["i"]))
    if code != 0:
        print(err, file=sys.stderr)
        return code
    label = found["element"].get("label") or found["element"]["role"].removeprefix("AX")
    note = "" if found.get("via") == "exact label" else f"Picked by meaning, {round(found['confidence'] * 100)}% sure"
    # Show the gate's reason on the card when this press is one the person
    # must approve knowingly: a delete, a send, or anything inside a dialog.
    gcode, _, gerr = run(appctl, "press", app, str(found["i"]), "--check")
    if gcode == 4:
        try:
            note = json.loads(gerr).get("error", gerr)
        except json.JSONDecodeError:
            note = gerr
        note = note.replace("; refused without --yes", "").strip()[:160]
    glass = Glass()
    if not glass.open():
        print(json.dumps({"found": found, "pressed": False,
                          "reason": "Kyber isn't listening, so nothing was pressed"}, indent=2))
        return 2
    _, wins, _ = run(appctl, "windows", app)
    win = next((w for w in (wins if isinstance(wins, list) else []) if w.get("window") == snap.get("window")), {})
    visible = bool(win) and not win.get("hidden") and not win.get("minimized")
    glass.send(card(snap.get("app") or app, label, where["screen"] if visible else None, note))
    glass.done.wait(WAIT_S)
    answer = glass.answer or "timeout"
    result: dict = {"found": found, "answer": answer, "pressed": False}
    if answer == "go":
        code, did, err = run(appctl, "press", app, str(found["i"]), "--yes")
        result["pressed"] = code == 0
        result["did"] = did or err
    glass.close()
    print(json.dumps(result, indent=2))
    return 0 if result["pressed"] or answer != "go" else 1


if __name__ == "__main__":
    sys.exit(main())
