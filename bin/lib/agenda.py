"""Answer "what do I have today" from the calendar, with no model.

THE MEASUREMENT. The voice log 2026-09-20 to 2026-10-03 holds "What do I have
today?" (5.6 s), "What is my schedule look like this week?" (6.7 s) and "What's
my schedule today" shapes, each a model turn that ran `mac calendar list` and
read it back. `mac calendar list --json` answers in 35 ms, so the model was the
whole wait.

WHOLE UTTERANCES ONLY, as bin/lib/opener.py. "What do I have today, and move
the Otis call to 8" has a second half this cannot do, so it goes to the model.

`parse` reads and never acts: `fast_path` in hud-listen replays every logged
sentence through it. `perform` reads the calendar and never writes it.
"""
from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from datetime import date, datetime, timedelta

# The whole list costs 35 ms warm (2026-10-03). Ten seconds only covers a cold
# Calendar permission check, never a normal read.
MAC_TIMEOUT_S = 10.0
# Spoken, so short. Past five events a list read aloud stops being heard.
MOST_SPOKEN = 5


@dataclass
class Window:
    span: str  # "today", "tomorrow" or "week"


@dataclass
class Outcome:
    ok: bool
    line: str


def _norm(said: str) -> str:
    s = said.lower().replace("’", "'")
    s = re.sub(r"[^a-z' ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"^((ok|okay|so|hey|um|uh|now|please|can you tell me|tell me)\s+)+", "", s)
    return s


ASK = (r"(?:what do i have(?: going on)?|what(?:'s|s| is| does) (?:on )?my (?:schedule|calendar|day|week)"
       r"(?: look(?:s)? like)?|what(?:'s|s| is) on (?:my calendar|the calendar|my schedule)"
       r"|what(?:'s|s| is) my schedule(?: look(?:s)? like)?|what am i doing)")
WHEN = r"(?P<when>today|tonight|tomorrow|this week|for the week)"
SHAPES = [
    re.compile(rf"^{ASK} {WHEN}$"),
    re.compile(rf"^{WHEN} what do i have$"),
    # "What does my week look like", "what's my day look like".
    re.compile(r"^what(?:'s|s| is| does) my (?P<noun>day|week) look(?:s)? like$"),
]


def parse(said: str) -> Window | None:
    """The window `said` asks about, or None when it is anything else."""
    s = _norm(said)
    for shape in SHAPES:
        m = shape.match(s)
        if not m:
            continue
        word = m.groupdict().get("when") or m.groupdict().get("noun") or ""
        if word in ("today", "tonight", "day"):
            return Window("today")
        if word == "tomorrow":
            return Window("tomorrow")
        return Window("week")
    return None


def _run(argv: list[str]) -> str | None:
    try:
        done = subprocess.run(argv, capture_output=True, text=True, timeout=MAC_TIMEOUT_S)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return done.stdout if done.returncode == 0 else None


def _local(stamp: str) -> datetime:
    return datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone()


def _clock(moment: datetime) -> str:
    text = moment.strftime("%I:%M %p").lstrip("0")
    return text.replace(":00 ", " ")


def _events(raw: str, first: date, last: date) -> list[dict]:
    try:
        rows = json.loads(raw)
    except json.JSONDecodeError:
        return []
    seen: set[tuple[str, str]] = set()
    kept = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict) or not row.get("title") or not row.get("start"):
            continue
        start = _local(row["start"])
        # An all-day event's midnight is UTC, so its local date can read as
        # the day before. Its UTC date is the day it is for.
        day = (datetime.fromisoformat(row["start"].replace("Z", "+00:00")).date()
               if row.get("isAllDay") else start.date())
        if not first <= day <= last:
            continue
        # A birthday is in both his calendar and Birthdays; say it once.
        key = (re.sub(r"[^a-z0-9]", "", row["title"].lower()), day.isoformat())
        if key in seen:
            continue
        seen.add(key)
        kept.append({"title": row["title"].strip(), "day": day,
                     "at": None if row.get("isAllDay") else start})
    kept.sort(key=lambda e: (e["day"], e["at"] is not None, e["at"].timestamp() if e["at"] else 0.0))
    return kept


def say(events: list[dict], window: Window, today: date) -> str:
    """The spoken line for these events."""
    label = {"today": "today", "tomorrow": "tomorrow", "week": "this week"}[window.span]
    if not events:
        return f"Nothing on the calendar {label}."
    parts = []
    for event in events[:MOST_SPOKEN]:
        when = _clock(event["at"]) if event["at"] else "all day"
        if window.span == "week":
            day = "today" if event["day"] == today else event["day"].strftime("%A")
            when = f"{day} {when}" if event["at"] else f"{day}"
        parts.append(f"{event['title']}, {when}")
    more = len(events) - MOST_SPOKEN
    line = f"{label.capitalize()}: " + "; ".join(parts)
    if more > 0:
        line += f"; and {more} more"
    return line + "."


def perform(window: Window, run=_run, today: date | None = None) -> Outcome:
    """Read the calendar for `window` and say it."""
    today = today or date.today()
    first = today + timedelta(days=1) if window.span == "tomorrow" else today
    last = first if window.span != "week" else today + timedelta(days=6)
    raw = run(["mac", "calendar", "list", "--from", "today", "--to", "+8d", "--json"])
    if raw is None:
        return Outcome(False, "I couldn't read the calendar.")
    return Outcome(True, say(_events(raw, first, last), window, today))
