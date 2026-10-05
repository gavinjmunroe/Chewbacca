"""agents: Claude sessions on the glass, run by the realm engine, with no editor.

Replaces opening VS Code to talk to a coding agent. The engine is realm
(github.com/31Carlton7/realm, Carlton Aikins, run headless by bin/realm-engine
with his permission given in person on 2026-10-05), reached only through
bin/lib/realm_client.py, which proves the server by pid, port ownership and
realmHome before the first call and refuses any write not passed write=True.

WHAT IS ON THE PANEL. Every session the engine has, each with its space and
its state in words (waiting on you, working, failed, idle), what needs you
first. Open on a row pins that session: its newest turns in a Transcript,
read by polling sessions.events after the last seq seen, and the verbs that
apply to it right now. Below that, a Select of folders (git repos under the
code root, default ~/code, KYBER_CODE_ROOT to move it, plus the folders
sessions already run in) and Start, which makes a Claude session there.

EVERY VERB IS A ROW, AND THE ROW IS THE TARGET. Send, Allow once, Deny,
Interrupt, Fork, Start and Start the engine are row buttons on Events
components (hud/CLAUDE.md, Row actions), so the press arrives carrying the id
that was on the glass: a session id, a permission requestId, a folder. A
verb that does not apply has no row and is not drawn, which is how a down
engine offers "Start the engine" and nothing that writes. Each row says what
the press touches and whether it can be undone (docs/AFTER-PANES.md, Verbs).

WHICH SESSION. A press acts on the session pinned when it was picked, never
on a row position: the list re-sorts by state every refresh, and a Send that
followed the sort would land in whichever session moved under the pointer.
The row id must equal the pin, or the press refuses.

WRITES, ONE AT A TIME, NEVER RETRIED. Each write re-reads what it depends on
first (the session's status, whether the request is still pending), runs
once, and a second press of the same verb while the first is in flight
refuses. A RealmError with maybe_applied means the engine may have run it, so
the panel says "may have" and does nothing more; a later press of the same
text to the same session is refused once the transcript shows it arrived.

PERMISSIONS. A pending request shows its tool and its whole input as JSON.
Allow once is offered only when what is shown is exactly the input: an input
longer than the panel shows, or one that held a control, format or bidi
character (stripped for display), gets Deny and nothing else. The glass never
sends allow_always, and answers only the requestId the press names, only
while that request is still the session's pending one.

UNTRUSTED TEXT. Turns, tool input, titles, space names and paths all come
from the engine, which relays a model and whatever it read. All of it is
stripped of Unicode category C and the line and paragraph separators before
a `d` line, clipped, and never read for an action. Result lines (which the
daemon logs to ~/.bob/surfaces-activity.jsonl) name a folder, never a
message, a title or a tool input.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import unicodedata
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import realm_client

from . import ACTION_PREFIX, Bind, Context, Provider, Result, SurfaceError, ago, comp, note_for
from .code import candidates, code_root

ENGINE = Path(__file__).resolve().parents[2] / "realm-engine"
# Miller's seven plus two, the same cap the code and sessions panels use.
MAX_SESSIONS = 9
# Turns on the glass. Guessed, never measured on the glass: fourteen rows of
# one-line tool calls and short prose fill a centre column at 900 points.
TRANSCRIPT_ITEMS = 14
# A turn's text. TranscriptView cuts at 4000 (SessionViews.swift); a long
# answer is read in full where it was written, and the glass is a glance.
TURN_CHARS = 1200
# The longest permission input shown whole. Guessed, never measured: at 460
# points and 11.5 pt about 60 characters fit a line, so 1200 is 20 lines,
# about as much as anyone reads before pressing. Longer gets Deny only.
PERMISSION_CHARS = 1200
# Folders in the Select. ~/code held 72 repos on 2026-10-05; a menu of 72 is
# a search problem, so the 24 touched most recently (recent sessions first).
MAX_FOLDERS = 24
# sessions.events pages. The server default is 2000 a page (rpc.ts); 500
# keeps one reply small, and 10 pages a fetch caps a first catch-up of a long
# session at 5,000 events, the rest arriving on the next refreshes. Guessed.
EVENTS_PAGE = 500
EVENTS_PAGES = 10
# A press reads the pinned session to its last event before it writes: up to
# 8 of those 5,000-event runs on top of what the fetch already read, so a
# 40,000-event backlog refuses the press instead of answering blind. Guessed.
PRESS_CATCH_UPS = 8
# Seconds between fetches. While the pinned session works, a turn's text
# lands in a second or two; idle, nothing moves until someone presses. A
# whole fetch (connect proving the server with lsof and ps, then the reads)
# took 0.060 to 0.206 s over 19 fetches against a live engine with one to
# three sessions on 2026-10-05 (medians 0.098 and 0.069 in two runs), so at
# 2 s the panel spends about a
# twentieth of a running turn fetching (wall time, CPU not measured). The
# idle interval is guessed.
REFRESH_BUSY = 2.0
REFRESH_IDLE = 10.0
# realm-engine waits 60 s for the server's ready line (READY_TIMEOUT_S);
# start's own work around that is a second or two.
START_TIMEOUT = 90.0
# A first build clones realm and runs a filtered pnpm install and build.
# Guessed, never measured from the glass: the 2026-10-05 build on Caleb's Mac
# was run by hand. Twenty minutes covers a slow network.
BUILD_TIMEOUT = 1200.0
# One RPC. realm_client's default; sessions.send returns once the message is
# queued to the agent (claude-adapter.ts send pushes into its input stream).
CALL_TIMEOUT = 10.0
AGENT = "claude"
# "default" is Realm's "Ask each time" (presets.ts PERMISSION_MODES), the one
# mode where every tool call reaches canUseTool and so this panel. A session
# made from the glass never starts in a mode that skips asking.
PERMISSION_MODE = "default"
PURPOSE = "Claude sessions run by the agent engine: start one, read it, answer it"
STATE_WORDS = {"waiting_permission": "waiting on you", "running": "working", "error": "failed",
               "idle": "idle", "ended": "idle"}
# What needs the person first, then what is moving, then the rest.
STATE_ORDER = {"waiting_permission": 0, "error": 1, "running": 2, "idle": 3, "ended": 4}
BUSY = ("running", "waiting_permission")
# The pointers holding a row a press can write through.
VERBS = ("send", "allow", "deny", "interrupt", "fork", "new")
MODE_WORDS = {"default": "asks before each tool", "acceptEdits": "edits without asking",
              "bypassPermissions": "never asks (full access)", "plan": "plans only"}
# The input keys a one-line tool row names, in the order a reader wants them.
TOOL_KEYS = ("command", "file_path", "path", "pattern", "url", "query", "description", "prompt")


# Characters that draw as nothing but are not in category C, so a C-only
# strip passes them: the combining grapheme joiner, the Hangul and Khmer
# fillers, Mongolian variation selectors, the braille blank and both
# variation selector blocks. A reviewer found these passing as "exact" in a
# permission input on 2026-10-05.
INVISIBLE = frozenset([0x034F, 0x115F, 0x1160, 0x17B4, 0x17B5, 0x2800, 0x3164, 0xFFA0]
                      + list(range(0x180B, 0x1810)) + list(range(0xFE00, 0xFE10))
                      + list(range(0xE0100, 0xE01F0)))


def hidden(ch: str) -> bool:
    cat = unicodedata.category(ch)
    return cat[0] == "C" or cat in ("Zl", "Zp") or ord(ch) in INVISIBLE


def clean(text, limit: int | None = None, one_line: bool = True) -> str:
    """Engine text with every control, format and bidi character removed (the
    whole C category and U+2028/9, as code.py strips, plus INVISIBLE),
    keeping newlines only for a turn's prose."""
    s = str(text if text is not None else "")
    keep = "\n" if not one_line else ""
    s = "".join(ch for ch in s if ch in keep or not hidden(ch))
    if one_line:
        s = " ".join(s.split())
    else:
        s = "\n".join(" ".join(line.split()) for line in s.split("\n")).strip()
    if limit and len(s) > limit:
        s = s[: limit - 1].rstrip() + "…"
    return s


def realm_home(ctx: Context) -> Path:
    return Path(ctx.env.get("CHEWBACCA_REALM_HOME") or Path(ctx.home) / ".chewbacca" / "realm").expanduser()


def realm_dir(ctx: Context) -> Path:
    return Path(ctx.env.get("CHEWBACCA_REALM_DIR") or Path(ctx.home) / "code" / "vendor" / "realm").expanduser()


def built(ctx: Context) -> bool:
    return (realm_dir(ctx) / "apps" / "server" / "dist" / "main.js").exists()


def tilde(path: str, home: Path) -> str:
    """path under ~, as typed or as resolved: folders are resolved before
    they are labelled, and a home reached through a link (/var to
    /private/var) would otherwise never match."""
    text = str(path or "")
    for base in dict.fromkeys((str(home), os.path.realpath(home))):
        if base and (text == base or text.startswith(base.rstrip("/") + "/")):
            return "~" + text[len(base.rstrip("/")):]
    return text


def stamp(ms) -> datetime | None:
    if not isinstance(ms, (int, float)) or isinstance(ms, bool) or ms <= 0:
        return None
    try:
        return datetime.fromtimestamp(ms / 1000).astimezone()
    except (OverflowError, OSError, ValueError):
        return None


def why_words(err: realm_client.RealmError) -> str:
    """A RealmError in full, for a note on the glass only: the daemon keeps
    notes off the activity log."""
    if isinstance(err, realm_client.RealmRpcError):
        return clean(f"{err.code}: {err.message}", 160)
    return clean(str(err), 160)


def rpc_words(err: realm_client.RealmError) -> str:
    """A RealmError for a press's result line, which the daemon writes to the
    activity log. The engine composes its error messages and they can carry
    what it was handed, so only the code or the kind of failure goes here."""
    if isinstance(err, realm_client.RealmRpcError):
        code = err.code if err.code.replace("_", "").isalnum() and err.code.isascii() else "an error"
        return f"the engine answered {code[:40]}"
    if isinstance(err, realm_client.RealmTimeout):
        return "the engine didn't answer in time"
    if isinstance(err, realm_client.RealmUnavailable):
        return "the engine isn't reachable"
    return "the engine's answer couldn't be read"


def own_words(stderr: str, code: int) -> str:
    """realm-engine's own last `realm-engine: ...` line, or the exit code. A
    build's stderr is git and pnpm output, dependency scripts included, and
    a result line lands in the activity log, so nothing else is quoted."""
    lines = [x for x in (stderr or "").splitlines() if x.startswith("realm-engine: ")]
    return clean(lines[-1].removeprefix("realm-engine: "), 160) if lines else f"exit {code}"


def tool_line(name: str, args) -> str:
    """One line naming what a tool call touched: Bash's command, Edit's file."""
    tool = clean(name, 40) or "tool"
    if isinstance(args, dict):
        for key in TOOL_KEYS:
            if isinstance(args.get(key), str) and args[key].strip():
                return clean(f"{tool}: {args[key]}", 160)
        if args:
            return clean(f"{tool}: {json.dumps(args, ensure_ascii=False)}", 160)
    return tool


def permission_view(tool, args) -> tuple[str, bool]:
    """(what the panel shows, whether it is exactly the input).

    The input is shown as JSON, which escapes newlines and C0 controls, so a
    multi-line command reads as one line with its \\n visible. Anything JSON
    leaves raw that is still hidden (DEL, C1, bidi, zero-width, U+2028) is
    stripped for display, and then what is shown is not what would run.
    """
    name = str(tool if tool is not None else "")
    try:
        body = json.dumps(args if args is not None else {}, ensure_ascii=False)
    except (TypeError, ValueError):
        body = str(args)
    raw = f"{name}: {body}"
    shown = "".join(ch for ch in raw if not hidden(ch))
    exact = shown == raw and len(shown) <= PERMISSION_CHARS
    if len(shown) > PERMISSION_CHARS:
        shown = shown[:PERMISSION_CHARS - 1] + "…"
    return shown, exact


@dataclass
class Log:
    """What the panel has read of one session's events."""
    sid: str
    seq: int = 0
    items: deque = field(default_factory=lambda: deque(maxlen=TRANSCRIPT_ITEMS))
    # requestId -> {"tool", "input", "seq"}, oldest first: the request the
    # agent is blocked on first is the one shown.
    pending: dict = field(default_factory=dict)
    # (seq, text) of recent user_message events, for "did that send land?".
    sent: deque = field(default_factory=lambda: deque(maxlen=20))
    caught_up: bool = False

    def take(self, stored) -> None:
        if not isinstance(stored, dict):
            return
        seq = stored.get("seq")
        event = stored.get("event")
        if not isinstance(seq, int) or isinstance(seq, bool) or not isinstance(event, dict):
            return
        self.seq = max(self.seq, seq)
        kind = event.get("type")
        body = event.get("payload") if isinstance(event.get("payload"), dict) else {}
        rid = f"e{seq}"
        if kind == "user_message":
            text = str(body.get("text") or "")
            self.sent.append((seq, text))
            origin = body.get("from")
            who = ""
            if isinstance(origin, dict):
                who = f"From session {clean(origin.get('title'), 40) or 'another session'}: "
            self.items.append({"id": rid, "role": "user", "text": who + clean(text, TURN_CHARS, one_line=False)})
        elif kind == "assistant_text":
            text = clean(body.get("text"), TURN_CHARS, one_line=False)
            if text:
                self.items.append({"id": rid, "role": "assistant", "text": text})
        elif kind == "tool_call":
            name = str(body.get("name") or "")
            self.items.append({"id": rid, "role": "tool", "tool": clean(name, 40),
                               "text": tool_line(name, body.get("input"))})
        elif kind == "tool_result" and body.get("isError"):
            first = clean(str(body.get("content") or "").strip().split("\n", 1)[0], 160)
            self.items.append({"id": rid, "role": "error", "text": f"Tool failed: {first}" if first else "Tool failed"})
        elif kind == "permission_request":
            request = str(body.get("requestId") or "")
            if request:
                self.pending[request] = {"tool": body.get("toolName"), "input": body.get("input"), "seq": seq}
            self.items.append({"id": rid, "role": "tool", "tool": clean(body.get("toolName"), 40),
                               "text": "Asked to run " + tool_line(str(body.get("toolName") or ""), body.get("input"))})
        elif kind == "permission_response":
            request = str(body.get("requestId") or "")
            self.pending.pop(request, None)
            word = {"allow": "Allowed once", "allow_always": "Allowed always", "deny": "Denied"}.get(
                str(body.get("decision")), "Answered")
            self.items.append({"id": rid, "role": "tool", "tool": "", "text": word})
        elif kind == "error":
            self.items.append({"id": rid, "role": "error", "text": clean(body.get("message"), 240) or "Error"})
        elif kind == "status" and body.get("interrupted"):
            self.items.append({"id": rid, "role": "tool", "tool": "", "text": "Stopped"})
        elif kind == "retrying":
            self.items.append({"id": rid, "role": "error", "text": "The provider failed; the engine is retrying"})
        elif kind == "handoff":
            self.items.append({"id": rid, "role": "tool", "tool": "", "text": "Handed to another agent"})

    def copy(self) -> "Log":
        """A Log that can be read on while this one is read from: a published
        Log is never extended, so the fetch and a press each work on a copy."""
        return Log(self.sid, self.seq, deque(self.items, maxlen=TRANSCRIPT_ITEMS), dict(self.pending),
                   deque(self.sent, maxlen=20), self.caught_up)

    def landed(self, text: str, after: int) -> bool:
        return any(seq > after and sent == text for seq, sent in self.sent)


class Agents(Provider):
    name = "agents"
    title = "AGENTS"
    region = "center"
    width = 460
    replaces = "VS Code"

    def __init__(self) -> None:
        super().__init__()
        p = ACTION_PREFIX
        self.actions = {f"{p}pick": self.pick, f"{p}send": self.send, f"{p}allow": self.allow,
                        f"{p}deny": self.deny, f"{p}interrupt": self.interrupt, f"{p}fork": self.fork,
                        f"{p}new": self.new, f"{p}engine": self.start_engine}
        self._lock = threading.Lock()
        # The session a press acts on. Set by a pick (or the first fetch, to
        # the session that needs the person most), never by a re-sort.
        self.pinned = ""
        self._log: Log | None = None
        # (verb, key) presses still running: a second press refuses.
        self._inflight: set[tuple[str, str]] = set()
        # (session id, text, seq before the send) of a send that may have run.
        self._unsure: tuple[str, str, int] | None = None
        self._busy = False
        # Bumped by every press that moves the pin. A fetch whose list was
        # read under an older generation leaves the pin alone, and _soon keeps
        # the next fetch 2 s away until one has read the new pin, since the
        # daemon drops a press's refetch while a fetch is running.
        self._gen = 0
        self._soon = False
        # Seams for the tests: a proven connection, and the realm-engine runner.
        self.connect = lambda ctx: realm_client.connect(timeout=5.0, home=realm_home(ctx))
        self.run_engine = self._run_engine

    @property
    def refresh(self) -> float:  # type: ignore[override]  the daemon reads it after every fetch
        return REFRESH_BUSY if self._busy or self._soon else REFRESH_IDLE

    def _repin(self, sid: str) -> None:
        """Move the pin from a press. Call with self._lock held."""
        if self.pinned != sid:
            self.pinned, self._log = sid, None
        self._gen += 1
        self._soon = True

    # ── reading ──────────────────────────────────────────────────────────

    def fetch(self, ctx: Context) -> dict:
        try:
            conn = self.connect(ctx)
        except realm_client.RealmError as err:
            self._busy = False
            return self.down(ctx, err)
        with self._lock:
            gen = self._gen
        try:
            with conn:
                spaces = conn.call("spaces.list", timeout=CALL_TIMEOUT)
                spaces = [s for s in spaces if isinstance(s, dict) and isinstance(s.get("id"), str)] \
                    if isinstance(spaces, list) else []
                # sessions.list per space, not sessions.listAll: realm_client's
                # READ_METHODS (taken from rpc.ts at 0ae5b8b) has no listAll, so
                # the client refuses it as a write.
                listed = []
                for space in spaces:
                    got = conn.call("sessions.list", {"spaceId": space["id"]}, timeout=CALL_TIMEOUT)
                    listed += [s for s in got if isinstance(s, dict) and isinstance(s.get("id"), str)] \
                        if isinstance(got, list) else []
                names = {s.get("id"): clean(s.get("name"), 30) for s in spaces}
                rows = [self.row(s, names, ctx) for s in listed]
                rows.sort(key=lambda r: (STATE_ORDER.get(r["status"], 9), -(r["updated"] or 0)))
                gone = ""
                with self._lock:
                    # A press that pinned a session after this list was read
                    # (Start, Fork, Open) wins: this list may not hold the new
                    # session yet, and must not call it gone or re-pin.
                    current = self._gen == gen
                    if current and self.pinned and not any(r["id"] == self.pinned for r in rows):
                        gone = self.pinned
                        self.pinned, self._log = "", None
                    if current and not self.pinned and rows:
                        self.pinned = rows[0]["id"]
                    pinned = self.pinned
                    base = self._log if self._log and self._log.sid == pinned else None
                    log = base.copy() if base else Log(pinned)
                checkpoint = None
                row = next((r for r in rows if r["id"] == pinned), None)
                if row is not None:
                    self.catch_up(conn, log)
                    checkpoint = self.newest_checkpoint(conn, row)
                    with self._lock:
                        # Published only if no press moved the pin meanwhile.
                        mine = self._log is base or self._log is None or self._log.sid != pinned
                        if self.pinned == pinned and mine:
                            self._log = log
        except realm_client.RealmError as err:
            raise SurfaceError(f"The engine stopped answering: {why_words(err)}") from None
        shown = next((r for r in rows if r["id"] == pinned), None)
        self._busy = bool(shown and shown["status"] in BUSY)
        with self._lock:
            if self._gen == gen:
                self._soon = False
        # A copy, not the Log: the next fetch extends the Log while the daemon
        # may still be drawing this one.
        return {"rows": rows, "pinned": pinned, "gone": gone, "checkpoint": checkpoint,
                "folders": self.folders(ctx, listed), "items": list(log.items), "pending": dict(log.pending),
                "caught_up": log.caught_up}

    @staticmethod
    def catch_up(conn, log: Log) -> None:
        for _ in range(EVENTS_PAGES):
            page = conn.call("sessions.events", {"id": log.sid, "afterSeq": log.seq, "limit": EVENTS_PAGE},
                             timeout=CALL_TIMEOUT)
            page = page if isinstance(page, list) else []
            for stored in page:
                log.take(stored)
            if len(page) < EVENTS_PAGE:
                log.caught_up = True
                return
        log.caught_up = False

    @staticmethod
    def newest_checkpoint(conn, row: dict) -> str | None:
        """The newest checkpoint this session's own turns took, or None. A
        fork of one restores the folder to before the last message."""
        if not row.get("environment"):
            return None
        found = conn.call("checkpoints.list", {"environmentId": row["environment"], "sessionId": row["id"]},
                          timeout=CALL_TIMEOUT)
        for cp in found if isinstance(found, list) else []:
            if isinstance(cp, dict) and isinstance(cp.get("id"), str) and cp.get("sessionId") == row["id"]:
                return cp["id"]
        return None

    @staticmethod
    def row(s: dict, names: dict, ctx: Context) -> dict:
        cwd = str(s.get("cwd") or "")
        status = str(s.get("status") or "")
        return {"id": s["id"], "title": clean(s.get("title"), 60) or "New session",
                "space": names.get(s.get("spaceId")) or "a space", "status": status,
                "state": STATE_WORDS.get(status, clean(status, 20) or "unknown"),
                "folder": clean(Path(cwd).name, 40) if cwd else "", "cwd": clean(tilde(cwd, Path(ctx.home)), 80),
                "agent": clean(s.get("agentKind"), 20), "mode": clean(s.get("permissionMode"), 30),
                "environment": s.get("environmentId") if isinstance(s.get("environmentId"), str) else "",
                "updated": s.get("updatedAt") if isinstance(s.get("updatedAt"), (int, float)) else 0}

    def folders(self, ctx: Context, listed: list[dict]) -> list[dict]:
        """Where a new session may start: folders sessions already run in,
        newest first, then git repos under the code root by last commit or
        index change. A label is the folder's own path, so it names one
        folder however the list reorders."""
        out, seen = [], set()

        def add(path: Path, recent: bool) -> None:
            try:
                real = path.resolve(strict=True)
            except (OSError, RuntimeError):
                return
            text = str(real)
            if text in seen or not real.is_dir() or any(hidden(ch) for ch in text):
                return
            seen.add(text)
            out.append({"label": tilde(text, Path(ctx.home)), "path": text, "recent": recent})

        for s in sorted(listed, key=lambda s: -(s.get("updatedAt") or 0)
                        if isinstance(s.get("updatedAt"), (int, float)) else 0):
            if isinstance(s.get("cwd"), str) and s["cwd"].startswith("/"):
                add(Path(s["cwd"]), True)
        try:
            repos = candidates(code_root(ctx))
        except SurfaceError:
            repos = []

        def touched(repo: Path) -> float:
            try:
                return max((repo / ".git" / name).stat().st_mtime for name in ("HEAD", "index")
                           if (repo / ".git" / name).exists())
            except (OSError, ValueError):
                return 0.0

        for repo in sorted(repos, key=touched, reverse=True):
            add(repo, False)
        return out[:MAX_FOLDERS]

    def down(self, ctx: Context, err: realm_client.RealmError) -> dict:
        """The engine is not answering. A state with steps, never an error."""
        ready = built(ctx)
        missing = "missing" in str(err) or "not started" in str(err)
        headline = ("The agent engine isn't built on this Mac yet." if not ready
                    else "The agent engine isn't running." if missing
                    else "The agent engine isn't answering.")
        steps = [
            "The engine is realm, Carlton Aikins' open source agent server. It runs Claude sessions on this "
            "Mac with no editor or terminal window, and listens only on this Mac (127.0.0.1).",
            ("Build and start downloads realm from github.com/31Carlton7/realm and builds it once, a few "
             "minutes, with node and pnpm." if not ready else
             "Start the engine runs it in the background. `realm-engine stop` stops it."),
            "Then pick a folder, start a session, and type to it here. A session started here asks you "
            "before every tool it runs.",
        ]
        return {"down": {"headline": headline, "steps": steps, "why": why_words(err), "built": ready}}

    # ── drawing ──────────────────────────────────────────────────────────

    def layout(self) -> list[str]:
        p, c = self.p, self.cid
        ids = ["s", "purpose", "note", "setup", "engine", "list", "head", "meta", "transcript", "ask", "allow",
               "deny", "draft", "send", "interrupt", "fork", "folder", "new", "status"]
        return [
            comp(c("s"), "Screen", title=self.title),
            comp(c("purpose"), "Text", value=PURPOSE, tone="muted"),
            comp(c("note"), "Text", value=Bind(p("note")), tone="muted"),
            comp(c("setup"), "List", items=Bind(p("setup"))),
            comp(c("engine"), "Events", caption="", items=Bind(p("engine")), action=f"{ACTION_PREFIX}engine",
                 actionLabel=Bind(p("engineLabel"))),
            comp(c("list"), "Events", caption=Bind(p("caption")), items=Bind(p("rows")),
                 action=f"{ACTION_PREFIX}pick", actionLabel="Open"),
            comp(c("head"), "Heading", text=Bind(p("head")), level=3),
            comp(c("meta"), "Text", value=Bind(p("meta")), tone="muted"),
            comp(c("transcript"), "Transcript", items=Bind(p("transcript"))),
            comp(c("ask"), "Text", value=Bind(p("ask"))),
            comp(c("allow"), "Events", caption="", items=Bind(p("allow")), action=f"{ACTION_PREFIX}allow",
                 actionLabel="Allow once"),
            comp(c("deny"), "Events", caption="", items=Bind(p("deny")), action=f"{ACTION_PREFIX}deny",
                 actionLabel="Deny"),
            comp(c("draft"), "Field", label="Message", placeholder=Bind(p("placeholder")), value=Bind(p("draft"))),
            comp(c("send"), "Events", caption="", items=Bind(p("send")), action=f"{ACTION_PREFIX}send",
                 actionLabel="Send"),
            comp(c("interrupt"), "Events", caption="", items=Bind(p("interrupt")),
                 action=f"{ACTION_PREFIX}interrupt", actionLabel="Interrupt"),
            comp(c("fork"), "Events", caption="", items=Bind(p("fork")), action=f"{ACTION_PREFIX}fork",
                 actionLabel="Fork"),
            comp(c("folder"), "Select", label="New session in", options=Bind(p("folders")), value=Bind(p("folder"))),
            comp(c("new"), "Events", caption="", items=Bind(p("new")), action=f"{ACTION_PREFIX}new",
                 actionLabel="Start"),
            comp(c("status"), "Status", message=Bind(p("status")), level=Bind(p("level"))),
            f"> {' '.join(c(i) for i in ids)}",
            f"r {c('s')}",
        ]

    def initial(self) -> dict:
        return {self.p("draft"): "", self.p("folder"): "", self.p("status"): "Nothing pressed yet.",
                self.p("level"): "info"}

    def blank(self) -> dict:
        p = self.p
        return {p("setup"): [], p("engine"): [], p("engineLabel"): "Start the engine", p("caption"): "",
                p("rows"): [], p("head"): "", p("meta"): "", p("transcript"): [], p("ask"): "", p("allow"): [],
                p("deny"): [], p("send"): [], p("interrupt"): [], p("fork"): [], p("folders"): [], p("new"): [],
                p("placeholder"): "Typed here, sent only by Send"}

    def model(self, data, error, values, ctx) -> dict:
        out = self._model(data, error, values, ctx)
        if error and data is not None and not data.get("down"):
            # A refresh failed after the engine had answered before: the rows
            # are the last good read, kept to be read (rule 7), but no verb is
            # offered on them, since the engine those verbs need isn't answering.
            for verb in VERBS:
                out[self.p(verb)] = []
            out[self.p("placeholder")] = "The engine isn't answering. Nothing can be sent until it does."
        return out

    def _model(self, data, error, values, ctx) -> dict:
        p = self.p
        out = self.blank()
        if data is None:
            out[p("note")] = note_for(None, error, "")
            return out
        if data.get("down"):
            down = data["down"]
            out[p("note")] = note_for(data, error, down["headline"], data.get("_at"))
            out[p("setup")] = ([{"id": f"step{i}", "text": f"{i + 1}. {s}"} for i, s in enumerate(down["steps"])]
                               + [{"id": "why", "text": f"The engine said: {down['why']}"}])
            out[p("engine")] = [{"id": "start", "accent": True, "text": (
                "Starts realm-engine on this Mac, in the background · stop it any time with realm-engine stop"
                if down["built"] else
                "Downloads and builds realm, then starts it · a few minutes · delete ~/code/vendor/realm to undo")}]
            out[p("engineLabel")] = "Start the engine" if down["built"] else "Build and start"
            out[p("placeholder")] = "Start the engine first"
            return out
        now = ctx.now()
        rows = data["rows"]
        waiting = sum(r["status"] == "waiting_permission" for r in rows)
        working = sum(r["status"] == "running" for r in rows)
        failed = sum(r["status"] == "error" for r in rows)
        counts = [f"{len(rows)} session{'s' if len(rows) != 1 else ''}", f"{waiting} waiting on you",
                  f"{working} working"] + ([f"{failed} failed"] if failed else [])
        empty = " · ".join(counts) if rows else "No sessions yet. Pick a folder below and start one."
        if data.get("gone"):
            empty = "The session you had open is gone from the engine. " + empty
        out[p("note")] = note_for(data, error, empty, data.get("_at"))
        out[p("caption")] = "Sessions, what needs you first" if rows else ""
        pinned = data.get("pinned")
        out[p("rows")] = [{"id": r["id"], "accent": r["id"] == pinned,
                           "time": " · ".join(x for x in (r["state"], ago(stamp(r["updated"]), now)) if x),
                           "text": clean(f"{r['title']} · {r['space']}" + (f" · {r['folder']}" if r["folder"] else ""),
                                         90)}
                          for r in rows[:MAX_SESSIONS]]
        if len(rows) > MAX_SESSIONS:
            out[p("caption")] += f" · {len(rows) - MAX_SESSIONS} more not shown"
        folders = data.get("folders") or []
        out[p("folders")] = [f["label"] for f in folders]
        picked = str(values.get(p("folder")) or "")
        if picked and picked in out[p("folders")]:
            out[p("new")] = [{"id": picked, "text": clean(
                f"A Claude session in {picked}, asking before each tool · if the folder has no space yet, "
                "makes one, and Realm keeps a folder of its own for it under the engine's home · nothing is "
                "sent until you Send", 260)}]
        shown = next((r for r in rows if r["id"] == pinned), None)
        if shown is None:
            out[p("placeholder")] = "Start a session first"
            return out
        pending = data.get("pending") or {}
        out[p("head")] = shown["title"]
        mode = MODE_WORDS.get(shown["mode"], shown["mode"])
        out[p("meta")] = " · ".join(x for x in (shown["state"], shown["space"], shown["cwd"], shown["agent"], mode) if x)
        out[p("transcript")] = list(data.get("items") or [])
        if not data.get("caught_up"):
            out[p("meta")] += " · catching up on older turns"
        where = shown["folder"] or "its folder"
        if shown["status"] == "waiting_permission" and pending:
            request, ask = next(iter(pending.items()))
            view, exact = permission_view(ask["tool"], ask["input"])
            if exact:
                # The row IS the request: its text is the whole input, and its
                # Allow once names this requestId and no other.
                out[p("ask")] = "Waiting on you. It wants to run:"
                out[p("allow")] = [{"id": request, "accent": True, "text": view}]
                out[p("deny")] = [{"id": request, "text": "Refuse it · the agent is told no and carries on"}]
            else:
                why = ("it's longer than the panel shows" if len(view) >= PERMISSION_CHARS
                       else "it held hidden characters, removed here")
                out[p("ask")] = f"Waiting on you. It wants to run, not shown exactly: {view}"
                out[p("deny")] = [{"id": request, "text": f"Refuse it · this one can't be allowed from the glass "
                                                          f"because {why}"}]
        elif shown["status"] == "waiting_permission":
            out[p("ask")] = "Waiting on you, but the request isn't in the transcript yet."
        if shown["status"] in BUSY:
            out[p("placeholder")] = "It's working. Send opens when it's idle, or Interrupt."
            out[p("interrupt")] = [{"id": shown["id"], "text": f"Stops the turn it's on in {where} · what it "
                                                                 "already changed stays changed"}]
        else:
            out[p("send")] = [{"id": shown["id"], "accent": True,
                               "text": clean(f"To {shown['title']} in {where} · can't be unsent", 120)}]
        if data.get("checkpoint") and shown["status"] not in BUSY:
            out[p("fork")] = [{"id": shown["id"], "text": f"Copies {where} as it was before your last message "
                                                           "into a new worktree, with a new session · the "
                                                           "original is untouched"}]
        return out

    # ── presses ──────────────────────────────────────────────────────────

    def _claim(self, verb: str, key: str) -> bool:
        with self._lock:
            if (verb, key) in self._inflight:
                return False
            self._inflight.add((verb, key))
            return True

    def _release(self, verb: str, key: str) -> None:
        with self._lock:
            self._inflight.discard((verb, key))

    def _pinned_row(self, data, values: dict) -> tuple[dict | None, str]:
        """The pinned session's row, only when the press names it."""
        named = str(values.get("row") or "")
        with self._lock:
            pinned = self.pinned
        if not named or named != pinned:
            return None, "That press named a session that isn't the open one. Open it again, then press."
        row = next((r for r in (data or {}).get("rows") or [] if r["id"] == pinned), None)
        if row is None:
            return None, "That session isn't on the list any more."
        return row, ""

    def _press_log(self, conn, sid: str) -> Log | None:
        """sid's events read to the end, for a press, carried on from what the
        fetch already read. A fresh read from seq 0 stopped at the fetch's
        5,000-event cap, so in a long session a press never saw the pending
        request at the end (reviewer, 2026-10-05). None if it won't finish."""
        with self._lock:
            base = self._log if self._log and self._log.sid == sid else None
            log = base.copy() if base else Log(sid)
        for _ in range(PRESS_CATCH_UPS):
            self.catch_up(conn, log)
            if log.caught_up:
                return log
        return None

    def _fresh(self, conn, sid: str) -> dict:
        got = conn.call("sessions.get", {"id": sid}, timeout=CALL_TIMEOUT)
        if not isinstance(got, dict) or got.get("id") != sid:
            raise realm_client.RealmProtocolError("sessions.get answered for another session")
        return got

    def pick(self, ctx: Context, data, values: dict) -> Result:
        sid = str(values.get("row") or "")
        row = next((r for r in (data or {}).get("rows") or [] if r["id"] == sid), None)
        if row is None:
            return Result(False, "That session isn't on the list any more.")
        with self._lock:
            moved = self.pinned != sid
            self._repin(sid)
        # A draft typed for one session is not carried to the next.
        cleared = {self.p("draft"): ""} if moved else {}
        return Result(True, f"Opened the session in {row['folder'] or 'its folder'}.", updates=cleared, refetch=True)

    def send(self, ctx: Context, data, values: dict) -> Result:
        row, why = self._pinned_row(data, values)
        if row is None:
            return Result(False, why, updates={self.p("level"): "error"})
        typed = str(values.get(self.p("draft")) or "")
        text = typed.strip()
        if not text:
            return Result(False, "Type a message first.", updates={self.p("level"): "error"})
        if not self._claim("send", row["id"]):
            return Result(False, "Still sending the last one. Wait for it, then check the transcript.")
        try:
            return self._send(ctx, row, text)
        finally:
            self._release("send", row["id"])

    def _send(self, ctx: Context, row: dict, text: str) -> Result:
        sid, where = row["id"], row["folder"] or "its folder"
        bad = {self.p("level"): "error"}
        try:
            conn = self.connect(ctx)
        except realm_client.RealmError as err:
            return Result(False, f"Not sent: {rpc_words(err)}.", updates=bad)
        with conn:
            try:
                fresh = self._fresh(conn, sid)
                log = self._press_log(conn, sid)
            except realm_client.RealmError as err:
                return Result(False, f"Not sent: couldn't read the session first ({rpc_words(err)}).", updates=bad)
            if log is None:
                return Result(False, "Not sent: the session's history is too long to read to the end first.",
                              updates=bad)
            if fresh.get("status") in BUSY:
                return Result(False, f"Not sent: the session in {where} is still working. Wait, or Interrupt.",
                              updates=bad, refetch=True)
            with self._lock:
                unsure = self._unsure
            if unsure and unsure[0] == sid and unsure[1] == text and log.landed(text, unsure[2]):
                with self._lock:
                    self._unsure = None
                return Result(False, "That message already arrived; it wasn't sent again.",
                              updates={self.p("draft"): "", **bad}, refetch=True)
            before = log.seq
            try:
                conn.call("sessions.send", {"id": sid, "text": text}, timeout=CALL_TIMEOUT, write=True)
            except realm_client.RealmError as err:
                if err.maybe_applied:
                    with self._lock:
                        self._unsure = (sid, text, before)
                    return Result(False, f"It may have sent to the session in {where}: the engine took the "
                                         "message and then didn't answer. Check the transcript before "
                                         "pressing Send again.", updates={self.p("level"): "warning"},
                                  refetch=True)
                return Result(False, f"Not sent: {rpc_words(err)}", updates=bad, refetch=True)
            with self._lock:
                self._unsure = None
                self._busy = True
            try:
                self.catch_up(conn, log)
                landed = log.landed(text, before)
            except realm_client.RealmError:
                landed = False
        cleared = {self.p("draft"): ""}
        if landed:
            return Result(True, f"Sent to the session in {where}, and it's in the transcript.",
                          updates={**cleared, self.p("level"): "success"}, refetch=True)
        return Result(True, f"Sent to the session in {where}; it isn't in the transcript yet.",
                      updates={**cleared, self.p("level"): "warning"}, refetch=True)

    def allow(self, ctx: Context, data, values: dict) -> Result:
        return self._answer(ctx, data, values, "allow")

    def deny(self, ctx: Context, data, values: dict) -> Result:
        return self._answer(ctx, data, values, "deny")

    def _answer(self, ctx: Context, data, values: dict, decision: str) -> Result:
        # Never allow_always from the glass: the decision is one of these two
        # literals, set by which button was pressed, never by the press's text.
        assert decision in ("allow", "deny")
        request = str(values.get("row") or "")
        bad = {self.p("level"): "error"}
        with self._lock:
            sid = self.pinned
        row = next((r for r in (data or {}).get("rows") or [] if r["id"] == sid), None)
        if not request or row is None:
            return Result(False, "That request isn't on the panel any more. Nothing was answered.", updates=bad)
        if not self._claim("answer", request):
            return Result(False, "Still answering that request.")
        try:
            try:
                conn = self.connect(ctx)
            except realm_client.RealmError as err:
                return Result(False, f"Not answered: {rpc_words(err)}.", updates=bad)
            with conn:
                try:
                    fresh = self._fresh(conn, sid)
                    log = self._press_log(conn, sid)
                except realm_client.RealmError as err:
                    return Result(False, f"Not answered: couldn't read the session ({rpc_words(err)}).", updates=bad)
                if log is None:
                    return Result(False, "Not answered: the session's history is too long to check the request "
                                         "is still pending.", updates=bad)
                ask = log.pending.get(request)
                if fresh.get("status") != "waiting_permission" or ask is None:
                    return Result(False, "That request was already answered or withdrawn. Nothing was sent.",
                                  updates=bad, refetch=True)
                if decision == "allow":
                    _, exact = permission_view(ask["tool"], ask["input"])
                    if not exact:
                        return Result(False, "Not allowed: that request can't be shown whole here, so it can "
                                             "only be refused from the glass.", updates=bad, refetch=True)
                try:
                    conn.call("sessions.respondPermission", {"id": sid, "requestId": request, "decision": decision},
                              timeout=CALL_TIMEOUT, write=True)
                except realm_client.RealmError as err:
                    if err.maybe_applied:
                        return Result(False, "The answer may have reached the agent; the engine didn't confirm. "
                                             "Check the transcript.", updates={self.p("level"): "warning"},
                                      refetch=True)
                    return Result(False, f"Not answered: {rpc_words(err)}", updates=bad, refetch=True)
        finally:
            self._release("answer", request)
        with self._lock:
            self._busy = True
        where = row["folder"] or "its folder"
        word = "Allowed once" if decision == "allow" else "Refused"
        return Result(True, f"{word}, for the session in {where}.", updates={self.p("level"): "success"},
                      refetch=True)

    def interrupt(self, ctx: Context, data, values: dict) -> Result:
        row, why = self._pinned_row(data, values)
        if row is None:
            return Result(False, why, updates={self.p("level"): "error"})
        if not self._claim("interrupt", row["id"]):
            return Result(False, "Already stopping it.")
        where = row["folder"] or "its folder"
        try:
            try:
                with self.connect(ctx) as conn:
                    if self._fresh(conn, row["id"]).get("status") not in BUSY:
                        return Result(False, f"The session in {where} isn't working, so there was nothing to stop.",
                                      refetch=True)
                    conn.call("sessions.interrupt", {"id": row["id"]}, timeout=CALL_TIMEOUT, write=True)
            except realm_client.RealmError as err:
                if err.maybe_applied:
                    return Result(False, "The stop may have reached it; the engine didn't confirm.",
                                  updates={self.p("level"): "warning"}, refetch=True)
                return Result(False, f"Not stopped: {rpc_words(err)}", updates={self.p("level"): "error"},
                              refetch=True)
        finally:
            self._release("interrupt", row["id"])
        return Result(True, f"Stopped the turn in {where}. What it already changed stays changed.",
                      updates={self.p("level"): "success"}, refetch=True)

    def fork(self, ctx: Context, data, values: dict) -> Result:
        row, why = self._pinned_row(data, values)
        if row is None:
            return Result(False, why, updates={self.p("level"): "error"})
        if not self._claim("fork", row["id"]):
            return Result(False, "Already forking it.")
        where = row["folder"] or "its folder"
        try:
            try:
                with self.connect(ctx) as conn:
                    checkpoint = self.newest_checkpoint(conn, row)
                    if checkpoint is None:
                        return Result(False, "Nothing to fork from yet: a checkpoint is taken before each message.",
                                      refetch=True)
                    made = conn.call("sessions.fork", {"checkpointId": checkpoint}, timeout=60.0, write=True)
            except realm_client.RealmError as err:
                if err.maybe_applied:
                    return Result(False, "The fork may have been made; the engine didn't confirm. Look for a new "
                                         "session before pressing again.", updates={self.p("level"): "warning"},
                                  refetch=True)
                return Result(False, f"Not forked: {rpc_words(err)}", updates={self.p("level"): "error"},
                              refetch=True)
        finally:
            self._release("fork", row["id"])
        session = made.get("session") if isinstance(made, dict) else None
        if isinstance(session, dict) and isinstance(session.get("id"), str):
            with self._lock:
                self._repin(session["id"])
        return Result(True, f"Forked {where} into a new worktree with its own session, now open. The original "
                            "is untouched.", updates={self.p("level"): "success", self.p("draft"): ""}, refetch=True)

    def new(self, ctx: Context, data, values: dict) -> Result:
        label = str(values.get("row") or "")
        bad = {self.p("level"): "error"}
        folders = (data or {}).get("folders") or []
        hit = next((f for f in folders if f["label"] == label), None)
        if hit is None or label != str(values.get(self.p("folder")) or ""):
            return Result(False, "That folder isn't the one picked any more. Pick it again.", updates=bad)
        path = Path(hit["path"])
        try:
            real = path.resolve(strict=True)
        except (OSError, RuntimeError):
            return Result(False, "That folder is gone.", updates=bad)
        if str(real) != hit["path"] or not real.is_dir():
            return Result(False, "That folder moved since the list was read. Pick it again.", updates=bad)
        if not self._claim("new", hit["path"]):
            return Result(False, "Already starting a session there.")
        try:
            return self._new(ctx, hit)
        finally:
            self._release("new", hit["path"])

    def _new(self, ctx: Context, hit: dict) -> Result:
        name = Path(hit["path"]).name or "folder"
        made: list[str] = []

        def failed(err: realm_client.RealmError) -> Result:
            what = f" ({', '.join(made)} already made)" if made else ""
            if err.maybe_applied:
                return Result(False, f"Starting in {name} may have half run{what}; the engine didn't confirm "
                                     "the last step. Check the list before pressing again.",
                              updates={self.p("level"): "warning"}, refetch=True)
            return Result(False, f"Not started in {name}{what}: {rpc_words(err)}",
                          updates={self.p("level"): "error"}, refetch=True)

        try:
            conn = self.connect(ctx)
        except realm_client.RealmError as err:
            return failed(err)
        with conn:
            try:
                space_id, project_id = self.home_for(conn, hit["path"])
                if not space_id:
                    profiles = conn.call("profiles.list", timeout=CALL_TIMEOUT)
                    profile = next((x["id"] for x in profiles if isinstance(x, dict) and isinstance(x.get("id"), str)),
                                   None) if isinstance(profiles, list) else None
                    if profile is None:
                        profile = conn.call("profiles.create", {"name": "Kyber"}, timeout=CALL_TIMEOUT,
                                            write=True)["id"]
                        made.append("a profile")
                    space_id = conn.call("spaces.create", {"profileId": profile, "name": name, "icon": "folder"},
                                         timeout=CALL_TIMEOUT, write=True)["id"]
                    made.append("a space")
                if not project_id:
                    project_id = conn.call("projects.create", {"spaceId": space_id, "name": name,
                                                               "rootPath": hit["path"]},
                                           timeout=CALL_TIMEOUT, write=True)["id"]
                    made.append("a project")
                created = conn.call("sessions.create", {"spaceId": space_id, "agentKind": AGENT,
                                                        "projectId": project_id, "permissionMode": PERMISSION_MODE},
                                    timeout=CALL_TIMEOUT, write=True)
            except realm_client.RealmError as err:
                return failed(err)
            except (KeyError, TypeError):
                return Result(False, f"Not started in {name}: the engine answered in a shape this panel doesn't "
                                     "know.", updates={self.p("level"): "error"}, refetch=True)
        session = created.get("session") if isinstance(created, dict) else None
        if not isinstance(session, dict) or not isinstance(session.get("id"), str):
            return Result(False, f"The engine made something in {name} but didn't say which session.",
                          updates={self.p("level"): "warning"}, refetch=True)
        with self._lock:
            self._repin(session["id"])
        return Result(True, f"Started a Claude session in {name}. It asks before each tool. Type, then Send.",
                      updates={self.p("level"): "success", self.p("draft"): ""}, refetch=True)

    @staticmethod
    def home_for(conn, path: str) -> tuple[str, str]:
        """(space id, project id) of a project already rooted at path; else a
        space named for the folder with no project yet, which is what a Start
        that failed after spaces.create leaves, so a second press finishes it
        rather than making a second space and a second Realm folder;
        ("", "") when neither."""
        spaces = conn.call("spaces.list", timeout=CALL_TIMEOUT)
        half_made = ""
        for space in spaces if isinstance(spaces, list) else []:
            if not isinstance(space, dict) or not isinstance(space.get("id"), str):
                continue
            projects = conn.call("projects.list", {"spaceId": space["id"]}, timeout=CALL_TIMEOUT)
            projects = [x for x in projects if isinstance(x, dict) and isinstance(x.get("id"), str)] \
                if isinstance(projects, list) else []
            for proj in projects:
                if os.path.realpath(str(proj.get("rootPath") or "/nonexistent")) == path:
                    return space["id"], proj["id"]
            if not half_made and not projects and space.get("name") == (Path(path).name or "folder"):
                half_made = space["id"]
        return half_made, ""

    def _run_engine(self, argv: list, env: dict, timeout: float) -> tuple[int, str, str]:
        try:
            done = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, env=env)
        except FileNotFoundError:
            return 127, "", f"{argv[0]} not found"
        except subprocess.TimeoutExpired:
            return 124, "", f"took longer than {timeout:.0f}s"
        except OSError as err:
            return 126, "", str(err)
        return done.returncode, done.stdout, done.stderr

    def start_engine(self, ctx: Context, data, values: dict) -> Result:
        if str(values.get("row") or "") != "start" or not (data or {}).get("down"):
            return Result(False, "The engine is already up.", refetch=True)
        if not self._claim("engine", "start"):
            return Result(False, "Already starting the engine.")
        try:
            env = dict(os.environ, **{k: v for k, v in ctx.env.items() if k.startswith("CHEWBACCA_")})
            env["CHEWBACCA_REALM_HOME"] = str(realm_home(ctx))
            if not built(ctx):
                code, out, err = self.run_engine([sys.executable, str(ENGINE), "build"], env, BUILD_TIMEOUT)
                if code != 0:
                    return Result(False, f"The build didn't finish: {own_words(err, code)}",
                                  updates={self.p("level"): "error"}, refetch=True)
            code, out, err = self.run_engine([sys.executable, str(ENGINE), "start"], env, START_TIMEOUT)
        finally:
            self._release("engine", "start")
        said = own_words(err, code)
        if code != 0 and "already running" not in said:
            return Result(False, f"The engine didn't start: {said}", updates={self.p("level"): "error"},
                          refetch=True)
        return Result(True, "The engine is up. Pick a folder and start a session.",
                      updates={self.p("level"): "success"}, refetch=True)
