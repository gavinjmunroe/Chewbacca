"""Open or close a live surface from a sentence, with no model.

"Show my day", "what do I need to do", "open my texts", "check my inbox",
"show my tasks", "show me Karthik", "open my school space", "what's playing",
"show downloads", "show me files" (a folder on the glass), "close the tasks", "what replaces Notion", "show the engine
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
import shutil
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


def tool(path: Path) -> str:
    """A sibling CLI, or the same name on PATH once that file is gone.
    hud-listen imports this module once and runs for hours, and the kit
    runtime replaces the snapshot these paths resolved into. On 2026-10-10
    "show my agents" answered "The agents panel didn't open." twice because
    the kyber-sessions beside this file had been pruned; ~/.local/bin links
    through the stable `current` and always names the newest copy."""
    if path.exists():
        return str(path)
    found = shutil.which(path.name) or str(Path.home() / ".local" / "bin" / path.name)
    return found


@dataclass
class Command:
    verb: str   # "open", "close", "space", or "panel" for a native HUD panel
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
    # Bare "files" is Kyber's folder surface (FILES below); downloads keep
    # their own words.
    "files": r"(?:downloads|download folder|downloads folder|recent files)",
    "needs-you": r"(?:needs you|what needs me|inbox zero)",
    "notes": r"(?:notes|apple notes|latest notes|recent notes)",
    "github": r"(?:github|prs|pull requests|reviews|review requests|ci)",
    "code": r"(?:code changes|changes|diffs?|what changed|repos)",
    "meetings": r"(?:meetings|calls|meeting notes|call notes|granola|anarlog|(?:latest|recent|last) (?:meetings?|calls?))",
    # The Realm engine's own sessions, by name only. "Show my agents" means
    # every tab Caleb has running (VS Code, desktop, the glass's own runs),
    # which is kyber-sessions' panel: SESSIONS below (2026-10-10, "make the
    # Kyber HUD the only place I work"). "Show me Claude" stays with the
    # model, which can ask whether that is a person.
    "agents": r"(?:realm sessions|realm agents|the engine's sessions)",
    # "Show me the built in hud apps" went to genui on 2026-10-05, and the
    # model drew six boxes that named two surfaces that do not exist.
    "apps": r"(?:(?:built ?in |kyber |hud )*(?:hud )?apps|(?:all )?(?:the )?surfaces|launcher|launchpad|everything (?:kyber|the hud) (?:has|can do))",
}
SHOW_SHAPES = [(name, re.compile(rf"^{SHOW} {MY}{noun}(?: (?:on|up on) (?:the )?(?:screen|glass|hud))?(?: (?:right )?now)?$"))
               for name, noun in NOUNS.items()]
EXTRA = [
    ("music", re.compile(r"^what(?:'s|s| is) (?:playing|on|this song)(?: right now)?$")),
    ("today", re.compile(r"^show(?: me)? what(?:'s|s| is) (?:on )?(?:today|my day)$")),
    # A bare "what's up" is a greeting, answered by hud-listen's pleasantry
    # before this is asked (CHW-184); only "what's up today" means the panel.
    ("needs-you", re.compile(
        r"^(?:what(?:'s|s| is) up today|what do i (?:need|have) to do|what needs (?:me|my attention|doing)"
        r"|what should i (?:look at|do next|work on)|what(?:'s|s| is) waiting on me|anything (?:need|needs) me)"
        r"(?: today| right now| now)?$")),
    # "What am I missing", "is there anything I'm missing for this week",
    # "what's about to bite me": each commitment joined to what it needs
    # (CHW-204, bin/lib/osgraph_missing.py). Ghost's launch film asks the first.
    ("missing", re.compile(
        r"^(?:what am i missing|am i missing (?:anything|something)|is there anything (?:that )?i'?m missing"
        r"|(?:is there )?anything i'?m (?:missing|forgetting)|what am i forgetting"
        r"|what(?:'s|s| is) (?:about to|gonna|going to) bite me|what could bite me|what(?:'s|s| is) slipping)"
        r"(?: (?:for )?(?:today|tomorrow|this week|this weekend|right now|now))?$")),
    # "What did we decide", "what came out of my call": the meetings panel,
    # whose detail carries the Decisions lines and the action items.
    ("meetings", re.compile(
        r"^(?:what did (?:we|they|i) (?:decide|agree(?: on)?)(?: (?:on|in) (?:the|my|that) (?:call|meeting))?"
        r"|what came out of (?:my|the|that) (?:last )?(?:call|meeting)"
        r"|what (?:was|got) decided(?: (?:on|in) (?:the|my|that) (?:call|meeting))?)(?: today)?$")),
    ("apps", re.compile(r"^(?:what (?:apps|surfaces) (?:are there|do (?:i|you) have)|what can (?:kyber|the hud) do)(?: now)?$")),
    # The rest of the install, one press each (bin/lib/surfaces/setup.py).
    # "Set up my permissions" is PERMISSIONS above, matched first.
    ("setup", re.compile(
        r"^(?:(?:finish|continue|keep) )?(?:set ?up|setting up) (?:chewbacca|kyber|everything|the rest|my mac)"
        r"|what(?:'s|s| is) left to set up|(?:show|open)(?: me)? (?:the )?set ?up(?: panel)?$")),
]
SPACE = re.compile(
    r"^(?:open|switch to|go to|pull up|show|bring up|load)(?: up)? (?:my |the )?"
    r"(?P<space>school|class|classes|amber|zeutara|work|chewbacca|kit|personal|home)"
    r"(?: space| workspace| stuff| mode)?$")
SPACE_MODE = re.compile(r"^(?P<space>school|amber|zeutara|chewbacca|personal) (?:space|mode)$")
CLOSE = re.compile(
    r"^(?:close|hide|take down|dismiss|get rid of) (?:my |the )?"
    r"(?P<what>day|today|calendar|messages|texts|mail|email|inbox|conversations|tasks|to ?dos?|people|"
    r"music|player|downloads|files|needs you|missing|notes|github|prs|code|changes|meetings|calls|granola|agents|"
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
# "Show me files", "open finder", "file manager": a folder on the glass, the
# `disk` surface Kyber draws and answers itself (hud/Sources/KyberKit/
# FilesGlass.swift), so it opens through `hud files` and not kyber-surfaces.
# It replaced a two-pane file manager on 2026-10-09 (CHW-198); "open Finder"
# still lands here because no app is ever opened, not even Finder.
FILES = re.compile(
    rf"^(?:{SHOW} {MY})?(?:files|file manager|file browser|finder)"
    r"(?: (?:on|up on) (?:the )?(?:screen|glass|hud))?(?: (?:right )?now)?$")
FILES_CLOSE = re.compile(
    r"^(?:close|hide|take down|dismiss|get rid of) (?:my |the )?(?:files|file manager|file browser|finder)$")
HUD = Path(__file__).resolve().parent.parent / "hud"
KYBER_SESSIONS = Path(__file__).resolve().parent.parent / "kyber-sessions"
SESSIONS_LOG = Path(os.environ.get("BOB_DIR", str(Path.home() / ".bob"))) / "kyber-sessions.log"
# "Show my agents", "pull up my tabs": every
# coding-agent session on the glass (bin/kyber-sessions serve), where each
# one's reply is read and answered, and runs are started and stopped. "What
# are my agents doing" stays with hud-listen's spoken summary (route.
# agent_status_word), which answers it aloud with no panel.
SESSIONS = re.compile(
    rf"^(?:{SHOW} {MY}(?:agents|coding agents|agent sessions|agent tabs|claude sessions|claude code sessions"
    r"|claude tabs|sessions|tabs|running agents)"
    r"(?: (?:on|up on) (?:the )?(?:screen|glass|hud))?(?: (?:right )?now)?)$")
SESSIONS_CLOSE = re.compile(
    r"^(?:close|hide|take down|dismiss|get rid of) (?:my |the )?(?:agents|tabs|sessions|agent sessions|claude sessions)"
    r"(?: surface| panel)?$")
# "Start an agent in lemma to write the README", "new task: summarize my
# week", "spin up a tab to fix the nav": the task lands in the panel's New
# task box and only a Start press runs it. Read off the raw sentence, because
# _norm drops the punctuation and digits a task is made of.
TASK = re.compile(
    r"(?is)^(?:(?:ok(?:ay)?|hey|kyber|so),?\s+)*"
    r"(?:(?:start|spin up|kick off|launch|fire up)\s+(?:up\s+)?(?:a\s+|an\s+)?(?:new\s+)?(?:background\s+)?"
    r"|new\s+)"
    r"(?:agent|task|tab|session|claude)"
    r"(?:\s+in\s+(?P<folder>[A-Za-z0-9][A-Za-z0-9_.-]{0,63}))?"
    r"\s*(?:to|that|which|and have it|:|,|-)\s*(?P<task>\S.*)$")
# "Stop the lemma agent", "kill the readme task". Only a run the glass
# started can stop; kyber-sessions refuses anything else in words.
STOP = re.compile(r"^(?:stop|kill|cancel|end|abort) (?:the |my )?(?P<name>[a-z0-9][a-z0-9 .-]{0,40}?) (?:agent|task|tab|session|run)$")
# "Set up my permissions", "fix my permissions": the on-screen walkthrough
# (bin/lib/permission_walk.py), a ring on each switch in System Settings. It
# runs for minutes while the person flips switches, so it is started and left
# running, never waited on.
PERMISSIONS = re.compile(
    r"^(?:set up|setup|fix|sort out|turn on|walk me through|help me (?:set up|with)|go through|check)"
    r" (?:my |the |all (?:my |the )?)?(?:mac |macos |chewbacca |kyber )?permissions?(?: for me)?(?: (?:right )?now)?$")
PERMISSIONS_CLI = Path(__file__).resolve().parent.parent / "chewbacca-permissions"
WALK_LOG = Path(os.environ.get("BOB_DIR", str(Path.home() / ".bob"))) / "perm-walk.log"
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


def agents_surface() -> str:
    """`realm` (Carlton's own interface) when its bundle is built, else the card."""
    try:
        from surfaces import realm_app  # noqa: PLC0415
    except ImportError:
        return "agents"
    return "realm" if realm_app.available() else "agents"


def parse(said: str, resolve_person=find_person) -> Command | None:
    """The surface command `said` asks for, or None for anything else."""
    s = _norm(said)
    if not s:
        return None
    if PERMISSIONS.match(s):
        return Command("walk", "permissions")
    m = TASK.match(said.strip())
    if m and m.group("task").strip(" .!?"):
        return Command("task", m.group("task").strip().rstrip(".!?"), m.group("folder") or "")
    if SESSIONS_CLOSE.match(s):
        return Command("close", agents_surface())
    if SESSIONS.match(s):
        # Every agent, any provider, on the realm engine's panel
        # (bin/lib/surfaces/agents.py), which also shows the open Claude
        # Code and Codex tabs. kyber-sessions' own panel is no longer the
        # answer to "show my agents" (2026-10-10, "Realm is supposed to be
        # inside the hud"). When Realm's own interface is built, that is the
        # answer instead (bin/realm-ui, 2026-10-11, "Carlton told me to copy
        # them bro"); the rebuilt card stays for a Mac without the bundle.
        return Command("open", agents_surface())
    m = STOP.match(s)
    if m:
        return Command("stop", m.group("name").strip())
    if FILES_CLOSE.match(s):
        return Command("panel", "files", "off")
    if FILES.match(s):
        return Command("panel", "files")
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
        started = run([tool(KYBER_SURFACES), "start"], capture_output=True, text=True, timeout=CLI_TIMEOUT_S)
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


def start_walk(spawn=subprocess.Popen) -> bool:
    """Start the walkthrough detached, so it outlives this request."""
    try:
        WALK_LOG.parent.mkdir(parents=True, exist_ok=True)
        with open(WALK_LOG, "a", encoding="utf-8") as log:
            spawn([tool(PERMISSIONS_CLI), "walk"], stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                  start_new_session=True)
        return True
    except OSError:
        return False


def open_sessions(open_id: str = "", spawn=subprocess.Popen) -> bool:
    """Start `kyber-sessions serve` detached, as Kyber's menu does. It holds
    its own lock, so a second start while one runs exits at once."""
    try:
        SESSIONS_LOG.parent.mkdir(parents=True, exist_ok=True)
        with open(SESSIONS_LOG, "a", encoding="utf-8") as log:
            spawn([tool(KYBER_SESSIONS), "serve"] + (["--open", open_id] if open_id else []),
                  stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=log, start_new_session=True)
        return True
    except OSError:
        return False


def sessions_verb(command: Command, run=subprocess.run, spawn=subprocess.Popen, ask=None) -> Outcome:
    if command.verb == "sessions":
        if open_sessions(spawn=spawn):
            return Outcome(True, "Your agents are up.")
        return Outcome(False, "The agents panel didn't open.")
    if command.verb == "task":
        # A sentence is not a press. Any audio near the mic reaches this path,
        # so the task only fills the agents panel's New agent box (and names
        # the folder it asked for); Start on the glass runs it (commit review,
        # 2026-10-10, and the kyber-surfaces skill's hard line).
        preset = {"/agents/task": command.name}
        if command.arg:
            preset["/agents/want"] = command.arg
        if not open_with_preset("agents", preset, run=run, ask=ask):
            return Outcome(False, "The agents panel didn't open.")
        return Outcome(True, "It's in the New agent box. Press Start to run it.")
    # stop: the one live glass run whose folder or task names it
    try:
        listed = run([tool(KYBER_SESSIONS), "--json"], capture_output=True, text=True, timeout=CLI_TIMEOUT_S)
        rows = json.loads(listed.stdout or "[]")
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return Outcome(False, "Couldn't read your agents.")
    key = command.name.lower()
    hits = [r for r in rows if r.get("run") and (key in str(r.get("project", "")).lower()
                                                   or key in str(r.get("title", "")).lower())]
    if not hits:
        return Outcome(False, f"No running agent from the glass matches {command.name}.")
    if len(hits) > 1:
        return Outcome(False, f"{len(hits)} running agents match {command.name}. Stop one on its card.")
    try:
        done = run([tool(KYBER_SESSIONS), "stop", str(hits[0]["id"])], capture_output=True, text=True,
                   timeout=CLI_TIMEOUT_S + 20)
    except (OSError, subprocess.TimeoutExpired):
        return Outcome(False, "The stop didn't answer.")
    line = (done.stdout or done.stderr or "").strip() or ("Stopped." if done.returncode == 0 else "It didn't stop.")
    return Outcome(done.returncode == 0, line)


def perform(command: Command, run=subprocess.run, ask=None, spawn=subprocess.Popen) -> Outcome:
    if command.verb in ("sessions", "task", "stop"):
        return sessions_verb(command, run=run, spawn=spawn, ask=ask)
    if command.verb == "walk":
        if start_walk(spawn):
            return Outcome(True, "Opening Settings. Follow the ring.")
        return Outcome(False, "The permission walkthrough didn't start.")
    if command.verb == "panel" and command.name != "sessions":
        argv = [tool(HUD), command.name] + ([command.arg] if command.arg else [])
        try:
            done = run(argv, capture_output=True, text=True, timeout=CLI_TIMEOUT_S)
        except (OSError, subprocess.TimeoutExpired):
            return Outcome(False, "The display didn't answer.")
        if done.returncode != 0:
            return Outcome(False, "Your files didn't come up.")
        return Outcome(True, "Closed." if command.arg == "off" else "Your files are up.")
    if command.verb == "panel" and command.name == "sessions":
        try:
            run([tool(HUD), "close", "sessions"], capture_output=True, text=True, timeout=CLI_TIMEOUT_S)
        except (OSError, subprocess.TimeoutExpired):
            return Outcome(False, "The display didn't answer.")
        return Outcome(True, "Closed.")
    if command.verb == "open" and command.name == "oss" and command.arg:
        if open_with_preset("oss", {"/oss/q": command.arg}, run=run, ask=ask):
            return Outcome(True, f"Here's what replaces {command.arg}.")
        return Outcome(False, "That surface didn't open.")
    # The daemon is almost always up, so ask its socket first. Going through
    # the CLI cost a Python start on every open: 116 to 241 ms from the
    # sentence to the reply, the layout reaching the display 77 to 202 ms in
    # (fake-display run, 2026-10-11, load 18 to 35). Only a test that hands in
    # its own `run` and no `ask` stays off the real socket.
    reply = None
    if command.verb in ("open", "close") and (ask is not None or run is subprocess.run):
        reply = (ask or _ask)({"cmd": command.verb, "name": command.name, "arg": command.arg or ""})
    if reply is not None:
        if not reply.get("ok"):
            return Outcome(False, "That surface didn't open.")
    else:
        argv = [tool(KYBER_SURFACES), command.verb, command.name] + ([command.arg] if command.arg else [])
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
            now = run([tool(HUD_MUSIC), "now"], capture_output=True, text=True, timeout=CLI_TIMEOUT_S)
            line = (now.stdout or "").strip()
            if line:
                return Outcome(True, line)
        except (OSError, subprocess.TimeoutExpired):
            pass
    spoken = {"today": "Your day's up.", "conversations": "Your conversations are up.",
              "tasks": "Your tasks are up.", "people": "Your people are up.", "music": "The player's up.",
              "files": "Downloads are up.", "needs-you": "Here's what needs you.",
              "missing": "Here's what you might be missing.", "person": "They're up.",
              "oss": "The alternatives are up.", "engine": "The engine's up.",
              "code": "What changed is up.", "notes": "Your notes are up.", "github": "GitHub's up.",
              "meetings": "Your meetings are up.", "agents": "Your agents are up.",
              "realm": "Your agents are up."}
    return Outcome(True, spoken.get(command.name, "It's up."))
