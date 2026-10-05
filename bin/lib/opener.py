"""Open a new Terminal window, a new Chrome window or Google Sheets, with no model.

THE MEASUREMENT. The voice log to 2026-09-27 holds 15 slow requests that
start with "open", 6.8 s at the median. "Open a new terminal window" took
3.9 to 6.8 s across three tries and the answer each time was "Terminal's
open."; "Open up Google sheets" took 9.9 s for "It's up." The words said
exactly what to do, and doing it is one AppleScript call.

WHOLE UTTERANCES ONLY. The sentence has to be one of the shapes below from
end to end. "Open up the Gavin Jay Monroe get hub Rea. We need to do some
work on it" is a task and "OK now open Google sheets and label it Valencia"
has a second half this cannot do, so both return None and go to the model.
A parser that grabbed them would do the wrong half instantly.

`parse` reads and never acts: tests/voice_cases.py and `fast_path` in
hud-listen replay every logged sentence through it. `perform` acts.
"""
from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass

SHEETS_HOME = "https://docs.google.com/spreadsheets/"
SHEETS_NEW = "https://sheets.new"

# Guessed, never measured: `do script` and `make new window` return once the
# window exists, which is well under a second warm and a few seconds when the
# app has to launch.
OSASCRIPT_TIMEOUT_S = 10.0


@dataclass
class Command:
    kind: str            # "terminal", "chrome" (a new window) or "tab" (a tab in Chrome)
    url: str = ""
    # "on my monitor screen" was said and cannot be honoured yet.
    screen: bool = False


@dataclass
class Outcome:
    ok: bool
    line: str


def _norm(said: str) -> str:
    s = said.lower().replace("’", "'")
    s = re.sub(r"[^a-z' ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    # Lead-ins that carry no instruction: "OK now open ...".
    s = re.sub(r"^((ok|okay|so|hey|um|uh|now|please|can you|could you)\s+)+", "", s)
    s = re.sub(r"\s+please$", "", s)
    return s


OPEN = r"(?:open|open up|pull up|bring up)"
# "Open a new terminal war" on 2026-09-27 was "window" misheard. A bare
# "open terminal" is left alone: with Terminal already running it most
# likely means "show me the one I have", and a new window is the wrong answer.
TERMINAL = re.compile(
    rf"^{OPEN} (?:a |another )?(?:(?:new )terminal(?: window| war)?|terminal (?:window|war))$")
SCREEN = r"(?: on (?:my|the) (?:monitor|laptop|other|big|second) (?:screen|monitor|display))?"
CHROME = r"(?:a |another )?(?:new )?(?:google )?chrome window"
SHEETS = r"(?:google )?(?:sheets|google sheet)"
NEW_SHEET = r"(?:a )?(?:new )?(?:google )?(?:sheet|spreadsheet)(?: going)?"
CHROME_ONLY = re.compile(rf"^{OPEN} {CHROME}{SCREEN}$")
# "Open up a new Google Chrome window and pull up sheets", 2026-09-27.
CHROME_SHEETS = re.compile(rf"^{OPEN} {CHROME} (?:and|to|with) (?:pull up|open|open up|bring up|get) {SHEETS}$")
# "Open up a new chrome window to get a Google sheet going", 2026-09-27.
CHROME_NEW_SHEET = re.compile(rf"^{OPEN} {CHROME} (?:and|to) (?:start|get|make|open) {NEW_SHEET}$")
SHEETS_ONLY = re.compile(rf"^{OPEN} {SHEETS}$")


def parse(said: str) -> Command | None:
    """The command `said` asks for, or None when it is anything else."""
    s = _norm(said)
    if not s:
        return None
    if TERMINAL.match(s):
        return Command("terminal")
    if CHROME_ONLY.match(s):
        return Command("chrome", screen=" on " in s)
    if CHROME_SHEETS.match(s):
        return Command("chrome", SHEETS_HOME)
    if CHROME_NEW_SHEET.match(s):
        return Command("chrome", SHEETS_NEW)
    if SHEETS_ONLY.match(s):
        return Command("tab", SHEETS_HOME)
    return None


# `do script ""` opens a window in the Terminal already running, so the new
# shell takes Terminal's environment and not the listener's (the 2026-09-20
# FORCE_COLOR leak came from `open -a Terminal -n`, a second instance). On a
# cold start Terminal opens its own first window, and `do script` would add
# a second, so launching is enough.
TERMINAL_SCRIPT = '''
if application "Terminal" is running then
  tell application "Terminal"
    do script ""
    activate
  end tell
else
  tell application "Terminal" to activate
end if
'''

CHROME_SCRIPT = '''
on run argv
  tell application "Google Chrome"
    make new window
    if (item 1 of argv) is not "" then set URL of active tab of front window to (item 1 of argv)
    activate
  end tell
end run
'''


def _run(argv: list[str]) -> bool:
    try:
        return subprocess.run(argv, capture_output=True, text=True,
                              timeout=OSASCRIPT_TIMEOUT_S).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def perform(command: Command, run=_run) -> Outcome:
    """Do it and say how it went, in a line short enough to speak."""
    if command.kind == "terminal":
        if run(["osascript", "-e", TERMINAL_SCRIPT]):
            return Outcome(True, "Terminal's open.")
        return Outcome(False, "Terminal didn't open.")
    if command.kind == "chrome":
        if not run(["osascript", "-e", CHROME_SCRIPT, command.url]):
            return Outcome(False, "Chrome didn't open a window.")
        if command.url == SHEETS_NEW:
            return Outcome(True, "New sheet's up in a new window.")
        if command.url:
            return Outcome(True, "New window's up with Sheets.")
        if command.screen:
            return Outcome(True, "Chrome window's up. Picking the screen isn't built yet.")
        return Outcome(True, "Chrome window's up.")
    if run(["open", "-a", "Google Chrome", command.url]):
        return Outcome(True, "Sheets is up.")
    return Outcome(False, "Chrome didn't open Sheets.")
