"""Live surfaces for the HUD: the provider contract and the registry.

Most surfaces are WALKS over the OS graph (bin/lib/osgraph.py, walks.py here):
needs-you, today, person, space, tasks, people, conversations. Sources are
ingested into the graph by bin/lib/osgraph_ingest.py, never read by a surface
directly, so one person is one node whichever app they wrote from. Music and
files stay thin surfaces over their own CLI and folder. A provider has four
parts:

    fetch(ctx)                 a walk over ctx.graph, or a read of a CLI; no model
    layout()                   the Kyber Lines that build the surface ONCE, every
                               changing prop bound to a pointer (`value=@/x`)
    model(data, error, values) the data model those pointers read, as
                               {pointer: json}, for loading, data, empty and error
    actions                    {action: handler}; a handler runs only when the
                               person pressed the Button that names it

The daemon in bin/kyber-surfaces draws `layout()` once, then on every refresh
diffs `model()` against what it last sent and pushes only the `d` lines that
changed. Nothing here talks to the socket.

THE SAFETY LINE. A handler's inputs are the press itself, what the person typed
into a Field or picked in a Select (`v` events), and the rows of the last fetch.
Message and mail text is only ever rendered, never read for instructions: it
goes out inside a JSON string on a `d` line, so a newline in a text cannot start
a new socket line, and no handler looks at it. See
.claude/rules/untrusted-content.md.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

# Every action this daemon owns starts with this. hud-listen hands any other
# unknown `e` action to the model as a request, so the prefix is also how it
# knows to leave these alone.
ACTION_PREFIX = "ks-"


class SurfaceError(Exception):
    """A fetch that failed as a whole. The message is shown on the surface, so
    it says what is wrong and what fixes it, in words."""


@dataclass
class Result:
    """What an action did, in one line for the surface's status."""
    ok: bool
    line: str
    # Pointers to set right after, e.g. clearing a draft that was sent.
    updates: dict = field(default_factory=dict)
    # Ask for a fetch now, so a sent reply shows up in the thread list.
    refetch: bool = False
    # Open another surface (and its argument, for `person` and `space`): how a
    # press on a row becomes a hop to that node's own walk.
    opens: str = ""
    opens_arg: str = ""
    preset: dict = field(default_factory=dict)
    # Re-read the sources now (a sent reply changes what is waiting).
    reingest: bool = False


Runner = Callable[[list], "tuple[int, str, str]"]


def run_cli(argv: list, timeout: float = 20.0) -> tuple[int, str, str]:
    try:
        done = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError:
        return 127, "", f"{argv[0]} is not installed"
    except subprocess.TimeoutExpired:
        return 124, "", f"{argv[0]} took longer than {timeout:.0f}s"
    except OSError as err:
        return 126, "", str(err)
    return done.returncode, done.stdout, done.stderr


@dataclass
class Context:
    run: Runner = run_cli
    now: Callable[[], datetime] = lambda: datetime.now().astimezone()
    home: Path = field(default_factory=Path.home)
    sleep: Callable[[float], None] = time.sleep
    env: dict = field(default_factory=lambda: dict(os.environ))
    # The OS graph and the people store's identities, shared by every walk
    # surface. Set by the daemon; None in a provider that needs neither.
    graph: object = None
    ids: object = None

    def json(self, argv: list, what: str):
        """Run a CLI that prints JSON. Raises SurfaceError with a readable line."""
        code, out, err = self.run(argv)
        if code != 0:
            raise SurfaceError(cli_error(what, err or out))
        try:
            return json.loads(out or "null")
        except json.JSONDecodeError:
            raise SurfaceError(f"{what} answered with something that is not JSON") from None


def cli_error(what: str, text: str) -> str:
    """The `mac` CLI prints {"error":{"message":...}}; say the message, not the JSON."""
    text = (text or "").strip()
    try:
        body = json.loads(text)
        if isinstance(body, dict) and isinstance(body.get("error"), dict):
            text = str(body["error"].get("message") or text)
    except json.JSONDecodeError:
        pass
    if "not granted" in text or "permission" in text.lower():
        return f"{what}: access is off. Run `mac doctor` to see the switch."
    first = text.splitlines()[0] if text else "no output"
    return f"{what} failed: {first[:120]}"


class Bind:
    """A prop that reads the data model: `value=@/pointer`."""

    def __init__(self, pointer: str):
        self.pointer = pointer


def _prop(value) -> str:
    if isinstance(value, Bind):
        return "@" + value.pointer
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def comp(cid: str, kind: str, **props) -> str:
    parts = ["c", cid, kind] + [f"{key}={_prop(val)}" for key, val in props.items()]
    return " ".join(parts)


def data_line(pointer: str, value) -> str:
    # ensure_ascii=False keeps names readable; json.dumps escapes \n and \r in
    # either mode, which is what keeps a message from forging a socket line.
    return f"d {pointer} {json.dumps(value, separators=(',', ':'), ensure_ascii=False)}"


def parse_time(stamp: str | None) -> datetime | None:
    if not stamp:
        return None
    try:
        moment = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone()


def ago(moment: datetime | None, now: datetime) -> str:
    """"now", "4m", "3h", "Tue", "Sep 9": how long ago, in one short word."""
    if moment is None:
        return ""
    secs = (now - moment).total_seconds()
    if secs < 60:
        return "now"
    if secs < 3600:
        return f"{int(secs // 60)}m"
    if secs < 86400:
        return f"{int(secs // 3600)}h"
    if secs < 6 * 86400:
        return moment.strftime("%a")
    return moment.strftime("%b %-d")


def clock(moment: datetime) -> str:
    return moment.strftime("%-I:%M %p").replace(":00 ", " ")


def clip(text: str, limit: int) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


URL = re.compile(r"https?://[^\s<>\"')\]]+", re.I)
# Hosts that are known by what they are, not by their domain.
KNOWN_HOSTS = {
    "docs.google.com": "Google Doc", "drive.google.com": "Drive file", "sheets.new": "new Sheet",
    "calendar.google.com": "calendar invite", "zoom.us": "Zoom link", "meet.google.com": "Meet link",
    "figma.com": "Figma file", "notion.so": "Notion page", "loom.com": "Loom video",
    "youtube.com": "YouTube video", "youtu.be": "YouTube video", "maps.apple.com": "map",
    "maps.google.com": "map",
}


def link_name(url: str) -> str:
    """What a URL points at, in a few words, or its bare host.

    Realm's rule (design.md, by Carlton Aikins): a link is shown as what it
    points AT, and only where it can be named; a wrong name is worse than the
    URL. So a GitHub issue becomes "owner/repo#12" because the URL says so
    exactly, and anything unknown becomes its host, never a guessed title.
    """
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower().removeprefix("www.")
    parts = [p for p in parsed.path.split("/") if p]
    if host == "github.com" and len(parts) >= 2:
        repo = f"{parts[0]}/{parts[1]}"
        if len(parts) >= 4 and parts[2] in ("issues", "pull") and parts[3].isdigit():
            return f"{repo}#{parts[3]}"
        return repo
    if host == "linear.app":
        for p in parts:
            if re.fullmatch(r"[A-Z][A-Z0-9]+-\d+", p):
                return p
    if host.endswith("slack.com") and "archives" in parts:
        return "Slack thread"
    if host.endswith("atlassian.net"):
        for p in parts:
            if re.fullmatch(r"[A-Z][A-Z0-9]+-\d+", p):
                return p
    for known, label in KNOWN_HOSTS.items():
        if host == known or host.endswith("." + known):
            return label
    return host or "link"


def linkify(text: str) -> str:
    """Every URL in a line replaced by what it points at."""
    return URL.sub(lambda m: link_name(m.group(0)), str(text or ""))


class Provider:
    """One surface. Subclasses set the class attributes and the methods."""

    name = ""
    title = ""
    region = "topRight"
    width = 380
    # Seconds between fetches while the surface is open.
    refresh = 60.0
    # Spoken and listed: what app this stands in for.
    replaces = ""

    def __init__(self) -> None:
        self.actions: dict[str, Callable[[Context, object, dict], Result]] = {}

    def p(self, key: str) -> str:
        """A pointer under this surface's own prefix. Pointers are namespaced
        because a Field's `v` event names the pointer and not the surface."""
        return f"/{self.name}/{key}"

    def cid(self, key: str) -> str:
        """A component id. The daemon reads the surface back off the prefix of
        the id in `e <action> <component>`, so ids carry the name."""
        return f"{self.name}-{key}"

    def fetch(self, ctx: Context):
        raise NotImplementedError

    def layout(self) -> list[str]:
        raise NotImplementedError

    def model(self, data, error: str | None, values: dict, ctx: Context) -> dict:
        raise NotImplementedError

    def initial(self) -> dict:
        """Pointers a control owns: set once at open, never by a refresh, so a
        half-typed reply is not wiped by the next fetch."""
        return {}


def note_for(data, error: str | None, empty: str, stale_at: datetime | None = None) -> str:
    """The one line under the title that carries loading, empty and error."""
    if error and data is not None and stale_at is not None:
        return f"Couldn't refresh ({error}). Showing {clock(stale_at)}."
    if error:
        return error
    if data is None:
        return "Loading…"
    return empty


KINDS = ("needs-you", "today", "tasks", "conversations", "people", "person", "space", "music", "files",
         "oss", "engine", "code", "notes", "github", "whatsapp", "meetings", "agents", "apps")
# Kinds that need an argument: `person karthik`, `space school`, `engine ollama-models`.
# `oss` is not one: it opens empty, and "what replaces Notion" seeds its query
# with the preset {"/oss/q": "Notion"} instead.
PARAMETRIC = ("person", "space", "engine")


def make(kind: str, arg: str = "") -> Provider:
    """A provider instance. Walk surfaces read the graph; music and files are
    thin surfaces over their own CLI and folder."""
    from . import agents, apps, code, engine, files, github, meetings, music, notes, oss, walks, whatsapp  # noqa: PLC0415  cycle-free lazy load

    if kind == "engine":
        return engine.EngineSurface(arg)
    if kind == "oss":
        return oss.Oss(arg)
    table = {
        "needs-you": walks.NeedsYou, "today": walks.Today, "tasks": walks.Tasks,
        "conversations": walks.Conversations, "people": walks.People,
        "music": music.Music, "files": files.Files,
        "code": code.Code, "notes": notes.Notes, "github": github.GitHub, "whatsapp": whatsapp.WhatsApp,
        "meetings": meetings.Meetings, "agents": agents.Agents, "apps": apps.Apps,
    }
    if kind == "person":
        return walks.Person(arg)
    if kind == "space":
        return walks.Space(arg)
    return table[kind]()


def registry() -> dict[str, Provider]:
    """One instance of every surface that needs no argument."""
    return {k: make(k) for k in KINDS if k not in PARAMETRIC}


ALIASES = {
    "needs": "needs-you", "needsyou": "needs-you", "needs_you": "needs-you", "attention": "needs-you",
    "todo": "tasks", "todos": "tasks", "task": "tasks", "lanes": "tasks",
    "day": "today", "calendar": "today", "agenda": "today", "schedule": "today",
    "texts": "conversations", "messages": "conversations", "imessage": "conversations", "mail": "conversations",
    "email": "conversations", "inbox": "conversations", "threads": "conversations", "convos": "conversations",
    "contacts": "people", "friends": "people",
    "spotify": "music", "player": "music", "song": "music", "playing": "music",
    "downloads": "files", "finder": "files", "file": "files",
    "alternatives": "oss", "alternative": "oss", "replace": "oss", "replaces": "oss",
    "open-source": "oss", "opensource": "oss", "oss-apps": "oss", "engines": "oss",
    "changes": "code", "diff": "code", "diffs": "code", "repos": "code",
    "note": "notes", "apple-notes": "notes",
    "launcher": "apps", "launchpad": "apps", "dock": "apps", "surfaces": "apps", "wa": "whatsapp", "whats-app": "whatsapp", "gh": "github", "prs": "github", "pulls": "github", "pull-requests": "github", "reviews": "github",
    "granola": "meetings", "anarlog": "meetings", "meeting": "meetings", "calls": "meetings", "call": "meetings",
    "notes-from-meetings": "meetings", "meeting-notes": "meetings",
    # VS Code was opened to talk to Claude; the code panel only reads diffs.
    "vscode": "agents", "vs-code": "agents", "claude": "agents", "sessions": "agents", "agent": "agents",
    "agent-sessions": "agents", "realm": "agents",
}


def resolve(name: str) -> str | None:
    """The surface kind a word names, or None."""
    key = (name or "").strip().lower()
    if key in KINDS:
        return key
    return ALIASES.get(key)
