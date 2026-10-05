"""Open or close a live surface from a sentence, with no model.

"Show my day", "what do I need to do", "open my texts", "check my inbox",
"show my tasks", "show me Karthik", "open my school space", "what's playing",
"show downloads", "close the tasks": each names a surface in bin/lib/surfaces/
and the action is `kyber-surfaces open` or `close`. Working that out with a
model costs seconds the sentence already paid for.

WHOLE UTTERANCES ONLY, as bin/lib/opener.py and agenda.py. "Show my texts from
Sam and reply that I'm late" has a second half no surface does, so it is None
and goes to the model. "What do I have today" stays with agenda.py, which says
the day aloud; "show my day" puts it on the glass.

A PERSON is matched only when the words after "show me" are a name the OS
graph resolves to exactly one person (osgraph_walks.find_person): "show me the
weather" is not a person, and "show me Tyler" is two people, so both go to the
model, which can ask. Reading the graph is read only.

`parse` reads and never acts: `fast_path` in hud-listen replays every logged
sentence through it. `perform` runs the CLI.
"""
from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

KYBER_SURFACES = Path(__file__).resolve().parent.parent / "kyber-surfaces"
HUD_MUSIC = Path(__file__).resolve().parent.parent / "hud-music"
# Opening starts the daemon when it is not running, then draws; the first
# walk is not waited on. Guessed, never measured: ten seconds only covers a
# machine under load.
CLI_TIMEOUT_S = 10.0


@dataclass
class Command:
    verb: str   # "open", "close" or "space"
    name: str   # a surface kind, a space, or "all"
    arg: str = ""


@dataclass
class Outcome:
    ok: bool
    line: str


def _norm(said: str) -> str:
    s = said.lower().replace("’", "'")
    s = re.sub(r"[^a-z' ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"^((ok|okay|so|hey|um|uh|now|please|can you|could you|kyber)\s+)+", "", s)
    s = re.sub(r"\s+please$", "", s)
    return s


SHOW = r"(?:show(?: me)?|open(?: up)?|pull up|bring up|put up|check|get)"
MY = r"(?:my |the |me my )?"
NOUNS = {
    "today": r"(?:day|today|calendar|schedule|agenda)",
    "conversations": r"(?:messages|texts|imessages?|text messages|mail|email|emails|inbox|gmail|conversations|convos)",
    "tasks": r"(?:tasks|to ?dos?|to do list|lanes)",
    "people": r"(?:people|contacts|friends)",
    "music": r"(?:music|player|spotify|song)",
    "files": r"(?:downloads|files|download folder|downloads folder|recent files)",
    "needs-you": r"(?:needs you|what needs me|inbox zero)",
}
SHOW_SHAPES = [(name, re.compile(rf"^{SHOW} {MY}{noun}(?: (?:on|up on) (?:the )?(?:screen|glass|hud))?$"))
               for name, noun in NOUNS.items()]
EXTRA = [
    ("music", re.compile(r"^what(?:'s|s| is) (?:playing|on|this song)(?: right now)?$")),
    ("today", re.compile(r"^show(?: me)? what(?:'s|s| is) (?:on )?(?:today|my day)$")),
    ("needs-you", re.compile(
        r"^(?:what(?:'s|s| is) up|what do i (?:need|have) to do|what needs (?:me|my attention|doing)"
        r"|what should i (?:look at|do next|work on)|what(?:'s|s| is) waiting on me|anything (?:need|needs) me)"
        r"(?: today| right now| now)?$")),
]
SPACE = re.compile(
    r"^(?:open|switch to|go to|pull up|show|bring up|load)(?: up)? (?:my |the )?"
    r"(?P<space>school|class|classes|amber|zeutara|work|chewbacca|kit|personal|home)"
    r"(?: space| workspace| stuff| mode)?$")
SPACE_MODE = re.compile(r"^(?P<space>school|amber|zeutara|chewbacca|personal) (?:space|mode)$")
CLOSE = re.compile(
    r"^(?:close|hide|take down|dismiss|get rid of) (?:my |the )?"
    r"(?P<what>day|today|calendar|messages|texts|mail|email|inbox|conversations|tasks|to ?dos?|people|"
    r"music|player|downloads|files|needs you|all(?: the)? surfaces|surfaces|everything)(?: surface| panel)?$")
CLOSE_NAMES = {"day": "today", "calendar": "today", "texts": "conversations", "messages": "conversations",
               "mail": "conversations", "email": "conversations", "inbox": "conversations",
               "player": "music", "downloads": "files", "needs you": "needs-you", "todo": "tasks",
               "todos": "tasks", "to do": "tasks", "to dos": "tasks"}
# "Show me Karthik", "pull up Sagar Tiwari": a name, cased as a name, after a
# show verb. Lowercase words never count, so "show me the weather" is not a
# person before the graph is even asked.
PERSON = re.compile(r"^(?i:ok(?:ay)?,? |hey,? )?(?i:show me|pull up|bring up|open up|open)\s+"
                    r"(?P<name>[A-Z][a-zA-Z'-]+(?: [A-Z][a-zA-Z'-]+)?)(?:'s stuff)?[.!?]?$")
NOT_PEOPLE = {"google", "chrome", "terminal", "safari", "sheets", "finder", "spotify", "notion", "slack",
              "messages", "mail", "calendar", "kyber", "chewbacca", "amber", "youtube", "claude", "gmail"}


def find_person(name: str):
    """The graph's person for `name`, or None. Read only; any failure is None."""
    try:
        import osgraph  # noqa: PLC0415  bin/lib, loaded only when a name-shaped sentence arrives
        import osgraph_walks  # noqa: PLC0415

        path = osgraph.default_path()
        if not path.exists():
            return None
        pid, _ = osgraph_walks.find_person(osgraph.Graph(path), osgraph.Identities(), name)
        return pid
    except Exception:  # noqa: BLE001  not a person is the honest answer to any failure here
        return None


def parse(said: str, resolve_person=find_person) -> Command | None:
    """The surface command `said` asks for, or None for anything else."""
    s = _norm(said)
    if not s:
        return None
    m = CLOSE.match(s)
    if m:
        what = m.group("what")
        if what.startswith("all") or what in ("surfaces", "everything"):
            return Command("close", "all")
        return Command("close", CLOSE_NAMES.get(what, what))
    m = SPACE.match(s) or SPACE_MODE.match(s)
    # "open my work" without "space" is too loose to mean a set of panels, so
    # the bare form needs "space", "mode" or one of the unambiguous names.
    if m and (s.endswith((" space", " workspace", " mode")) or m.group("space") in ("school", "amber", "zeutara")):
        return Command("space", m.group("space"))
    for name, shape in SHOW_SHAPES + EXTRA:
        if shape.match(s):
            return Command("open", name)
    m = PERSON.match(said.strip())
    if m and m.group("name").split()[0].lower() not in NOT_PEOPLE:
        pid = resolve_person(m.group("name"))
        if pid:
            return Command("open", "person", pid)
    return None


def perform(command: Command, run=subprocess.run) -> Outcome:
    argv = [str(KYBER_SURFACES), command.verb, command.name] + ([command.arg] if command.arg else [])
    try:
        done = run(argv, capture_output=True, text=True, timeout=CLI_TIMEOUT_S)
    except (OSError, subprocess.TimeoutExpired):
        return Outcome(False, "The surfaces didn't answer.")
    if done.returncode != 0:
        return Outcome(False, "That surface didn't open.")
    if command.verb == "close":
        return Outcome(True, "Closed." if command.name != "all" else "Cleared.")
    if command.verb == "space":
        return Outcome(True, f"{command.name.capitalize()} space is up.")
    if command.name == "music":
        try:
            now = run([str(HUD_MUSIC), "now"], capture_output=True, text=True, timeout=CLI_TIMEOUT_S)
            line = (now.stdout or "").strip()
            if line:
                return Outcome(True, line)
        except (OSError, subprocess.TimeoutExpired):
            pass
    spoken = {"today": "Your day's up.", "conversations": "Your conversations are up.",
              "tasks": "Your tasks are up.", "people": "Your people are up.", "music": "The player's up.",
              "files": "Downloads are up.", "needs-you": "Here's what needs you.", "person": "They're up."}
    return Outcome(True, spoken.get(command.name, "It's up."))
