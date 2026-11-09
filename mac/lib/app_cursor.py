#!/usr/bin/env python3
"""chewie app press: show the person what is about to be pressed.

A background press moves nothing, so without this it can't be watched. Before
the press, a marker goes on the control's real rectangle on Kyber's glass for
about 300 ms, then the press runs. The overlay idea is agent-desktop's cursor
overlay (vercel-labs/agent-desktop, Apache-2.0).

The marker is a picture and never decides anything:

- Kyber closed, a dead socket or a stuck display: the press goes ahead, with no
  wait when nothing is listening.
- A press the gate would refuse draws nothing, so the mark always means a press.
- A window that isn't being drawn (hidden, minimized, another Space) draws
  nothing, because a rectangle there would frame whatever happens to be in front.
- It clears itself twice: `u` right after the hold, and `life=` in case this
  process dies during the hold.

AX frames and Kyber's `m` line are both screen points from the top-left of the
main display, so the rectangle needs no conversion (rules/spatial-one-mapping.md).
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

MARK = "agent-cursor"
# The brief: long enough to catch by eye, short enough not to slow a press.
# Guessed, never measured on a person.
HOLD_S = 0.3
# Kyber sweeps expired marks every 500 ms (OverlayModel.startSweep), so a crash
# during the hold leaves the mark up for at most this plus half a second.
LIFE_S = 2
# A stuck display must not hold up a press. Guessed, never measured.
SOCKET_TIMEOUT_S = 0.2


def _socket_path() -> str:
    return os.environ.get("BOB_HUD_SOCKET", str(Path.home() / ".bob" / "hud.sock"))


def _connect() -> Optional[socket.socket]:
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(SOCKET_TIMEOUT_S)
        s.connect(_socket_path())
        return s
    except OSError:
        return None


def _rect(checked) -> Optional[list[int]]:
    rect = checked.get("screen") if isinstance(checked, dict) else None
    if (isinstance(rect, list) and len(rect) == 4
            and all(isinstance(n, int) and not isinstance(n, bool) for n in rect)
            and rect[2] > 0 and rect[3] > 0):
        return rect
    return None


def show(appctl: str, app: str, target: str, extra: list[str]) -> bool:
    """Draw, hold and clear. True when a marker went up. Never raises."""
    glass = _connect()
    if glass is None:
        return False
    try:
        # One call answers all three: the gate, the rectangle, and whether its
        # window is drawn. Three separate calls took a press from 0.24 s to
        # 2.73 s on 2026-11-06 at load 91.
        done = subprocess.run([appctl, "press", app, target, *extra, "--check"], capture_output=True, text=True)
        if done.returncode != 0:
            return False
        checked = json.loads(done.stdout)
        rect = _rect(checked)
        if rect is None or checked.get("on_screen") is not True:
            return False
        x, y, w, h = rect
        glass.sendall(f"m {MARK} {x - 4} {y - 4} {w + 8} {h + 8} life={LIFE_S}\n".encode())
        time.sleep(HOLD_S)
        glass.sendall(f"u {MARK}\n".encode())
        return True
    except (OSError, ValueError, AttributeError):
        return False
    finally:
        try:
            glass.close()
        except OSError:
            pass


def before_press(appctl: str, app: str, target: str, extra: list[str]) -> bool:
    """For `do` and `batch`, which chewie runs with CHEWIE_APP_CURSOR=1."""
    if os.environ.get("CHEWIE_APP_CURSOR") != "1":
        return False
    return show(appctl, app, target, extra)


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit("usage: app_cursor.py <appctl> press <app> <N|label> [flags]")
    appctl, args = sys.argv[1], sys.argv[2:]
    if len(args) >= 3 and args[0] == "press" and "--check" not in args:
        show(appctl, args[1], args[2], args[3:])
    # The driver answers for itself: same output, same exit code, same refusal.
    os.execv(appctl, [appctl, *args])


if __name__ == "__main__":
    main()
