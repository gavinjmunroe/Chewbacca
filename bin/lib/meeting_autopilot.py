"""meeting_autopilot: start recording when a meeting starts, stop when it ends.

Caleb, 2026-10-10: "Ofc star and stop on itself!!!!!!!!", and "I never wanna
use granola again". Nobody presses anything.

HOW A MEETING IS NOTICED. Ported from Anarlog (MIT, Copyright (c)
2023-present Fastrepl, Inc., github.com/fastrepl/anarlog):

- crates/detect lists the apps whose Core Audio process object has
  IsRunningInput set. mac/room-capture --watch-mic does that read in Swift
  and prints a line on every change; this module reads those lines.
- plugins/detect/src/mic_usage_tracker.rs waits until an app has held the mic
  for DEFAULT_MIC_ACTIVE_THRESHOLD_SECS = 15 before calling it a meeting, so a
  voice memo or a quick dictation never trips it. START_AFTER_S is that 15.
- apps/desktop/src/stt/auto-stop.ts stops once the app that triggered the
  recording lets go of the mic, after AUTO_STOP_CONFIRM_DELAY_MS and a second
  look. STOP_AFTER_S is the delay here.
- apps/desktop/src/stt/meeting-apps.ts and plugins/detect/src/policy.rs list
  the call apps, the browsers, and the apps never to count (dictation, IDEs,
  screen recorders, AI assistants, itself).

WHERE THIS IS STRICTER THAN ANARLOG. Anarlog asks "Are you in a meeting?"
with a notification and records only on a press. This records with no press,
so it records only on evidence nobody else can forge (security review,
2026-10-10):

1. A work call app holding the mic, and only when the process holding it
   carries a valid code signature under that vendor's Team ID, with that
   exact bundle id. A name, a path, an Info.plist or a process title can be
   made by anyone; Zoom's signature cannot. Unknown, unsigned or mismatched:
   no recording.
2. Nothing else. A calendar event never starts a recording (anyone can put
   one on Caleb's calendar), a window or tab title never does (any web page
   sets its own), and a browser or a personal call app (FaceTime, WhatsApp,
   Discord) never does. Those calls are recorded with the Start press on the
   meetings panel. The calendar only names a meeting afterwards
   (meeting_capture.finish).

Allow list, not Anarlog's deny list: Siri's corespeechd and Chewbacca's own
listener hold the mic all day (seen 2026-10-10), and a deny list counts them.

When room-capture is already running because someone pressed Start, this
never stops it; when someone presses Stop on a recording this started, it
stays stopped until that call ends.
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime

# Anarlog's DEFAULT_MIC_ACTIVE_THRESHOLD_SECS (plugins/detect/src/mic_usage_tracker.rs).
START_AFTER_S = 15.0
# Anarlog confirms an auto stop 5 s after the trigger app lets go
# (AUTO_STOP_CONFIRM_DELAY_MS, apps/desktop/src/stt/auto-stop.ts), then looks
# again. One look every 2 s here, so 20 s gives ten looks before stopping and
# rides out a call app that reopens its mic when the person switches
# headphones. Guessed, never measured on a real call.
STOP_AFTER_S = 20.0

# Work call apps: (name, Team ID). The Team IDs were read with `codesign -dv`
# from the copies installed on Caleb's Mac on 2026-10-10. Webex and the App
# Store Slack were not installed, so their Team IDs are unmeasured and they
# are left out: unknown means no recording.
WORK_CALL_APPS = {
    "us.zoom.xos": ("Zoom", "BJ4HAAB9B3"),
    "com.microsoft.teams2": ("Microsoft Teams", "UBF8T346G9"),
    "com.microsoft.teams": ("Microsoft Teams", "UBF8T346G9"),
    "com.tinyspeck.slackmacgap": ("Slack", "BQR82RBBHL"),
}
TEAM_ID = re.compile(r"^[A-Z0-9]{10}$")


def verified_call_app(app) -> tuple[str, str] | None:
    """(bundle id, name) when this mic holder is a work call app proven by its
    code signature, else None. Every field must match exactly; a missing or
    odd-typed field is a no."""
    if not isinstance(app, dict):
        return None
    app_id, team = app.get("id"), app.get("team")
    if not isinstance(app_id, str) or not isinstance(team, str) or app.get("signed") is not True:
        return None
    known = WORK_CALL_APPS.get(app_id)
    if known is None or not TEAM_ID.match(team) or team != known[1]:
        return None
    return app_id, known[0]


def meeting_in(snapshot: dict) -> dict | None:
    """What makes this moment a meeting, or None. {"id", "name", "why"}."""
    mic = snapshot.get("mic") if isinstance(snapshot, dict) else None
    for app in mic if isinstance(mic, list) else []:
        hit = verified_call_app(app)
        if hit:
            return {"id": hit[0], "name": hit[1], "why": f"{hit[1]} (signed by its vendor) is using the mic"}
    return None


class Autopilot:
    """The state machine, with no clock, process or file of its own, so the
    tests drive it with fixture snapshots.

    phase: idle, arming (a meeting seen, waiting START_AFTER_S), recording,
    ending (the meeting gone, waiting STOP_AFTER_S), held (someone pressed
    Stop on a recording this started: stay off until the call ends)."""

    def __init__(self) -> None:
        self.phase = "idle"
        self.since: datetime | None = None
        self.trigger: dict | None = None

    def state(self) -> dict:
        return {"phase": self.phase, "since": self.since.isoformat() if self.since else None,
                "trigger": self.trigger}

    def _go(self, phase: str, now: datetime, trigger: dict | None = None) -> None:
        self.phase, self.since = phase, now
        if trigger is not None or phase == "idle":
            self.trigger = trigger

    def step(self, meeting: dict | None, capture_running: bool, ours: bool, now: datetime) -> str | None:
        """One look. Returns "start", "stop" or None."""
        if capture_running and not ours:
            # Someone pressed Start themselves: theirs to stop.
            self._go("idle", now)
            return None
        if self.phase in ("recording", "ending") and not capture_running:
            # It stopped without us: the Stop press, or the helper died.
            # Either way not again for this call.
            self._go("held", now, self.trigger)
        if self.phase == "held":
            if meeting is None:
                self._go("idle", now)
            return None
        if self.phase == "idle":
            if meeting is not None:
                self._go("arming", now, meeting)
            return None
        if self.phase == "arming":
            if meeting is None:
                self._go("idle", now)
                return None
            if (now - self.since).total_seconds() >= START_AFTER_S:
                self._go("recording", now, meeting)
                return "start"
            return None
        if self.phase == "recording":
            if meeting is None:
                self._go("ending", now)
            return None
        if self.phase == "ending":
            if meeting is not None:
                self._go("recording", now)
                return None
            if (now - self.since).total_seconds() >= STOP_AFTER_S:
                self._go("idle", now)
                return "stop"
        return None


class Unparseable(ValueError):
    pass


def _strict_pairs(pairs):
    seen = {}
    for key, value in pairs:
        if key in seen:
            # Python keeps the last of two equal keys and other readers keep
            # the first, so a line carrying both "signed": false and
            # "signed": true would mean one thing to one reader and the
            # opposite to another. One line, one meaning, or no meaning.
            raise Unparseable(f"duplicate key {key!r}")
        seen[key] = value
    return seen


def _no_constant(name):
    raise Unparseable(f"non-JSON constant {name}")


def snapshot_of(line: str) -> dict:
    """The one parse of a --watch-mic line, which both the check and the
    action read. Anything that is not exactly one JSON object with a list of
    objects under "mic" reads as a snapshot with nobody on the mic: unknown
    means no recording, never "keep what was there before"."""
    try:
        body = json.loads(line, object_pairs_hook=_strict_pairs, parse_constant=_no_constant)
    except (ValueError, RecursionError):
        return {"mic": [], "unparseable": True}
    if not isinstance(body, dict) or not isinstance(body.get("mic"), list) \
            or not all(isinstance(row, dict) for row in body["mic"]):
        return {"mic": [], "unparseable": True}
    return body


def env_flag(name: str, env: dict | None = None) -> bool:
    return str((env if env is not None else os.environ).get(name, "")).strip().lower() in {"0", "off", "no", "false"}
