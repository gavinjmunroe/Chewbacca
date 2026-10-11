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
so it says yes only on evidence, and uses an allow list rather than Anarlog's
deny list. The deny list would miss Chewbacca's own always-on listener
(hud-listen) and Plynn, which hold the mic all day:

1. A work call app (Zoom, Teams, Webex, Slack huddles) holding the mic: a meeting.
2. A browser holding the mic: a meeting only while a meeting window is on
   screen ("Meet - abc-defg-hij", "Zoom Meeting"...) or a calendar event with a
   call link or another attendee is happening now.
3. A personal call app (FaceTime, iPhone, WhatsApp, Discord, Telegram, Signal,
   Messenger, LINE, KakaoTalk): a meeting only while such a calendar event is
   happening now. A call with family is not a meeting.
4. Anything else, including Chewbacca's own capture, never.

When room-capture is already running because someone pressed Start, this
never stops it; when someone presses Stop on a recording this started, it
stays stopped until that call ends.
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timedelta, timezone

# Anarlog's DEFAULT_MIC_ACTIVE_THRESHOLD_SECS (plugins/detect/src/mic_usage_tracker.rs).
START_AFTER_S = 15.0
# Anarlog confirms an auto stop 5 s after the trigger app lets go
# (AUTO_STOP_CONFIRM_DELAY_MS, apps/desktop/src/stt/auto-stop.ts), then looks
# again. One look every 2 s here, so 20 s gives ten looks before stopping and
# rides out a call app that reopens its mic when the person switches
# headphones. Guessed, never measured on a real call.
STOP_AFTER_S = 20.0
# A calendar event counts from 5 minutes before its start
# (AUTO_STOP_CALENDAR_EARLY_START_BUFFER_MS) to 10 minutes after its end
# (AUTO_STOP_EVENT_END_GRACE_MS), Anarlog's own windows.
EARLY_START = timedelta(minutes=5)
END_GRACE = timedelta(minutes=10)

# Work call apps: holding the mic is the meeting. Ids from Anarlog's
# meeting-apps.ts.
WORK_CALL_APPS = {
    "us.zoom.xos": "Zoom",
    "com.microsoft.teams": "Microsoft Teams",
    "com.microsoft.teams2": "Microsoft Teams",
    "com.cisco.webex": "Webex",
    "com.cisco.webexmeetingsapp": "Webex",
    "Cisco-Systems.Spark": "Webex",
    "com.tinyspeck.slackmacgap": "Slack",
    "com.slack.Slack": "Slack",
}
# Personal call apps: a meeting only with a calendar event. Ids from the same
# file; com.apple.mobilephone is what the helper relabels Apple's call daemon
# to while the Phone app runs.
PERSONAL_CALL_APPS = {
    "com.apple.FaceTime": "FaceTime",
    "com.apple.mobilephone": "iPhone call",
    "net.whatsapp.WhatsApp": "WhatsApp",
    "com.hnc.Discord": "Discord",
    "com.discordapp.Discord": "Discord",
    "ru.keepcoder.Telegram": "Telegram",
    "ru.keepcoder.TelegramLite": "Telegram",
    "org.whispersystems.signal-desktop": "Signal",
    "com.facebook.archon": "Messenger",
    "jp.naver.line.mac": "LINE",
    "com.kakao.KakaoTalkMac": "KakaoTalk",
}
# Anarlog's BROWSER_AUTO_STOP_APP_IDS, the macOS bundle ids.
BROWSERS = {
    "at.studio.AsideBrowser", "app.zen-browser.zen", "ai.perplexity.comet", "com.apple.Safari",
    "com.apple.SafariTechnologyPreview", "com.browseros.BrowserOS", "com.brave.Browser",
    "com.brave.Browser.beta", "com.brave.Browser.nightly", "com.duckduckgo.macos.browser",
    "com.google.Chrome", "com.google.Chrome.canary", "com.kagi.kagimacOS", "com.kagi.kagimacOS.RC",
    "com.microsoft.edgemac", "com.microsoft.edgemac.Beta", "com.microsoft.edgemac.Canary",
    "com.microsoft.edgemac.Dev", "com.operasoftware.Opera", "com.operasoftware.OperaDeveloper",
    "com.operasoftware.OperaGX", "com.operasoftware.OperaNext", "com.nousresearch.hermes",
    "com.sigmaos.sigmaos.macos", "com.vivaldi.Vivaldi", "company.thebrowser.Browser",
    "company.thebrowser.dia", "net.imput.helium", "net.mullvad.mullvadbrowser", "net.waterfox.waterfox",
    "org.chromium.Chromium", "org.mozilla.firefox", "org.mozilla.firefoxdeveloperedition",
    "org.mozilla.librewolf", "org.mozilla.nightly", "org.torproject.torbrowser",
}
# A link in an event's location, notes or url that makes it a call.
CALL_LINK = re.compile(r"(zoom\.us/|meet\.google\.com/|teams\.microsoft\.com/|teams\.live\.com/|webex\.com/|"
                       r"whereby\.com/|meet\.jit\.si/|around\.co/|facetime\.apple\.com/|cal\.com/video|"
                       r"app\.slack\.com/huddle)", re.I)


def parse_iso(stamp) -> datetime | None:
    if not stamp:
        return None
    try:
        moment = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def is_call_event(event: dict, me: set[str] | frozenset = frozenset()) -> bool:
    """A calendar event that is a call: it carries a call link, or someone
    other than the owner is invited. A lecture block on the calendar is
    neither, so it never turns a browser's mic into a recording."""
    if not isinstance(event, dict) or event.get("isAllDay"):
        return False
    text = " ".join(str(event.get(k) or "") for k in ("location", "notes", "url", "conferenceUrl", "description"))
    if CALL_LINK.search(text):
        return True
    for person in event.get("attendees") or []:
        email = str((person.get("email") if isinstance(person, dict) else person) or "").lower()
        if email and email not in me:
            return True
    return False


def event_now(events: list[dict] | None, now: datetime, me: set[str] | frozenset = frozenset()) -> dict | None:
    """The call event happening at `now`, with Anarlog's buffers, or None."""
    for event in events or []:
        start, end = parse_iso(event.get("start")), parse_iso(event.get("end"))
        if start is None or end is None:
            continue
        if start - EARLY_START <= now <= end + END_GRACE and is_call_event(event, me):
            return event
    return None


def meeting_in(snapshot: dict, event: dict | None) -> dict | None:
    """What makes this moment a meeting, or None. {"id", "name", "why"}."""
    mic = snapshot.get("mic") or []
    windows = snapshot.get("windows") or []
    for app in mic:
        app_id = str(app.get("id") or "")
        if app_id in WORK_CALL_APPS:
            return {"id": app_id, "name": WORK_CALL_APPS[app_id], "why": f"{WORK_CALL_APPS[app_id]} is using the mic"}
    for app in mic:
        app_id = str(app.get("id") or "")
        if app_id in BROWSERS:
            window = next((w for w in windows if w.get("app") == app_id), None) \
                or next((w for w in windows if w.get("app") in BROWSERS), None)
            if window:
                return {"id": app_id, "name": str(app.get("name") or "Browser"),
                        "why": f"a meeting tab is open ({str(window.get('title') or '')[:60]})"}
            if event is not None:
                return {"id": app_id, "name": str(app.get("name") or "Browser"),
                        "why": f"{str(event.get('title') or 'a calendar call')[:60]} is happening now"}
    for app in mic:
        app_id = str(app.get("id") or "")
        if app_id in PERSONAL_CALL_APPS and event is not None:
            return {"id": app_id, "name": PERSONAL_CALL_APPS[app_id],
                    "why": f"{str(event.get('title') or 'a calendar call')[:60]} is happening now"}
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


def snapshot_of(line: str) -> dict | None:
    try:
        body = json.loads(line)
    except ValueError:
        return None
    return body if isinstance(body, dict) else None


def owner_emails(home) -> set[str]:
    try:
        body = json.loads((home / ".chewbacca" / "meetings.json").read_text())
    except (OSError, ValueError):
        return set()
    return {str(x).lower() for x in body.get("me") or [] if isinstance(x, str) and "@" in x}


def env_flag(name: str, env: dict | None = None) -> bool:
    return str((env if env is not None else os.environ).get(name, "")).strip().lower() in {"0", "off", "no", "false"}
