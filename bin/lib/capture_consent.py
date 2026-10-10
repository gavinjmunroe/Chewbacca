"""The consent line a recording puts on the glass before it hears anything.

CHW-206, from docs/plans/COMPETITORS.md gap 4: capture had no consent line at
start. Now `room-capture start` and `room-listen` draw one line on the glass,
naming that this Mac is recording and transcribing here, and only then start
the process that writes audio. "Drawn" means Kyber read
the lines: the drawing is followed by a `listen`, and Kyber answers `listen`
only after it has handled every line before it. With no glass (Kyber not
running, or no answer in ACK_S) the same line goes to the terminal first, so
a recording never starts unannounced.

The first drawing has no Stop press, because the short-lived starter can't
hear one and a button nobody hears is a promise the panel can't keep. The
process that keeps recording (the capture watcher in
bin/lib/meeting_capture.py, or room-listen) redraws the same surface on its
own subscribed connection with Stop recording on it, so from the first frame
that has a Stop button, a press reaches the process that can stop. Each
capture draws its own surface, `capture-<id>`, so one capture's stop never
takes down another's line, and a press is acted on only when it names this
capture's surface. The `ks-` prefix keeps hud-listen
from handing the press to its model (bin/hud-listen), and an event that names
a surface goes only to the client that drew it (hud/CLAUDE.md, Private lines).
"""
from __future__ import annotations

import json
import os
import re
import socket
import sys
import threading
import time
from pathlib import Path

import hud_events

SURFACE = "capture"


def surface_name(capture_id: str = "") -> str:
    """`capture-<id>`, the id cut to what a Kyber id allows."""
    cid = re.sub(r"[^A-Za-z0-9]", "", str(capture_id or ""))[:40]
    return f"{SURFACE}-{cid}" if cid else SURFACE
STOP_ACTION = "ks-capture-stop"
# How long to wait for Kyber to answer the `listen` after the drawing. Kyber
# answered in well under 100 ms on this Mac in every hud-events test; a
# second is long enough for a loaded machine and short enough that a start
# with no glass is not held up. Guessed, never measured at load 40.
ACK_S = 1.5
WIDTH = 440


def socket_path(env: dict | None = None) -> str:
    env = os.environ if env is None else env
    return env.get("BOB_HUD_SOCKET", str(Path(env.get("HOME") or Path.home()) / ".bob" / "hud.sock"))


def capture_line(mic: bool = True, summary: bool = True) -> str:
    heard = "this Mac's mic and the call audio" if mic else "the call audio"
    after = ("When it stops, the transcript goes to Claude for a summary." if summary
             else "Nothing leaves this Mac.")
    return f"Recording now: {heard}, transcribed on this Mac. Audio is deleted once transcribed. {after}"


def room_listen_line() -> str:
    return "Recording now: this Mac's mic, transcribed on this Mac. Audio is deleted once transcribed."


def lines(text: str, stop: bool = True, name: str = SURFACE) -> list[str]:
    """The surface, in Kyber Lines. One line of text and, when someone will
    hear it, the Stop press."""
    def prop(value) -> str:
        return json.dumps(value, separators=(",", ":"), ensure_ascii=False)
    out = [f"@ {name} at=top w={WIDTH}",
           f"c {name}-s Screen title={prop('RECORDING')}",
           f"c {name}-line Text value={prop(text)}"]
    kids = [f"{name}-line"]
    if stop:
        out.append(f"c {name}-stop Button label={prop('Stop recording')} action={prop(STOP_ACTION)} "
                   f"variant={prop('primary')}")
        kids.append(f"{name}-stop")
    out += [f"> {name}-s " + " ".join(kids), f"r {name}-s"]
    return out


def _connect(path: str) -> socket.socket:
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        sock.connect(path)
    except OSError:
        sock.close()
        raise
    return sock


def _read_until_version(sock: socket.socket, buffer: bytes, deadline: float) -> tuple[bool, list[str], bytes]:
    """(answered, problems, rest): reads lines until a `v!` line arrives."""
    problems = []
    while True:
        while b"\n" in buffer:
            raw, buffer = buffer.split(b"\n", 1)
            line = raw.decode("utf-8", "replace")
            if line.startswith("v!"):
                return True, problems, buffer
            if line.startswith("! ") and "token" not in line:
                problems.append(line[2:])
        left = deadline - time.monotonic()
        if left <= 0:
            return False, problems, buffer
        sock.settimeout(left)
        try:
            chunk = sock.recv(4096)
        except OSError:
            return False, problems, buffer
        if not chunk:
            return False, problems, buffer
        buffer += chunk


def show(text: str, stop: bool = False, path: str | None = None, connect=_connect, timeout: float = ACK_S,
         name: str = SURFACE) -> dict:
    """Draw the consent surface and wait until Kyber has read it.
    {"drawn": bool, "why": str}. Never raises."""
    path = path or socket_path()
    try:
        sock = connect(path)
    except OSError:
        return {"drawn": False, "why": "Kyber isn't running"}
    try:
        listen = hud_events.listen_line(path)
        deadline = time.monotonic() + timeout
        sock.sendall((listen + "\n").encode("utf-8"))
        ok, _, rest = _read_until_version(sock, b"", deadline)
        if not ok:
            return {"drawn": False, "why": "Kyber didn't answer"}
        sock.sendall(("\n".join(lines(text, stop, name) + [listen]) + "\n").encode("utf-8"))
        ok, problems, _ = _read_until_version(sock, rest, deadline)
        if not ok:
            return {"drawn": False, "why": "Kyber didn't confirm the drawing"}
        if problems:
            return {"drawn": False, "why": "Kyber refused it: " + problems[0][:80]}
        return {"drawn": True, "why": ""}
    except OSError as err:
        return {"drawn": False, "why": str(err)[:80]}
    finally:
        try:
            sock.close()
        except OSError:
            pass


def announce(text: str, path: str | None = None, err=None, connect=_connect, name: str = SURFACE) -> str:
    """Show the consent line on the glass, else on the terminal. Returns
    where it was shown: "glass" or "terminal". Called before anything that
    writes audio is started."""
    shown = show(text, False, path, connect, name=name)
    if shown["drawn"]:
        return "glass"
    print(text + (f" (Not on the glass: {shown['why']}.)" if shown["why"] else ""), file=err or sys.stderr,
          flush=True)
    return "terminal"


def take_down(name: str = SURFACE, path: str | None = None, connect=_connect) -> None:
    try:
        sock = connect(path or socket_path())
    except OSError:
        return
    try:
        sock.sendall(f"- {name}\n".encode("utf-8"))
    except OSError:
        pass
    finally:
        sock.close()


class Glass:
    """The recording process's own hold on the consent surface: it redraws
    the surface (which makes it the owner), hears the Stop press, and takes
    the surface down when recording ends."""

    def __init__(self, path: str | None = None, connect=_connect, name: str = SURFACE):
        self.path = path or socket_path()
        self.name = name
        self.connect = connect
        self.sock: socket.socket | None = None
        self.stopped = threading.Event()

    def own(self, text: str, on_stop) -> bool:
        try:
            self.sock = self.connect(self.path)
            listen = hud_events.listen_line(self.path)
            # Without the token Kyber sends no events, so a Stop button would
            # be a promise nobody keeps: draw the line alone.
            hears = listen != "listen"
            self.sock.sendall(("\n".join([listen] + lines(text, stop=hears, name=self.name)) + "\n")
                              .encode("utf-8"))
        except OSError:
            self.sock = None
            return False
        if hears:
            threading.Thread(target=self._read, args=(on_stop,), daemon=True).start()
        return hears

    def _read(self, on_stop) -> None:
        buffer = b""
        sock = self.sock
        while sock is not None:
            try:
                sock.settimeout(None)
                chunk = sock.recv(4096)
            except OSError:
                return
            if not chunk:
                return
            buffer += chunk
            while b"\n" in buffer:
                raw, buffer = buffer.split(b"\n", 1)
                ev = hud_events.event(raw.decode("utf-8", "replace"))
                if ev and ev["name"] == STOP_ACTION and ev.get("surface") == self.name and not self.stopped.is_set():
                    self.stopped.set()
                    on_stop()

    def close(self) -> None:
        sock, self.sock = self.sock, None
        if sock is None:
            return
        try:
            sock.sendall(f"- {self.name}\n".encode("utf-8"))
        except OSError:
            pass
        try:
            # Wakes the reader thread out of recv before the socket goes.
            sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        try:
            sock.close()
        except OSError:
            pass
