#!/usr/bin/env python3
"""Meeting autopilot: bin/lib/meeting_autopilot.py and bin/meeting-autopilot.

Hermetic. No mic is opened, nothing records: a snapshot here is the JSON line
`room-capture --watch-mic` prints, written by hand, and the clock is a
variable.

What is held: a work call app holding the mic for Anarlog's 15 s starts a
recording and its going quiet for 20 s stops it; a dip shorter than that
does not; Siri's corespeechd, Chewbacca's own listener, an IDE and an
unknown app never count; a browser counts only with a meeting tab or a call
on the calendar; FaceTime and WhatsApp count only with a call on the
calendar; a lecture on the calendar is not a call; a recording someone
started by hand is never stopped; a Stop press on one this started holds
until the call ends; and the CLI parses and answers status with no loop.
"""
import importlib.machinery
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bin" / "lib"))
import meeting_autopilot as AP  # noqa: E402

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


T0 = datetime(2026, 10, 10, 18, 0, tzinfo=timezone.utc)
ZOOM = {"id": "us.zoom.xos", "name": "zoom.us", "pid": 10}
CHROME = {"id": "com.google.Chrome", "name": "Google Chrome", "pid": 11}
FACETIME = {"id": "com.apple.FaceTime", "name": "FaceTime", "pid": 12}
SIRI = {"id": "/System/Library/PrivateFrameworks/CoreSpeech.framework/corespeechd", "name": "corespeechd", "pid": 791}
LISTENER = {"id": "/Users/x/.local/share/uv/tools/mlx-whisper/bin/python3", "name": "python3", "pid": 13}
VSCODE = {"id": "com.microsoft.VSCode", "name": "Code", "pid": 14}
ROOM = {"id": "/Users/x/code/chewbacca/mac/room-capture/.build/release/room-capture", "name": "room-capture", "pid": 15}
MEET_TAB = {"app": "com.google.Chrome", "title": "Meet - abc-defg-hij"}
CALL = {"title": "Zeutara sync", "start": T0.isoformat(), "end": (T0 + timedelta(minutes=30)).isoformat(),
        "isAllDay": False, "location": "https://meet.google.com/abc-defg-hij", "attendees": []}
LECTURE = {"title": "BISC 101", "start": T0.isoformat(), "end": (T0 + timedelta(hours=1)).isoformat(),
           "isAllDay": False, "location": "SGM 123", "attendees": [{"email": "caleb@usc.example"}]}
ME = {"caleb@usc.example"}


def snap(*mic, windows=()):
    return {"mic": list(mic), "windows": list(windows), "screen": "granted"}


def drive(pilot, frames, running=None):
    """frames: (seconds after T0, meeting or None). Returns [(t, action)]."""
    out = []
    capture = {"running": False}
    for t, meeting in frames:
        if running is not None:
            capture["running"] = running(t, capture["running"])
        action = pilot.step(meeting, capture["running"], ours=capture["running"], now=T0 + timedelta(seconds=t))
        if action == "start":
            capture["running"] = True
        if action == "stop":
            capture["running"] = False
        if action:
            out.append((t, action))
    return out


def main() -> int:
    # what counts
    zoom = AP.meeting_in(snap(ZOOM, SIRI), None)
    check("a work call app holding the mic is a meeting, named", zoom and zoom["name"] == "Zoom", zoom)
    check("Siri's corespeechd holding the mic is never a meeting (measured on this Mac 2026-10-10)",
          AP.meeting_in(snap(SIRI), AP.event_now([CALL], T0, ME)) is None)
    check("Chewbacca's own listener, an IDE, and its own capture helper never count",
          AP.meeting_in(snap(LISTENER, VSCODE, ROOM), AP.event_now([CALL], T0, ME)) is None)
    check("a browser holding the mic with nothing else is not a meeting", AP.meeting_in(snap(CHROME), None) is None)
    tab = AP.meeting_in(snap(CHROME, windows=[MEET_TAB]), None)
    check("a browser with a Meet tab on screen is a meeting, and says why", tab and "Meet - " in tab["why"], tab)
    cal = AP.meeting_in(snap(CHROME), AP.event_now([CALL], T0 + timedelta(minutes=3), ME))
    check("a browser during a calendar call with a link is a meeting", cal and "Zeutara sync" in cal["why"], cal)
    check("a meeting tab on screen with nobody on the mic is not a meeting",
          AP.meeting_in(snap(windows=[MEET_TAB]), None) is None)
    check("FaceTime with no call on the calendar is a personal call, not a meeting",
          AP.meeting_in(snap(FACETIME), None) is None)
    check("FaceTime during a calendar call is a meeting",
          (AP.meeting_in(snap(FACETIME), AP.event_now([CALL], T0, ME)) or {}).get("name") == "FaceTime")
    check("a lecture block with only the owner invited is not a call",
          AP.event_now([LECTURE], T0 + timedelta(minutes=5), ME) is None)
    check("an event with another attendee is a call", AP.is_call_event(
        {**LECTURE, "attendees": [{"email": "caleb@usc.example"}, {"email": "jonah@zeutara.example"}]}, ME))
    check("an all-day event is never a call", not AP.is_call_event({**CALL, "isAllDay": True}, ME))
    check("a call counts from 5 min before its start to 10 min after its end (Anarlog's windows)",
          AP.event_now([CALL], T0 - timedelta(minutes=4), ME) is not None
          and AP.event_now([CALL], T0 - timedelta(minutes=6), ME) is None
          and AP.event_now([CALL], T0 + timedelta(minutes=39), ME) is not None
          and AP.event_now([CALL], T0 + timedelta(minutes=41), ME) is None)

    # when it starts and stops
    m = AP.meeting_in(snap(ZOOM), None)
    acts = drive(AP.Autopilot(), [(t, m) for t in range(0, 30, 2)] + [(t, None) for t in range(30, 60, 2)])
    check("it starts once the call has held the mic 15 s and stops 20 s after it lets go",
          acts == [(16, "start"), (50, "stop")], acts)
    acts = drive(AP.Autopilot(), [(t, m) for t in range(0, 12, 2)] + [(t, None) for t in range(12, 40, 2)])
    check("a mic held under 15 s (a voice memo, a quick dictation) never starts anything", acts == [], acts)
    frames = [(t, m) for t in range(0, 30, 2)] + [(t, None) for t in range(30, 40, 2)] \
        + [(t, m) for t in range(40, 80, 2)] + [(t, None) for t in range(80, 110, 2)]
    acts = drive(AP.Autopilot(), frames)
    check("a 10 s dip (headphones switched) keeps the same recording going",
          acts == [(16, "start"), (100, "stop")], acts)

    pilot = AP.Autopilot()
    acts = []
    for t in range(0, 60, 2):
        a = pilot.step(m, capture_running=True, ours=False, now=T0 + timedelta(seconds=t))
        if a:
            acts.append(a)
    check("a recording someone started by hand is theirs: never started twice, never stopped",
          acts == [] and pilot.phase == "idle", (acts, pilot.phase))

    stopped_at = 30
    acts = drive(AP.Autopilot(), [(t, m) for t in range(0, 80, 2)] + [(t, None) for t in range(80, 90, 2)]
                 + [(t, m) for t in range(90, 130, 2)],
                 running=lambda t, r: False if t == stopped_at else r)
    check("a Stop press holds until that call ends, and the next call starts again",
          acts == [(16, "start"), (106, "start")], acts)

    # the CLI
    tmp = Path(tempfile.mkdtemp())
    env = {**os.environ, "HOME": str(tmp)}
    loader = importlib.machinery.SourceFileLoader("meeting_autopilot_cli", str(ROOT / "bin" / "meeting-autopilot"))
    spec = importlib.util.spec_from_loader("meeting_autopilot_cli", loader)
    check("bin/meeting-autopilot parses", spec is not None and compile(
        (ROOT / "bin" / "meeting-autopilot").read_text(), "meeting-autopilot", "exec") is not None)
    done = subprocess.run([sys.executable, str(ROOT / "bin" / "meeting-autopilot"), "status", "--json"],
                          capture_output=True, text=True, env=env, timeout=30)
    body = json.loads(done.stdout or "{}")
    check("status with no loop exits 3 and says not running", done.returncode == 3 and body.get("running") is False,
          (done.returncode, done.stdout, done.stderr))
    subprocess.run([sys.executable, str(ROOT / "bin" / "meeting-autopilot"), "off"], capture_output=True, env=env)
    check("off writes its flag in a 0700 folder",
          (tmp / ".chewbacca" / "meeting-autopilot" / "off").exists()
          and oct((tmp / ".chewbacca" / "meeting-autopilot").stat().st_mode & 0o777) == "0o700")
    subprocess.run([sys.executable, str(ROOT / "bin" / "meeting-autopilot"), "on"], capture_output=True, env=env)
    check("on removes it", not (tmp / ".chewbacca" / "meeting-autopilot" / "off").exists())

    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
