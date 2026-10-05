"""Open or close a live surface from a sentence, with no model.

"Show my day", "what do I need to do", "open my texts", "check my inbox",
"show my tasks", "show me Karthik", "open my school space", "what's playing",
"show downloads", "close the tasks", "what replaces Notion", "show the engine
ollama-models": each names a surface in bin/lib/surfaces/
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

import json
import os
import re
import socket
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
    "notes": r"(?:notes|apple notes|latest notes|recent notes)",
    "github": r"(?:github|prs|pull requests|reviews|review requests|ci)",
    "code": r"(?:code changes|changes|diffs?|what changed|repos)",
    "meetings": r"(?:meetings|calls|meeting notes|call notes|granola|anarlog|(?:latest|recent|last) (?:meetings?|calls?))",
    # "Show me the built in hud apps" went to genui on 2026-10-05, and the
    # model drew six boxes that named two surfaces that do not exist.
    "apps": r"(?:(?:built ?in |kyber |hud )*(?:hud )?apps|(?:all )?(?:the )?surfaces|launcher|launchpad|everything (?:kyber|the hud) (?:has|can do))",
}
SHOW_SHAPES = [(name, re.compile(rf"^{SHOW} {MY}{noun}(?: (?:on|up on) (?:the )?(?:screen|glass|hud))?(?: (?:right )?now)?$"))
               for name, noun in NOUNS.items()]
EXTRA = [
    ("music", re.compile(r"^what(?:'s|s| is) (?:playing|on|this song)(?: right now)?$")),
    ("today", re.compile(r"^show(?: me)? what(?:'s|s| is) (?:on )?(?:today|my day)$")),
    ("needs-you", re.compile(
        r"^(?:what(?:'s|s| is) up|what do i (?:need|have) to do|what needs (?:me|my attention|doing)"
        r"|what should i (?:look at|do next|work on)|what(?:'s|s| is) waiting on me|anything (?:need|needs) me)"
        r"(?: today| right now| now)?$")),
    # "What did we decide", "what came out of my call": the meetings panel,
    # whose detail carries the Decisions lines and the action items.
    ("meetings", re.compile(
        r"^(?:what did (?:we|they|i) (?:decide|agree(?: on)?)(?: (?:on|in) (?:the|my|that) (?:call|meeting))?"
        r"|what came out of (?:my|the|that) (?:last )?(?:call|meeting)"
        r"|what (?:was|got) decided(?: (?:on|in) (?:the|my|that) (?:call|meeting))?)(?: today)?$")),
    ("apps", re.compile(r"^(?:what (?:apps|surfaces) (?:are there|do (?:i|you) have)|what can (?:kyber|the hud) do)(?: now)?$")),
]
SPACE = re.compile(
    r"^(?:open|switch to|go to|pull up|show|bring up|load)(?: up)? (?:my |the )?"
    r"(?P<space>school|class|classes|amber|zeutara|work|chewbacca|kit|personal|home)"
    r"(?: space| workspace| stuff| mode)?$")
SPACE_MODE = re.compile(r"^(?P<space>school|amber|zeutara|chewbacca|personal) (?:space|mode)$")
CLOSE = re.compile(
    r"^(?:close|hide|take down|dismiss|get rid of) (?:my |the )?"
    r"(?P<what>day|today|calendar|messages|texts|mail|email|inbox|conversations|tasks|to ?dos?|people|"
    r"music|player|downloads|files|needs you|notes|github|prs|code|changes|meetings|calls|granola|"
    r"all(?: the)? surfaces|surfaces|everything)(?: surface| panel)?$")
CLOSE_NAMES = {"day": "today", "calendar": "today", "texts": "conversations", "messages": "conversations",
               "mail": "conversations", "email": "conversations", "inbox": "conversations",
               "player": "music", "downloads": "files", "needs you": "needs-you", "todo": "tasks",
               "todos": "tasks", "to do": "tasks", "to dos": "tasks", "prs": "github", "changes": "code",
               "calls": "meetings", "granola": "meetings"}
# "Show me Karthik", "pull up Sagar Tiwari": a name, cased as a name, after a
# show verb. Lowercase words never count, so "show me the weather" is not a
# person before the graph is even asked.
PERSON = re.compile(r"^(?i:ok(?:ay)?,? |hey,? )?(?i:show me|pull up|bring up|open up|open)\s+"
                    r"(?P<name>[A-Z][a-zA-Z'-]+(?: [A-Z][a-zA-Z'-]+)?)(?:'s stuff)?[.!?]?$")
# "What replaces Notion": the oss panel with its query seeded. The app name is
# only ever a lookup key in the registry, never a command or a URL.
OSS_QUERY = re.compile(r"^what (?:replaces|can replace|is an open source alternative to) (?P<app>[a-z' ]+)$")
# "Show the engine ollama-models": read off the raw sentence, because _norm
# drops the digits and hyphens an engine id is made of.
ENGINE = re.compile(r"^(?:(?:ok|okay|hey|kyber),? )?show (?:me )?(?:the )?engine (?P<id>[a-z0-9-]+)[.!?]?$")
NOT_PEOPLE = {"google", "chrome", "terminal", "safari", "sheets", "finder", "spotify", "notion", "slack",
              "messages", "mail", "calendar", "kyber", "chewbacca", "amber", "youtube", "claude", "gmail",
              "github", "notes", "granola", "anarlog"}


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
    m = OSS_QUERY.match(s)
    # An app name is a word or four; "what replaces Notion and email Sam" has a
    # second half no panel does, so it goes to the model.
    if m and len(m.group("app").split()) <= 4 and not re.search(r"\b(?:and|then|also|but)\b", m.group("app")):
        return Command("open", "oss", m.group("app").strip())
    m = ENGINE.match(said.strip().lower())
    if m:
        return Command("open", "engine", m.group("id"))
    m = PERSON.match(said.strip())
    if m and m.group("name").split()[0].lower() not in NOT_PEOPLE:
        pid = resolve_person(m.group("name"))
        if pid:
            return Command("open", "person", pid)
    return None


def open_with_preset(name: str, preset: dict, run=subprocess.run, ask=None) -> bool:
    """Open a surface with pointers already set. The CLI's `open` has no way to
    pass a preset, so this starts the daemon through the CLI and then sends
    the same `open` body the daemon's own pivots use, over its socket."""
    try:
        started = run([str(KYBER_SURFACES), "start"], capture_output=True, text=True, timeout=CLI_TIMEOUT_S)
    except (OSError, subprocess.TimeoutExpired):
        return False
    if started.returncode != 0:
        return False
    reply = (ask or _ask)({"cmd": "open", "name": name, "preset": preset})
    return bool(reply and reply.get("ok"))


def _ask(body: dict) -> dict | None:
    bob = Path(os.environ.get("BOB_DIR", str(Path.home() / ".bob")))
    path = os.environ.get("KYBER_SURFACES_SOCK", str(bob / "surfaces.sock"))
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(CLI_TIMEOUT_S)
            s.connect(path)
            s.sendall((json.dumps(body) + "\n").encode("utf-8"))
            buffer = b""
            while b"\n" not in buffer:
                chunk = s.recv(65536)
                if not chunk:
                    break
                buffer += chunk
        return json.loads(buffer.split(b"\n", 1)[0]) if buffer else None
    except (OSError, ValueError):
        return None


def perform(command: Command, run=subprocess.run, ask=None) -> Outcome:
    if command.verb == "open" and command.name == "oss" and command.arg:
        if open_with_preset("oss", {"/oss/q": command.arg}, run=run, ask=ask):
            return Outcome(True, f"Here's what replaces {command.arg}.")
        return Outcome(False, "That surface didn't open.")
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
              "files": "Downloads are up.", "needs-you": "Here's what needs you.", "person": "They're up.",
              "oss": "The alternatives are up.", "engine": "The engine's up.",
              "code": "What changed is up.", "notes": "Your notes are up.", "github": "GitHub's up.",
              "meetings": "Your meetings are up."}
    return Outcome(True, spoken.get(command.name, "It's up."))
