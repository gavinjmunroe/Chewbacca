"""Whether an agent may draw on the person's live glass right now.

2026-10-11, 2:19am and again at 2:21am: a background agent testing the
meetings panel opened it over Caleb's work again and again while he was using
the Mac. He asked "Im not in a meeting?" and then "It keeps popping up? Fix
chewbs bro". Telling the agent to stop was prose; this is the gate.

An agent (CLAUDECODE is set in every Claude Code shell) may not open a surface
while the person has touched the keyboard or mouse in the last IDLE_S seconds,
unless KYBER_LIVE_OK=1 says the person asked to see it. Agents check their work
with the offscreen render (HUD_LINES_FILE) instead. The voice listener and the
person's own presses never set CLAUDECODE, so they are untouched.

    python3 live_glass.py        exit 0 when a draw may go ahead, 3 when refused
"""
from __future__ import annotations

import os
import re
import subprocess
import sys

# Two minutes without a key or mouse event counts as away. Guessed, never
# measured: long enough to cover reading, short enough that an overnight
# agent can still check its work on an idle screen.
IDLE_S = 120.0


def idle_seconds() -> float | None:
    try:
        out = subprocess.run(["ioreg", "-c", "IOHIDSystem", "-d", "4"], capture_output=True, text=True,
                             timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.search(r'"HIDIdleTime" = (\d+)', out)
    return int(m.group(1)) / 1e9 if m else None


def refusal(env: dict | None = None, idle: float | None = None) -> str | None:
    """Why an agent may not draw now, or None when it may."""
    env = os.environ if env is None else env
    if not env.get("CLAUDECODE") or env.get("KYBER_LIVE_OK") == "1":
        return None
    idle = idle_seconds() if idle is None else idle
    if idle is None or idle >= IDLE_S:
        return None
    return (f"Refused: the person is using this Mac (input {idle:.0f}s ago) and an agent may not "
            "open panels over their work. Check it offscreen with HUD_LINES_FILE, or set "
            "KYBER_LIVE_OK=1 only when they asked to see it.")


if __name__ == "__main__":
    why = refusal()
    if why:
        print(why, file=sys.stderr)
        sys.exit(3)
    sys.exit(0)
