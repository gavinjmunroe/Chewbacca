"""Voice route for "press Remove from Mac in Photos" and "in Calculator, clear it".

parse() only reads: it decides whether a sentence names an installed app and
an action, so fast_path() can replay logged sentences without touching
anything. perform() starts `chewie app ask`, which shows the picked control on
the glass and presses only after the person taps Press it.

The intent has to open with an action verb and the app has to be an installed
app by its exact name, because "what's the weather in Paris" and "set up a
meeting in Notion" otherwise read the same shape.
"""
from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

ROOT = Path(__file__).resolve().parents[2]
CHEWIE = ROOT / "mac" / "bin" / "chewie"

VERBS = (
    "press", "click", "tap", "hit", "turn on", "turn off", "toggle", "clear", "select", "check",
    "uncheck", "choose", "pick", "switch", "enable", "disable", "open the", "close the", "show the",
    "hide the", "scroll", "type", "fill", "start", "stop", "pause", "play", "skip", "mute", "unmute",
)
APP_DIRS = ("/Applications", "/System/Applications", "/System/Applications/Utilities",
            str(Path.home() / "Applications"))

_LEAD = r"^(?:(?:hey|yo|ok)\s+)?(?:chewie|chewbacca)?[,\s]*"
APP_FIRST = re.compile(_LEAD + r"(?:in|on)\s+(?P<app>[\w .&'-]+?)\s*,\s*(?P<intent>.+?)[.!?]?$", re.I)
APP_LAST = re.compile(_LEAD + r"(?P<intent>.+?)\s+(?:in|on)\s+(?P<app>[\w .&'-]+?)[.!?]?$", re.I)


@dataclass(frozen=True)
class Command:
    app: str
    intent: str


@dataclass(frozen=True)
class Outcome:
    ok: bool
    line: str


def installed_apps() -> list[str]:
    names = []
    for d in APP_DIRS:
        try:
            names += [p[:-4] for p in os.listdir(d) if p.endswith(".app")]
        except OSError:
            continue
    return names


def _match_app(name: str, apps: Iterable[str]) -> Optional[str]:
    want = name.strip().lower().removeprefix("the ").strip()
    for a in apps:
        if a.lower() == want:
            return a
    return None


def parse(said: str, apps: Optional[Iterable[str]] = None) -> Optional[Command]:
    text = " ".join(said.split())
    if not text:
        return None
    known = list(apps) if apps is not None else installed_apps()
    for pattern in (APP_FIRST, APP_LAST):
        m = pattern.match(text)
        if not m:
            continue
        app = _match_app(m.group("app"), known)
        intent = m.group("intent").strip()
        if app and intent.lower().startswith(VERBS):
            return Command(app=app, intent=intent)
    return None


def perform(cmd: Command) -> Outcome:
    """Start the ask flow detached; it owns the glass from here."""
    try:
        subprocess.Popen([str(CHEWIE), "app", "ask", cmd.app, cmd.intent],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    except OSError as err:
        return Outcome(False, f"Couldn't start on {cmd.app}: {err}")
    return Outcome(True, f"Finding that in {cmd.app}. I'll show you before I press anything.")
