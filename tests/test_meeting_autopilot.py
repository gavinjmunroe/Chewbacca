#!/usr/bin/env python3
"""Meeting autopilot: bin/lib/meeting_autopilot.py and bin/meeting-autopilot.

Hermetic. No mic is opened, nothing records: a snapshot here is the JSON line
`room-capture --watch-mic` prints, written by hand, and the clock is a
variable.

What is held: only a work call app whose process carries its vendor's valid
signature and Team ID can start a recording, and only after Anarlog's 15 s;
20 s quiet stops it and a shorter dip does not. A forged name, a fake bundle,
another team's signature, a broken signature, odd JSON types, a browser with
a meeting title, a hostile title, FaceTime, Siri and Chewbacca's own listener
never record, and the calendar is not an input at all (security review,
2026-10-10). A recording someone started by hand is never stopped; a Stop
press holds until the call ends; the CLI parses and answers status.
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
# Rows exactly as room-capture --watch-mic prints them, signatures included.
ZOOM = {"id": "us.zoom.xos", "name": "zoom.us", "pid": 10, "signed": True, "signing_id": "us.zoom.xos",
        "team": "BJ4HAAB9B3"}
TEAMS = {"id": "com.microsoft.teams2", "name": "Microsoft Teams", "pid": 16, "signed": True,
         "signing_id": "com.microsoft.teams2", "team": "UBF8T346G9"}
CHROME = {"id": "com.google.Chrome", "name": "Google Chrome", "pid": 11, "signed": True,
          "signing_id": "com.google.Chrome.helper", "team": "EQHXZ8M8AV"}
FACETIME = {"id": "com.apple.FaceTime", "name": "FaceTime", "pid": 12, "signed": True,
            "signing_id": "com.apple.FaceTime", "team": ""}
SIRI = {"id": "/System/Library/PrivateFrameworks/CoreSpeech.framework/corespeechd", "name": "corespeechd",
        "pid": 791, "signed": True, "signing_id": "com.apple.corespeechd", "team": ""}
LISTENER = {"id": "/Users/x/.local/share/uv/tools/mlx-whisper/bin/python3", "name": "python3", "pid": 13,
            "signed": True, "signing_id": "org.python.python", "team": ""}
ROOM = {"id": "/Users/x/code/chewbacca/mac/room-capture/.build/release/room-capture", "name": "room-capture",
        "pid": 15, "signed": False, "signing_id": "", "team": ""}
# Forgeries: a script that names itself zoom, a fake zoom.us.app with Zoom's
# bundle id but ad hoc signed, one signed by someone else's team, one whose
# signature broke after launch, and odd types where strings belong.
FAKE_NAME = {"id": "/tmp/zoom.us", "name": "zoom.us", "pid": 20, "signed": True, "signing_id": "zoom.us", "team": ""}
FAKE_BUNDLE = {**ZOOM, "pid": 21, "signed": True, "team": "", "signing_id": "a.out"}
WRONG_TEAM = {**ZOOM, "pid": 22, "team": "ABCDE12345"}
INVALID = {**ZOOM, "pid": 23, "signed": False}
ODD_TYPES = {"id": ["us.zoom.xos"], "team": "BJ4HAAB9B3", "signed": "true"}
PADDED = {**ZOOM, "id": "us.zoom.xos ", "pid": 24}
MEET_TITLE = {"app": "com.google.Chrome", "title": "Meet - abc-defg-hij"}
HOSTILE_TITLE = {"app": "us.zoom.xos", "title": "Zoom Meeting $(rm -rf ~) ../../etc"}


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
    # what counts: only a signed work call app
    zoom = AP.meeting_in(snap(ZOOM, SIRI))
    check("Zoom holding the mic under Zoom's own signature is a meeting, named", zoom and zoom["name"] == "Zoom", zoom)
    check("Teams under Microsoft's Team ID is a meeting", (AP.meeting_in(snap(TEAMS)) or {}).get("name")
          == "Microsoft Teams")
    for name, row in (("a process that only names itself zoom.us", FAKE_NAME),
                      ("a fake zoom.us.app with Zoom's bundle id, ad hoc signed", FAKE_BUNDLE),
                      ("Zoom's bundle id signed by another team", WRONG_TEAM),
                      ("Zoom's bundle id with a signature that no longer validates", INVALID),
                      ("strings replaced by a list and a 'true' string", ODD_TYPES),
                      ("Zoom's bundle id with a trailing space", PADDED)):
        check(f"forged process: {name} never records", AP.meeting_in(snap(row)) is None)
    check("Siri's corespeechd holding the mic is never a meeting (measured on this Mac 2026-10-10)",
          AP.meeting_in(snap(SIRI)) is None)
    check("Chewbacca's own listener and its own capture helper never count", AP.meeting_in(snap(LISTENER, ROOM)) is None)
    check("a browser on the mic with a Meet title on screen never records: a page sets its own title",
          AP.meeting_in(snap(CHROME, windows=[MEET_TITLE])) is None)
    check("a hostile title beside a forged zoom changes nothing",
          AP.meeting_in(snap(FAKE_NAME, windows=[HOSTILE_TITLE])) is None)
    check("FaceTime is a personal call and never records on its own", AP.meeting_in(snap(FACETIME)) is None)
    check("a calendar event with no call cannot start a recording: the policy takes no calendar at all",
          AP.meeting_in.__code__.co_argcount == 1 and AP.meeting_in(snap()) is None)
    check("a garbage snapshot is no meeting", AP.meeting_in({"mic": "us.zoom.xos"}) is None
          and AP.meeting_in([]) is None)
    check("every allowed app has a measured 10-character Team ID",
          all(AP.TEAM_ID.match(team) for _, team in AP.WORK_CALL_APPS.values()))

    # when it starts and stops
    m = AP.meeting_in(snap(ZOOM))
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
