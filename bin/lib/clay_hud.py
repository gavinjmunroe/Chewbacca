"""clay-build's lines on Kyber, and the one socket it draws and listens on.

Each state is a pure builder that returns HUD lines (hud/CLAUDE.md), so the
fixtures the Swift snapshot test renders are exactly what a run sends:

    python3 bin/lib/clay_hud.py --print acting

Surfaces: `clay-note` (the beside-note), `clay-card` (approval, short count,
done), `clay-strip` (bottom). Marker `clay-target`. Every button action is
`clay-*`, because Kyber delivers a button's event only to the client that drew
it, which is why drawing and listening share one connection here.

On `x`, nothing is drawn again (hud/CLAUDE.md: "On `x`, stop talking and show
nothing afterwards").
"""
from __future__ import annotations

import json
import os
import queue
import socket
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hud_events  # noqa: E402
from clay_geometry import Rect  # noqa: E402

NOTE, CARD, STRIP, TARGET = "clay-note", "clay-card", "clay-strip", "clay-target"
NOTE_W, CARD_W, DONE_W, STRIP_W = 300, 300, 320, 560

# The bracket outlives any one step so it never blinks out mid-wait; each step
# re-sends it. Five minutes covers the longest wait, the 90 s search, with room.
TARGET_LIFE = 300

# "Show me where" flashes the miss bracket long enough to find, then lets go.
SHOW_LIFE = 12

# Miller's law, from the HUD checklist: nine names, then a count.
MISSES_SHOWN = 9

FIXTURE_STATES = ("acting", "approve", "paused", "failed", "done")


class HudMissing(Exception):
    pass


def q(text) -> str:
    return json.dumps(str(text), ensure_ascii=False)


def _ints(rect: Rect) -> tuple[int, int, int, int]:
    return round(rect.x), round(rect.y), round(rect.w), round(rect.h)


def _near(rect: Rect | None) -> str:
    if rect is None:
        return "at=right"
    x, y, w, h = _ints(rect)
    return f"near={x},{y},{w},{h} side=right"


def _mark(rect: Rect, tone: str = "", life: int = TARGET_LIFE) -> str:
    x, y, w, h = _ints(rect)
    return f"m {TARGET} {x} {y} {w} {h}" + (f" tone={tone}" if tone else "") + f" life={life}"


def _point(rect: Rect, act: bool) -> str:
    return f"a {round(rect.x + rect.w / 2)} {round(rect.y + rect.h / 2)}" + (" act=true" if act else "")


def _clock(elapsed_s: float) -> str:
    whole = max(int(elapsed_s), 0)
    return f"{whole // 60}:{whole % 60:02d}"


def _credits(amount: float) -> str:
    return f"{round(amount, 2):g}"


def _ticks(n: int, total: int) -> str:
    return "■" * n + "□" * max(total - n, 0)


def _buttons(specs: list[tuple[str, str, str]]) -> list[str]:
    """(id, label, action) in order; the first is the card's one primary."""
    return [f"c {cid} Button label={q(label)} action={action}" + (" variant=primary" if i == 0 else "")
            for i, (cid, label, action) in enumerate(specs)]


def _window(surface: str, address: str, width: int, title: str, mark: str, body: list[str],
            children: list[str], urgency: str = "") -> list[str]:
    return [
        f"@ {surface} {address}" + (f" urgency={urgency}" if urgency else "") + f" chrome=window w={width}",
        f"c s Screen title={q(title)}",
        f"c mk {mark}",
        *body,
        f"> s mk {' '.join(children)}",
        "r s",
    ]


def strip(state: str, n: int, total: int, verb: str, elapsed_s: float) -> list[str]:
    """The bottom strip. `verb` is the step while acting and the message when done."""
    spin = "true" if state == "acting" else "false"
    kind = "globe" if state == "done" else "ico"
    if state == "acting":
        status = f"c verb Text value={q(f'{verb} · {n}/{total}')}"
    else:
        level, message = {
            "waiting": ("warning", "Waiting on you"),
            "paused": ("warning", "Paused"),
            "failed": ("error", f"Stopped at {n}/{total}"),
            "done": ("success", verb),
        }[state]
        status = f"c verb Status level={level} message={q(message)}"
    button = {
        "acting": ("Stop", "clay-stop"), "waiting": ("Stop", "clay-stop"),
        "paused": ("Resume", "clay-resume"), "done": ("Close", "clay-close"),
    }.get(state)
    return [
        f"@ {STRIP} at=bottom chrome=window w={STRIP_W}",
        'c s Screen title="CLAY-BUILD"',
        "c row Stack direction=horizontal gap=10",
        f"c mk Mark kind={kind} spin={spin} size=14",
        f"c ticks Text value={q(_ticks(n, total))}",
        status,
        f"c time Text value={q(_clock(elapsed_s))}",
        *([f"c stop Button label={q(button[0])} action={button[1]}"] if button else []),
        f"> row mk ticks verb time{' stop' if button else ''}",
        "> s row",
        "r s",
    ]


def tick(elapsed_s: float) -> list[str]:
    """The strip's clock alone, re-sent once a second while acting."""
    return [f"@ {STRIP} at=bottom chrome=window w={STRIP_W}", f"c time Text value={q(_clock(elapsed_s))}"]


def acting(step_title: str, n: int, total: int, note: str, holds: str, target: Rect,
           elapsed_s: float) -> list[str]:
    return [
        *_window(NOTE, _near(target), NOTE_W, step_title, "Mark kind=ico spin=true size=18",
                 [f"c body Text value={q(note)}", f"c hold Text value={q(holds)} tone=muted"],
                 ["body", "hold"]),
        *strip("acting", n, total, step_title.capitalize(), elapsed_s),
        _mark(target),
        _point(target, act=True),
    ]


def approve(title: str, rows: list[str], go_label: str, go_hint: str, no_hint: str, target: Rect,
            elapsed_s: float, n: int, total: int, dry_run: bool = False) -> list[str]:
    body = [f"c r{i} Text value={q(row)}" for i, row in enumerate(rows)]
    names = [f"r{i}" for i in range(len(rows))]
    if dry_run:
        body += ['c dry Text value="Dry run. Nothing was pressed." tone=muted',
                 *_buttons([("close", "Close", "clay-close")])]
        names += ["dry", "close"]
    else:
        go, no = _buttons([("go", go_label, "clay-approve"), ("no", "Not now", "clay-decline")])
        body += [go, f"c gohint Text value={q(go_hint)} tone=muted", no, f"c nohint Text value={q(no_hint)} tone=muted"]
        names += ["go", "gohint", "no", "nohint"]
    return [
        f"- {NOTE}",
        *_window(CARD, _near(target), CARD_W, title, "Mark kind=ico spin=false size=18", body, names,
                 urgency="" if dry_run else "alert"),
        *strip("waiting", n, total, "", elapsed_s),
        _mark(target),
        _point(target, act=False),
    ]


def ask_short(found: int, count: int, target: Rect, n: int = 2, total: int = 6,
              elapsed_s: float = 0.0) -> list[str]:
    """Free: Clay found fewer people than asked for."""
    body = [f"c body Text value={q(f'Clay found {found} people, fewer than the {count} you asked for.')}",
            'c hold Text value="Nothing is saved yet." tone=muted',
            *_buttons([("go", f"Use all {found}", "clay-approve"), ("no", "End here", "clay-decline")])]
    return [
        f"- {NOTE}",
        *_window(CARD, _near(target), CARD_W, "FEWER FOUND", "Mark kind=ico spin=false size=18", body,
                 ["body", "hold", "go", "no"]),
        *strip("waiting", n, total, "", elapsed_s),
    ]


def paused(n: int, total: int, elapsed_s: float, target: Rect | None = None,
           body: str = "You have the page.", hold: str = "Nothing spent.") -> list[str]:
    lines = [f"c body Text value={q(body)}", f"c hold Text value={q(hold)} tone=muted",
             *_buttons([("resume", "Resume", "clay-resume"), ("end", "End here", "clay-end")])]
    return [
        "a off",
        f"u {TARGET}",
        f"- {CARD}",
        *_window(NOTE, _near(target), NOTE_W, "PAUSED", "Mark kind=ico spin=false size=18", lines,
                 ["body", "hold", "resume", "end"]),
        *strip("paused", n, total, "", elapsed_s),
    ]


def failed(n: int, total: int, expected: str, target: Rect | None, can_retry: bool, elapsed_s: float,
           hold: str = "Nothing spent.") -> list[str]:
    specs = ([("retry", "Try again", "clay-retry")] if can_retry else []) \
        + ([("show", "Show me where", "clay-show")] if target else []) \
        + [("end", "End here", "clay-end")]
    lines = [f"c body Text value={q(expected)}", f"c hold Text value={q(hold)} tone=muted", *_buttons(specs)]
    return [
        "a off",
        f"- {CARD}",
        _mark(target, tone="miss") if target else f"u {TARGET}",
        *_window(NOTE, _near(target), NOTE_W, f"STOPPED AT {n}/{total}", "Mark kind=ico spin=false size=18",
                 lines, ["body", "hold", *(cid for cid, _, _ in specs)]),
        *strip("failed", n, total, "", elapsed_s),
    ]


def show_where(target: Rect) -> list[str]:
    return [_mark(target, tone="miss", life=SHOW_LIFE), _point(target, act=False)]


def done(rows: int, found: int, missing_names, spent: float, auto_run: bool | None, elapsed_s: float,
         show_misses: bool = False, total: int = 6) -> list[str]:
    missing = list(missing_names)
    auto = {True: "Table auto-run is on", False: "Table auto-run is off"}.get(
        auto_run, "Clay did not report table auto-run")
    body = [f"c people Text value={q(f'{rows} people in the table')}",
            f"c found Text value={q(f'{found} have a work email')}"]
    names = ["people", "found"]
    if missing:
        body.append(f"c miss Text value={q(f'{len(missing)} without one')}")
        names.append("miss")
    body += [f"c spent Text value={q(f'Spent {_credits(spent)} credits')}",
             f"c auto Text value={q(auto)} tone=muted"]
    names += ["spent", "auto"]
    if missing and show_misses:
        shown = missing[:MISSES_SHOWN] + ([f"+{len(missing) - MISSES_SHOWN} more"]
                                          if len(missing) > MISSES_SHOWN else [])
        body.append(f"c list List items={json.dumps(shown, ensure_ascii=False)}")
        names.append("list")
    specs = ([("misses", "Show the misses", "clay-misses")] if missing and not show_misses else []) \
        + [("close", "Close", "clay-close")]
    body += _buttons(specs)
    names += [cid for cid, _, _ in specs]
    return [
        "a off",
        f"u {TARGET}",
        f"- {NOTE}",
        f"- {CARD}",
        *_window(CARD, "at=right", DONE_W, "DONE", "Mark kind=globe spin=true size=40", body, names),
        *strip("done", total, total, f"{found}/{rows} emails · {_credits(spent)} cr", elapsed_s),
    ]


def clear() -> list[str]:
    return ["a off", f"u {TARGET}", f"- {NOTE}", f"- {CARD}", f"- {STRIP}"]


def _connect(path: str) -> socket.socket:
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        sock.connect(path)
    except OSError:
        sock.close()
        raise
    return sock


class Hud:
    """One connection for the whole run: subscribed, drawing, and quiet for
    good after `x`. While it is open Kyber sees a listener and does not
    restart hud-listen (bin/call-watch:131-134); a run is minutes long."""

    def __init__(self, path: str | None = None, connect=_connect):
        self.path = path or os.environ.get("BOB_HUD_SOCKET", str(Path.home() / ".bob" / "hud.sock"))
        self.connect = connect
        self.sock: socket.socket | None = None
        self.events: queue.Queue = queue.Queue()
        self.dismissed = False
        self.lock = threading.Lock()

    def open(self) -> None:
        try:
            self.sock = self.connect(self.path)
        except OSError as err:
            raise HudMissing("Kyber isn't running, and this run is meant to be watched.") from err
        self._write([hud_events.listen_line(self.path)])
        threading.Thread(target=self._read, daemon=True).start()

    def _write(self, lines: list[str]) -> None:
        with self.lock:
            if self.sock is None or self.dismissed:
                return
            try:
                self.sock.sendall(("\n".join(lines) + "\n").encode("utf-8"))
            except OSError:
                self._end()

    def send(self, lines: list[str]) -> None:
        self._write(lines)

    def _end(self) -> None:
        # Kyber closing the socket reads as `x`: nothing can be drawn, so
        # nobody can approve anything, and the run must stop.
        if not self.dismissed:
            self.dismissed = True
            self.events.put({"name": "dismissed"})

    def _read(self) -> None:
        buffer = b""
        while True:
            try:
                chunk = self.sock.recv(4096) if self.sock else b""
            except OSError:
                chunk = b""
            if not chunk:
                self._end()
                return
            buffer += chunk
            while b"\n" in buffer:
                raw, buffer = buffer.split(b"\n", 1)
                line = raw.decode("utf-8", "replace").strip()
                if line == "x" or line.startswith("x "):
                    self._end()
                    continue
                event = hud_events.event(line)
                if event and (event["name"] == "stop" or event["name"].startswith("clay-")):
                    self.events.put(event)

    def next_event(self, timeout_s: float) -> dict | None:
        try:
            return self.events.get(timeout=max(timeout_s, 0))
        except queue.Empty:
            return None

    def close(self) -> None:
        self._write(clear())
        sock, self.sock = self.sock, None
        if sock is None:
            return
        try:
            sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass  # already closed from Kyber's side
        sock.close()


def sample(state: str) -> list[str]:
    """A representative frame of each state, for the snapshot fixtures."""
    target = Rect(420, 312, 128, 32)
    return {
        "acting": lambda: acting("FIND PEOPLE", 2, 6, "Asking Clay's people search for fintech VC partners.",
                                 "Nothing is saved yet.", target, 42),
        "approve": lambda: approve("TEST RUN", ["Save and run 10 rows", "Balance now 1234.5 cr"],
                                   "Run the test", "Spends credits on 10 rows. It cannot be undone.",
                                   "Nothing is spent, and the table stays.", target, 61, 4, 6),
        "paused": lambda: paused(3, 6, 70, target),
        "failed": lambda: failed(3, 6, "Couldn't find Continue on the page.", target, True, 80),
        "done": lambda: done(50, 41, [f"Person {i}" for i in range(9)], 31.2, False, 300),
    }[state]()


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] != "--print" or sys.argv[2] not in FIXTURE_STATES:
        sys.stderr.write(f"usage: clay_hud.py --print {'|'.join(FIXTURE_STATES)}\n")
        sys.exit(2)
    print("\n".join(sample(sys.argv[2])))
