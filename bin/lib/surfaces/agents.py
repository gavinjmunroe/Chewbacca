"""agents: every coding agent's sessions on the glass, run by the realm engine, with no editor.

Replaces opening VS Code to talk to a coding agent. The engine is realm
(github.com/31Carlton7/realm, Carlton Aikins, run headless by bin/realm-engine
with his permission given in person on 2026-10-05), reached only through
bin/lib/realm_client.py, which proves the server by pid, port ownership and
realmHome before the first call and refuses any write not passed write=True.

WHAT IS ON THE PANEL. Every session the engine has, each with its space and
its state in words (waiting on you, working, failed, idle), what needs you
first. Open on a row pins that session: its newest turns in a Transcript,
read by polling sessions.events after the last seq seen, and the verbs that
apply to it right now. Below that, a Select of the agents the engine reports
as installed and not signed out (agents.probe: Claude, Codex and every ACP
agent, Cursor, Gemini, OpenCode, Copilot, goose, Qwen, Grok...), a line naming
the ones that aren't and why, a Select of folders (git repos under the code
root, default ~/code, KYBER_CODE_ROOT to move it, plus the folders sessions
already run in) and Start, which makes a session of that agent there.

ANY AGENT, ANY ACCOUNT. Nothing here names a provider except the label
table. agents.probe spawns every agent CLI to ask its version (an EXEC
method in realm_client, about 5 s cold on 2026-10-10), so it runs on its own
thread, at most every PROBE_EVERY seconds, and never inside a press. The
account is whatever each CLI is signed in to; the engine reports signed out
when it can tell, and the panel says "sign-in not checked" when it can't.

EVERY VERB IS A ROW, AND THE ROW IS THE TARGET. Send, Allow once, Deny,
Interrupt, Fork, Start and Start the engine are row buttons on Events
components (hud/CLAUDE.md, Row actions), so the press arrives carrying the id
that was on the glass: a session id, a permission requestId, a folder. A
verb that does not apply has no row and is not drawn, which is how a down
engine offers "Start the engine" and nothing that writes. Each row says what
the press touches and whether it can be undone (docs/plans/AFTER-PANES.md, Verbs).

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

TILES. Each agent is one tile (hud Tiles, AgentTiles.swift): its
provider's mark, a one-line title, its state, and what it is doing now. A
tile is a realm session, with the live state of the Claude Code or Codex tab
it came from when that tab is still open (bin/kyber-sessions discover, the
same filters: scripted runs, scratch folders and tabs that failed on their
first message are left out). Open on a tile pins it and draws its
conversation under the grid. Caleb's open tabs come in by themselves:
realm's own importer (import.apply, apps/server/src/import) copies each
recent live tab's transcript into the engine, never writing the CLI's own
files, so a tab shows here without anything to press or read about it. It is
the panel's one press-less write, so it goes through import_call, which
takes import.scan and import.apply and nothing else, and applies only keys
that same scan found on disk.

SHIPPING. The opened card stages, unstages, commits and pushes through
realm's own git write path (workspace.stage, workspace.unstage,
workspace.ship), never a git of its own. Each is a row whose text names what
the press touches: one file whose diff is open, or "all N", a row id carrying
a hash of exactly those paths; Commit and push names the staged count and the
branch and says a push can't be taken back, and its id hashes the branch, the
staged files and the typed message. The press re-reads workspace.diff and
refuses if any of that moved. No force push exists in realm, and the first
push of a branch is offered only after realm said it had no upstream.

UNTRUSTED TEXT. Turns, tool input, titles, space names and paths all come
from the engine, which relays a model and whatever it read. All of it is
stripped of Unicode category C and the line and paragraph separators before
a `d` line, clipped, and never read for an action. Result lines (which the
daemon logs to ~/.bob/surfaces-activity.jsonl) name a folder, never a
message, a title or a tool input.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import time
import unicodedata
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import realm_client

from . import ACTION_PREFIX, Bind, Context, Provider, Result, SurfaceError, ago, clock, comp, note_for
from .code import candidates, code_root

ENGINE = Path(__file__).resolve().parents[2] / "realm-engine"
KYBER_SESSIONS = Path(__file__).resolve().parents[2] / "kyber-sessions"
# The most tiles on the glass: two columns of four. What needs the person is
# never the part cut. Guessed from a 460-point panel at about 90 points a tile.
MAX_TILES = 8
# A finished agent stays a tile this long after it last moved, then leaves.
# Guessed: an afternoon's finished work, not yesterday's.
DONE_KEEP_S = 4 * 3600.0
# A live tab comes into the engine when it moved this recently. Guessed,
# the same afternoon as DONE_KEEP_S.
IMPORT_RECENT_S = 4 * 3600.0
# Seconds between silent imports, and the most tabs one pass brings in.
# import.apply re-lists every transcript on the Mac (import/service.ts
# allFound, 5,450 files on 2026-10-10) before copying, so it runs at most
# once a minute and in small batches. Guessed.
IMPORT_EVERY = 60.0
IMPORT_BATCH = 6
# import.apply copies every event of each transcript in one transaction per
# session. Not measured; two minutes for six long sessions is a guess.
APPLY_TIMEOUT = 120.0
# The only realm writes this panel makes without a press, both for bringing
# Caleb's open tabs in by themselves (his ask, 2026-10-10). import_call takes
# nothing else, so the press-less path can't be reused for any other write
# (security review, 2026-10-10). import.scan writes nothing (contracts
# import.ts) but isn't in realm_client's READ_METHODS.
IMPORT_ONLY = frozenset({"import.scan", "import.apply"})
# import.scan answered with 41,039,576 bytes for 5,446 transcripts on
# 2026-10-10, over realm_client's 32 MiB cap; this connection only takes up
# to 128 MiB, about three times that. Guessed past the one measurement.
SCAN_MAX_MESSAGE = 128 * 1024 * 1024
# Seconds a scan's keys are reused. One import.scan of 5,493 transcripts took
# 31.8 s on 2026-10-10 and the engine answered nothing else meanwhile (the
# panel read "timed out waiting for the engine"), so it runs at most every
# half hour; a tab newer than the last scan comes in on the next one, or at
# once when its tile is tapped.
SCAN_EVERY = 1800.0
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
# "default" is Realm's "Ask each time" (presets.ts PERMISSION_MODES), the one
# mode where every tool call reaches canUseTool and so this panel. A session
# made from the glass never starts in a mode that skips asking. The engine
# starts an agent it can't set a mode on at "default" whatever is sent
# (sessions/service.ts, AGENT_SUPPORTS_PERMISSION_MODES).
PERMISSION_MODE = "default"
# Agents whose permission level Realm can set, so "asks before each tool" is
# true of them. presets.ts AGENT_SUPPORTS_PERMISSION_MODES at 0ae5b8b: every
# ACP agent is false, because ACP mode ids are agent-defined.
ASKS_FIRST = ("claude", "codex")
# What each agent kind is called. presets.ts AGENT_META labels at 0ae5b8b; an
# unknown kind the engine adds later shows as its own id, never hidden.
AGENT_LABELS = {"claude": "Claude", "codex": "Codex", "acp:gemini": "Gemini", "acp:cursor": "Cursor",
                "acp:opencode": "OpenCode", "acp:copilot": "Copilot", "acp:goose": "goose", "acp:qwen": "Qwen Code",
                "acp:grok": "Grok", "acp:fx": "fx", "acp:deepseek": "DeepSeek", "acp:openhands": "OpenHands",
                "acp:hermes": "Hermes"}
# Changed files listed on an open agent's card, and the lines of one patch
# drawn. DiffView keeps the last 600 lines (hud/CLAUDE.md, Diff); twelve
# files is a glance, the rest are counted. Guessed.
CHANGED_SHOWN = 12
PATCH_LINES = 600
# Seconds between `git status` reads for the open agent's folder. Realm calls
# workspace.diff cheap (one status, two numstats); still, git is a process
# per call. Guessed.
DIFF_EVERY = 10.0
# workspace.ship commits (running the repo's own hooks), then pushes. Realm
# gives the push GIT_NETWORK_TIMEOUT_MS, 120 s (workspace/git-exec.ts at
# 59afd9e4); the press waits a minute past that for the commit's hooks.
# Guessed, never measured from the glass.
SHIP_TIMEOUT = 180.0
# The longest commit message Commit and push takes. Guessed: a subject and a
# short body. A longer one is written where the code is.
MESSAGE_CHARS = 2000
# What each ship step's state reads as on the card. ShipResultSchema in
# realm's contracts/src/rpc.ts at 59afd9e4; a state added later shows as its
# own word.
COMMIT_WORDS = {"nothing-to-commit": "Nothing was staged, so nothing was committed.",
                "no-identity": "Not committed: git has no name and email set for this Mac.",
                "failed": "Not committed: git refused it."}
PUSH_WORDS = {"up-to-date": "Already up to date with its remote.", "no-remote": "Not pushed: this repo has no remote.",
              "no-upstream": "Not pushed: this branch has never been pushed.",
              "rejected": "Not pushed: the remote moved on. Pull it in where the code is, then push.",
              "detached": "Not pushed: no branch is checked out.", "failed": "Not pushed: git refused it."}

# Terminal lines on the card: a glance at what the shell said last, the way
# the bottom of a terminal pane is read. Guessed, never measured on the glass.
TERM_LINES = 30
# A terminal line's characters on the card. The card is 460 points of 11 pt
# monospace, about 70 characters; the rest is cut. Guessed.
TERM_LINE_CHARS = 200
# The raw scrollback kept between reads. Realm's ring is 128 Ki characters
# (terminals/scrollback.ts RING_CHARS at 59afd9e4); a quarter of it holds far
# more than TERM_LINES of any shell. Guessed.
TERM_KEEP_CHARS = 32 * 1024
# After a Run or Ctrl-C press the panel reads the terminal every REFRESH_BUSY
# for this long, so the command's output arrives as it prints. Guessed: most
# commands typed from a glance answer within half a minute; a longer one keeps
# the fast reads for as long as terminals.programs says it runs.
TERM_WATCH_S = 30.0
# The longest command Run types. Guessed: a long one-liner. Anything longer
# belongs in a script.
COMMAND_CHARS = 1000

# Claude's models, which no probe can list (the claude CLI has no model list),
# so realm curates them: presets.ts AGENT_MODELS at 59afd9e4, first is the
# one an un-pinned session runs (DEFAULT_MODEL_LABEL "Fable 5.1"). Every
# other agent's models come from agents.probe, live.
CLAUDE_MODELS = (("claude-fable-5-1", "Claude Fable 5.1"), ("claude-fable-5", "Claude Fable 5"),
                 ("claude-opus-5-5", "Claude Opus 5.5"), ("claude-opus-5", "Claude Opus 5"),
                 ("claude-sonnet-5", "Claude Sonnet 5"), ("claude-haiku-4-5", "Claude Haiku 4.5"))
# realm's permission levels (presets.ts PERMISSION_MODES at 59afd9e4), what
# each chip says, and what its switch row says the press does.
PERMISSION_CHIPS = (("default", "Ask each time", "asks you before every tool it runs"),
                    ("acceptEdits", "Accept edits", "edits files without asking, asks before anything else"),
                    ("bypassPermissions", "Full access", "runs every tool without asking you"))
# Chips a picker shows. Realm lists 13 codex models on this Mac (2026-10-10);
# a glance holds about two rows of chips. Guessed.
MODEL_CHIPS = 8
# Seconds between models.catalog reads. Realm caches the catalog itself; the
# panel only needs each model's efforts, which change with a release.
# Guessed.
CATALOG_EVERY = 3600.0

# The longest address the browser pane takes, realm's own cap on a browser
# suggestion query (rpc.ts browsers.suggest, max 2,048 at 59afd9e4).
URL_CHARS = 2048
# Browser panes in one space read per refresh; the card shows the newest.
# Guessed: a space with more than three open panes is rare.
BROWSERS_READ = 3

# The order Start offers what is ready: the agents the engine ships first
# (presets.ts SELECTABLE_AGENT_KINDS order), anything else after.
AGENT_ORDER = ("claude", "codex", "acp:cursor", "acp:gemini", "acp:opencode", "acp:copilot", "acp:goose",
               "acp:qwen", "acp:grok", "acp:fx", "acp:deepseek", "acp:openhands", "acp:hermes")
# A kind is an id from the engine, so it is checked for shape before it is
# ever a row id or a word on the glass.
KIND_SHAPE = re.compile(r"^[a-z0-9][a-z0-9:_-]{0,39}$")
# Seconds between probes. The engine caches its own for 30 s (probe-cache.ts
# PROBE_TTL_MS); a cold one took 5.85 s and spawned 13 CLIs on 2026-10-10, so
# an open panel asks every five minutes, not every refresh. Guessed: a CLI
# installed meanwhile shows up within five minutes, or on reopening.
PROBE_EVERY = 300.0
# One probe's own wait. Each adapter has a 5 s timeout (probe-cache.ts) and
# they run in parallel; 30 s covers a Mac under load. Guessed.
PROBE_TIMEOUT = 30.0
# A tile's title, one line in a 210-point tile at 13 pt semibold. Guessed
# at about 7 pt a character.
TITLE_CHARS = 30
# What a tile says it is doing, at most two lines at 11.5 pt.
DETAIL_CHARS = 80
# The tile state of each realm status and each kyber-sessions state.
REALM_STATE = {"waiting_permission": "needs", "error": "failed", "running": "running"}
TAB_STATE = {"needs": "needs", "failed": "failed", "working": "running", "finished": "done"}
TILE_ORDER = {"needs": 0, "failed": 1, "running": 2, "out": 3, "done": 4}
STATE_WORDS = {"waiting_permission": "waiting on you", "running": "working", "error": "failed",
               "idle": "idle", "ended": "idle"}
# What needs the person first, then what is moving, then the rest.
STATE_ORDER = {"waiting_permission": 0, "error": 1, "running": 2, "idle": 3, "ended": 4}
BUSY = ("running", "waiting_permission")
# The pointers holding a row a press can write through.
VERBS = ("send", "allow", "deny", "interrupt", "fork", "new", "stage", "unstage", "ship", "upstream", "run", "ctrlc",
         "termopen", "mode", "go")
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


def label_of(kind: str) -> str:
    """What an agent kind is called on the glass."""
    kind = str(kind or "")
    if kind in AGENT_LABELS:
        return AGENT_LABELS[kind]
    return clean(kind.removeprefix("acp:"), 24) or "an agent"


def agent_rows(probed) -> list[dict]:
    """agents.probe's answer as {kind, label, ready, why}, in AGENT_ORDER.

    ready means installed and not reported signed out. `why` is words for
    the ones that aren't, never the engine's own reason string, which is a
    spawn error with a path in it: "spawn cursor-agent ENOENT" is "not
    installed", any other failure to run its version command is "the engine
    couldn't run it" (Codex on 2026-10-10, installed in ~/.local/bin and not
    on the engine's PATH)."""
    out = []
    for item in probed if isinstance(probed, list) else []:
        if not isinstance(item, dict) or not isinstance(item.get("kind"), str) or not KIND_SHAPE.match(item["kind"]):
            continue
        kind = item["kind"]
        if kind == "fake":
            continue
        available = item.get("available") is True
        signed = item.get("loggedIn")
        reason = str(item.get("reason") or "")
        if not available:
            why = "not installed" if "ENOENT" in reason or "not found" in reason.lower() else \
                "installed, but the engine couldn't run it"
        elif signed is False:
            why = "signed out"
        else:
            why = "" if signed is True else "sign-in not checked"
        models = []
        for m in item.get("models") if isinstance(item.get("models"), list) else []:
            if isinstance(m, dict) and isinstance(m.get("id"), str) and m["id"] and not any(hidden(c) for c in m["id"]):
                models.append({"id": m["id"][:120], "label": clean(m.get("label") or m["id"], 40),
                               "default": m.get("isDefault") is True,
                               "efforts": [clean(x, 12) for x in m.get("efforts") or [] if isinstance(x, str)
                                           and KIND_SHAPE.match(x)]})
        out.append({"kind": kind, "label": label_of(kind), "ready": available and signed is not False, "why": why,
                    "models": models})
    rank = {k: i for i, k in enumerate(AGENT_ORDER)}
    out.sort(key=lambda a: (rank.get(a["kind"], len(rank)), a["kind"]))
    return out


def missing_words(agents: list[dict]) -> str:
    """Short words for every agent that can't start a session: each broken
    one by name and why, the not-installed ones by count past the first
    three, so ten absent CLIs are one clause and not a wall."""
    parts = [f"{a['label']}: {a['why']}." for a in agents if not a["ready"] and a["why"] != "not installed"]
    absent = [a["label"] for a in agents if not a["ready"] and a["why"] == "not installed"]
    if len(absent) == 1:
        parts.append(f"{absent[0]} isn't installed.")
    elif absent:
        named = absent if len(absent) <= 3 else absent[:3] + [f"{len(absent) - 3} more"]
        parts.append(f"{', '.join(named[:-1])} and {named[-1]} aren't installed.")
    return " ".join(parts)


def short_title(text: str, limit: int = TITLE_CHARS) -> str:
    """The first clause of a title, cut on a word."""
    one = clean(text)
    one = re.split(r"\s[(\[]|[?!.](?:\s|$)|\s\u00b7\s", one, maxsplit=1)[0].strip(" ,:;-") or "Untitled"
    if len(one) <= limit:
        return one
    return one[:limit].rsplit(" ", 1)[0].rstrip(" ,:;-") + "\u2026"


# "in lemma: write the README" names the folder in the task itself.
IN_FOLDER = re.compile(r"^\s*in\s+([A-Za-z0-9_.-]{1,64})\s*[:,]\s*(.*)$", re.S | re.I)


def where_to(task: str, folders: list[dict], want: str = "") -> tuple[dict | None, str]:
    """(the folder a new agent runs in, the message it is sent). A task that
    starts "in <folder>:" picks that folder by name; a folder a sentence asked
    for (`want`) comes next; else the folder worked in most recently."""
    def named(word: str):
        hits = [f for f in folders if Path(f["path"]).name.lower() == word.lower()]
        return hits[0] if len(hits) == 1 else None

    m = IN_FOLDER.match(task or "")
    if m and named(m.group(1)):
        return named(m.group(1)), m.group(2).strip()
    if want and named(want):
        return named(want), (task or "").strip()
    return (folders[0] if folders else None), (task or "").strip()


def start_id(kind: str, label: str, task: str) -> str:
    """A Start row's id: the agent, the folder, and a hash of the message,
    so a press runs only what was on the glass when it was pressed."""
    digest = hashlib.sha256((task or "").strip().encode("utf-8", "surrogatepass")).hexdigest()[:10]
    return f"{kind}|{label}|{digest}"


def patch_text(diff) -> str:
    """workspace.fileDiff's hunks as unified diff text for the Diff view:
    `@@` headers, then +, - and space lines, stripped like every engine
    string, cut to PATCH_LINES from the top."""
    if not isinstance(diff, dict):
        return ""
    if diff.get("binary"):
        return "Binary file, no text diff."
    out = []
    for h in diff.get("hunks") or []:
        if not isinstance(h, dict):
            continue
        out.append(clean(f"@@ -{h.get('oldStart')},{h.get('oldLines')} +{h.get('newStart')},{h.get('newLines')} @@ "
                         f"{h.get('header') or ''}", 200))
        for line in h.get("lines") or []:
            if not isinstance(line, dict):
                continue
            mark = {"add": "+", "del": "-", "context": " "}.get(line.get("kind"), "\\ ")
            # Indentation is the code's, so only hidden characters go, not spaces.
            text = "".join(ch for ch in str(line.get("text") or "") if not hidden(ch) or ch == "\t")
            out.append(mark + text[:400])
    if diff.get("truncated"):
        out.append("(cut short by the engine)")
    return "\n".join(out[:PATCH_LINES])


# Escape sequences a shell prints: OSC (titles, links) to BEL or ST, CSI
# (colour, cursor), and the two-byte ESC forms. Dropped, not drawn.
OSC = re.compile(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")
CSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
ESC2 = re.compile(r"\x1b[()][0-9A-Za-z]|\x1b[@-_]")
# A clear screen or a full reset: what came before it is gone from the
# screen too.
CLEAR = re.compile(r"\x1b\[[23]J|\x1bc")


def screen_lines(raw: str) -> list[str]:
    """A terminal's raw output as the last lines a person would read: escapes
    dropped, a carriage return overwriting its line, backspaces applied,
    every hidden character gone. Stripping is not emulating: a full-screen
    program (vim, a login TUI) reads as noise here, which realm's own
    screen.ts says of a raw tail too, so the card is for shell output."""
    text = str(raw or "")
    cleared = list(CLEAR.finditer(text))
    if cleared:
        text = text[cleared[-1].end():]
    text = ESC2.sub("", CSI.sub("", OSC.sub("", text)))
    out = []
    for line in text.split("\n"):
        line = line.rstrip("\r").rsplit("\r", 1)[-1]
        chars: list[str] = []
        for ch in line:
            if ch == "\b":
                if chars:
                    chars.pop()
            elif ch == "\t":
                chars.append(" " * (8 - len(chars) % 8))
            elif not hidden(ch):
                chars.append(ch)
        out.append("".join(chars).rstrip()[:TERM_LINE_CHARS])
    while out and not out[-1]:
        out.pop()
    return out[-TERM_LINES:]


def command_id(tid: str, command: str) -> str:
    """A Run row's id: the terminal and a hash of the command, so the press
    types exactly what was in the field when the row was drawn."""
    digest = hashlib.sha256(command.encode("utf-8", "surrogatepass")).hexdigest()[:10]
    return f"run:{tid}:{digest}"


def web_address(text) -> str:
    """text as an address the card's browser pane may load: http or https
    with a host, no hidden character, no space, within URL_CHARS; else "".
    The Web view refuses anything else again on its own (WebPane.swift)."""
    url = str(text or "").strip()
    if not url or len(url) > URL_CHARS or any(hidden(ch) or ch.isspace() for ch in url):
        return ""
    m = re.match(r"^(https?)://([^/?#@\s]+)", url, re.I)
    return url if m and m.group(2) else ""


def git_files(changes) -> list[dict]:
    """workspace.diff's files whose path is safe to name and to hand back:
    a string with no hidden character."""
    files = (changes or {}).get("files") if isinstance(changes, dict) else None
    return [f for f in files or [] if isinstance(f, dict) and isinstance(f.get("path"), str) and f["path"]
            and not any(hidden(ch) for ch in f["path"])]


def paths_key(paths) -> str:
    """A short hash of a set of paths, so a press on "all of them" runs only
    on the files that were on the glass when it was pressed."""
    return hashlib.sha256("\n".join(sorted(paths)).encode("utf-8", "surrogatepass")).hexdigest()[:12]


def ship_id(branch: str, staged, message: str) -> str:
    """A Commit and push row's id: the branch, the staged files and the
    message, hashed, so the press commits exactly what was drawn."""
    text = "\x00".join([branch or "", paths_key(staged), message.strip()])
    return "ship:" + hashlib.sha256(text.encode("utf-8", "surrogatepass")).hexdigest()[:12]


def plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def ship_words(result) -> str:
    """One line for what Commit and push did, from realm's own states. Only
    the engine's words for a commit (sha and subject) are quoted; git's own
    error text never is."""
    if not isinstance(result, dict):
        return ""
    commit = result.get("commit") if isinstance(result.get("commit"), dict) else {}
    push = result.get("push") if isinstance(result.get("push"), dict) else {}
    out = []
    if commit.get("state") == "committed":
        sha = clean(commit.get("sha"), 40)[:7]
        out.append(clean(f"Committed {sha} \u201c{clean(commit.get('subject'), 60)}\u201d.", 90))
    elif commit.get("state") in COMMIT_WORDS:
        out.append(COMMIT_WORDS[commit["state"]])
    if push.get("state") == "pushed":
        where = "/".join(clean(x, 40) for x in (push.get("remote"), push.get("branch")) if x)
        out.append(f"Pushed to {where}." if where else "Pushed.")
    elif push.get("state") in PUSH_WORDS:
        out.append(PUSH_WORDS[push["state"]])
    return " ".join(out)


# What a working tab's last tool call is doing, as a phrase. kyber-sessions
# hands over the raw call ("sed -n 200,212p bin/site-gate; grep ...", "Edit:
# /x/Glass.swift"), and a shell line on a tile read as plumbing on the glass
# (screenshot, 2026-10-10).
READS = {"sed", "cat", "grep", "rg", "head", "tail", "ls", "find", "wc", "less", "awk", "jq", "tree", "stat"}
TOOL_WORDS = {"Read": "Reading", "Edit": "Editing", "MultiEdit": "Editing", "Write": "Writing", "Glob": "Finding files",
              "Grep": "Searching the code", "WebFetch": "Reading a page", "WebSearch": "Searching the web",
              "Skill": "Using a skill", "Task": "Running a subagent", "Agent": "Running a subagent",
              "TodoWrite": "Planning", "NotebookEdit": "Editing a notebook"}


def doing(detail: str) -> str:
    """A tool call as what it is doing: "Editing Glass.swift", "Running swift"."""
    text = clean(detail)
    if not text:
        return ""
    head, sep, rest = text.partition(":")
    if sep and head in TOOL_WORDS:
        name = Path(rest.strip().split()[0]).name if rest.strip() else ""
        return f"{TOOL_WORDS[head]} {name}".strip()
    if text in TOOL_WORDS:
        return TOOL_WORDS[text]
    if sep and head == "Bash":
        text = rest.strip()
    word = Path(text.split()[0]).name if text.split() else ""
    if word in READS:
        return "Reading files"
    if word in ("for", "while", "until", "sleep"):
        return "Waiting on a loop"
    if word == "git":
        sub = text.split()[1] if len(text.split()) > 1 else ""
        return f"Running git {sub}".strip()
    if word == "curl":
        return "Fetching a URL"
    return f"Running {word}" if word else ""


# A Claude Code tab that stopped on its plan's limit says "You've hit your
# weekly limit · resets Oct 16 at 7am (America/Los_Angeles)" (2026-10-10,
# two tabs). That is a wait, not a failure, so its tile is one calm line.
LIMIT = re.compile(r"hit your (?:\w+ )?limit.*?resets (?:on )?([A-Z][a-z]{2,8} \d{1,2})(?: at (\d{1,2}(?::\d\d)?\s?[ap]m))?",
                   re.I | re.S)


def out_until(text: str, name: str) -> str:
    """"Out of Claude until Oct 16, 7am", or "" when text is no limit."""
    m = LIMIT.search(clean(text))
    if not m:
        return ""
    return f"Out of {name} until {m.group(1)}" + (f", {m.group(2).replace(' ', '')}" if m.group(2) else "")


def import_call(conn, method: str, params: dict, timeout: float):
    """A press-less realm write, and only import.scan or import.apply."""
    if method not in IMPORT_ONLY:
        raise realm_client.RealmWriteRefused(f"{method} isn't an import; it needs a press")
    return conn.call(method, params, timeout=timeout, write=True)


def scanned_keys(scan) -> set[str]:
    """Every transcript key import.scan found, the only keys a press-less
    import.apply may name."""
    rows = scan.get("sessions") if isinstance(scan, dict) else None
    return {r["key"] for r in rows or [] if isinstance(r, dict) and isinstance(r.get("key"), str)}


_KS = None


def kyber_sessions():
    """bin/kyber-sessions as a module, for its discovery and filters."""
    global _KS
    if _KS is None:
        import importlib.machinery  # noqa: PLC0415
        import importlib.util  # noqa: PLC0415
        loader = importlib.machinery.SourceFileLoader("kyber_sessions_lib", str(KYBER_SESSIONS))
        spec = importlib.util.spec_from_loader("kyber_sessions_lib", loader)
        mod = importlib.util.module_from_spec(spec)
        loader.exec_module(mod)
        _KS = mod
    return _KS


def live_tabs(now: float) -> list[dict]:
    """Claude Code and Codex tabs worth a tile: kyber-sessions' interactive
    rows, kept by its own glance (needing you, working, or recently done)."""
    ks = kyber_sessions()
    return ks.glance(ks.discover(now), now)


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
                        f"{p}new": self.new, f"{p}engine": self.start_engine, f"{p}agent": self.choose,
                        f"{p}file": self.show_file, f"{p}stage": self.stage, f"{p}unstage": self.unstage,
                        f"{p}ship": self.ship, f"{p}upstream": self.upstream, f"{p}termopen": self.term_open,
                        f"{p}run": self.run, f"{p}ctrlc": self.ctrl_c, f"{p}model": self.pick_model,
                        f"{p}effort": self.pick_effort, f"{p}modepick": self.pick_mode, f"{p}mode": self.set_mode,
                        f"{p}go": self.go}
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
        # The last agents.probe, normalised (agent_rows), and when it was
        # asked. None until the first one answers.
        self._agents: list[dict] | None = None
        self._probed_at = 0.0
        self._probing = False
        self._probe_error = ""
        # Transcript keys the silent import has handed the engine, and when
        # it last ran.
        self._imported: set[str] = set()
        self._imported_at = -IMPORT_EVERY
        # The last import.scan's keys, and when it ran.
        self._scanned: set = set()
        self._scanned_at = -SCAN_EVERY
        self._importing = False
        # The open agent's changed files (sid, at, summary) and the patch a
        # press opened (sid, path, text).
        self._changes: tuple | None = None
        self._patch: tuple | None = None
        # The last Commit and push on the open agent's folder: (sid, ShipResult).
        self._shipped: tuple | None = None
        # The open agent's terminal as last read: {sid, tid, cursor, raw,
        # program}, and until when a press keeps it read every REFRESH_BUSY.
        self._term: dict | None = None
        self._term_watch = 0.0
        # session id -> (terminal item id, terminal id), from Open's press.
        self._term_ids: dict = {}
        # The open agent's space's newest browser pane: (sid, at, {id, url,
        # title, count}) or (sid, at, None).
        self._browser: tuple | None = None
        # models.catalog's efforts by lowercased model name, and when read.
        self._catalog: dict = {}
        self._catalog_at = -CATALOG_EVERY
        # What layout() draws, set by each model (_replan).
        self._plan: dict = {}
        self._shape = "{}"
        # Seams for the tests: a proven connection, the realm-engine runner,
        # the probe's thread, and the clock it is timed by.
        self.connect = lambda ctx: realm_client.connect(timeout=5.0, home=realm_home(ctx))
        self.run_engine = self._run_engine
        self.spawn = lambda fn: threading.Thread(target=fn, daemon=True).start()
        self.clock = time.monotonic
        self.tabs = live_tabs
        self.wall = time.time

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
                    pinned = self.pinned
                    base = self._log if self._log and self._log.sid == pinned else None
                    log = base.copy() if base else Log(pinned)
                checkpoint = None
                row = next((r for r in rows if r["id"] == pinned), None)
                if row is not None:
                    self.catch_up(conn, log)
                    checkpoint = self.newest_checkpoint(conn, row)
                    self.read_changes(conn, row)
                    self.read_terminal(conn, row)
                    self.read_browser(conn, row)
                    with self._lock:
                        # Published only if no press moved the pin meanwhile.
                        mine = self._log is base or self._log is None or self._log.sid != pinned
                        if self.pinned == pinned and mine:
                            self._log = log
        except realm_client.RealmError as err:
            raise SurfaceError(f"The engine stopped answering: {why_words(err)}") from None
        self._maybe_probe(ctx)
        if pinned:
            self._maybe_catalog(ctx)
        try:
            tabs = self.tabs(self.wall())
        except Exception:  # noqa: BLE001  a tab we can't read is a tile we don't draw, never a dead panel
            tabs = []
        self._maybe_import(ctx, rows, tabs)
        shown = next((r for r in rows if r["id"] == pinned), None)
        with self._lock:
            term = dict(self._term) if self._term and self._term["sid"] == pinned else None
            watching = self.clock() < self._term_watch
        self._busy = bool(shown and shown["status"] in BUSY) or any(
            t.get("state") in ("needs", "working") for t in tabs) or bool(term and (term["program"] or watching))
        with self._lock:
            if self._gen == gen:
                self._soon = False
        # A copy, not the Log: the next fetch extends the Log while the daemon
        # may still be drawing this one.
        return {"rows": rows, "pinned": pinned, "gone": gone, "checkpoint": checkpoint,
                "folders": self.folders(ctx, listed), "items": list(log.items), "pending": dict(log.pending),
                "caught_up": log.caught_up, "agents": self._agents, "probe_error": self._probe_error,
                "changes": self._changes[2] if self._changes and self._changes[0] == pinned else None,
                "patch": self._patch if self._patch and self._patch[0] == pinned else None,
                "shipped": self._shipped[1] if self._shipped and self._shipped[0] == pinned else None,
                "terminal": term, "catalog": dict(self._catalog),
                "browser": self._browser[2] if self._browser and self._browser[0] == pinned else None,
                "tabs": tabs, "now": self.wall()}

    # ── bringing tabs in ─────────────────────────────────────────────────

    def _maybe_import(self, ctx: Context, rows: list[dict], tabs: list[dict]) -> None:
        """Copy recent live tabs into the engine, on a thread, a few at a time.

        This is the one write the panel makes without a press, and it is a
        copy: import.apply reads the CLI's transcript and writes only realm's
        own database; the engine refuses a key its own listing did not find
        and skips one it already imported (contracts import.ts)."""
        known = {r.get("provider_sid") for r in rows if r.get("provider_sid")}
        now = self.wall()
        with self._lock:
            if self._importing or self.clock() - self._imported_at < IMPORT_EVERY:
                return
            want = [t for t in tabs if t.get("transcript") and t["id"] not in known
                    and t["transcript"] not in self._imported and now - float(t.get("last") or 0) <= IMPORT_RECENT_S
                    and t.get("agent") in ("claude", "codex")]
            if not want:
                return
            want = want[:IMPORT_BATCH]
            self._importing = True
            self._imported_at = self.clock()
            self._imported |= {t["transcript"] for t in want}

        def work() -> None:
            try:
                with self.connect(ctx) as conn:
                    profiles = conn.call("profiles.list", timeout=CALL_TIMEOUT)
                    profile = next((x["id"] for x in profiles if isinstance(x, dict)
                                    and isinstance(x.get("id"), str)), None) if isinstance(profiles, list) else None
                    if profile is None:
                        return
                    # Apply only what this same scan found: a tab's path is
                    # never handed to the engine on kyber-sessions' word alone.
                    with self._lock:
                        stale = self.clock() - self._scanned_at >= SCAN_EVERY
                        found = set(self._scanned)
                    if stale:
                        conn.max_message = SCAN_MAX_MESSAGE
                        found = scanned_keys(import_call(conn, "import.scan", {}, APPLY_TIMEOUT))
                        with self._lock:
                            self._scanned, self._scanned_at = found, self.clock()
                    keys = [t["transcript"] for t in want if t["transcript"] in found]
                    with self._lock:
                        # Not on disk as realm sees it yet: tried again next pass.
                        self._imported -= {t["transcript"] for t in want} - found
                    if keys:
                        import_call(conn, "import.apply", {"sessions": [{"key": k, "spaceId": None, "profileId": profile}
                                                                        for k in keys]}, APPLY_TIMEOUT)
            except realm_client.RealmError as err:
                if not err.maybe_applied:
                    # Nothing reached the engine: let the next pass try them.
                    with self._lock:
                        self._imported -= {t["transcript"] for t in want}
            finally:
                with self._lock:
                    self._importing = False
                    self._soon = True

        self.spawn(work)

    # ── which agents ─────────────────────────────────────────────────────

    def _maybe_probe(self, ctx: Context) -> None:
        """Ask the engine which agents are installed, on a thread, when the
        last answer is older than PROBE_EVERY. A fetch never waits on it."""
        with self._lock:
            due = self._agents is None or self.clock() - self._probed_at >= PROBE_EVERY
            if self._probing or not due:
                return
            self._probing = True
            self._probed_at = self.clock()

        def work() -> None:
            try:
                with self.connect(ctx) as conn:
                    got = conn.call("agents.probe", {"force": False}, timeout=PROBE_TIMEOUT, allow_exec=True)
                agents, why = agent_rows(got), ""
            except realm_client.RealmError as err:
                agents, why = None, why_words(err)
            with self._lock:
                if agents is not None:
                    self._agents = agents
                self._probe_error = why
                self._probing = False
                self._soon = True

        self.spawn(work)

    def _maybe_catalog(self, ctx: Context) -> None:
        """models.catalog's efforts per model name, on a thread, at most every
        CATALOG_EVERY seconds, only while an agent's card is open."""
        with self._lock:
            if self.clock() - self._catalog_at < CATALOG_EVERY:
                return
            self._catalog_at = self.clock()

        def work() -> None:
            try:
                with self.connect(ctx) as conn:
                    got = conn.call("models.catalog", {"force": False}, timeout=PROBE_TIMEOUT)
            except realm_client.RealmError:
                return  # no catalog: the effort chips fall back to what the agent itself reported
            rows = got.get("rows") if isinstance(got, dict) else None
            table = {}
            for r in rows if isinstance(rows, list) else []:
                if isinstance(r, dict) and isinstance(r.get("label"), str) and isinstance(r.get("efforts"), list):
                    table[clean(r["label"], 60).lower()] = [clean(x, 12) for x in r["efforts"]
                                                            if isinstance(x, str) and KIND_SHAPE.match(x)]
            with self._lock:
                self._catalog = table
                self._soon = True

        self.spawn(work)

    def read_changes(self, conn, row: dict) -> None:
        """The open agent's changed files, from realm's own git read
        (workspace.diff, an EXEC method: it runs git in the session's folder,
        the same read Realm's diff pane makes), every DIFF_EVERY seconds."""
        cwd = row.get("cwd_raw") or ""
        with self._lock:
            fresh = self._changes and self._changes[0] == row["id"] and self.clock() - self._changes[1] < DIFF_EVERY
        if fresh or not cwd.startswith("/"):
            return
        try:
            got = conn.call("workspace.diff", {"cwd": cwd}, timeout=CALL_TIMEOUT, allow_exec=True)
        except realm_client.RealmRpcError:
            got = None  # not a repository, or git refused: the card shows no Changed list
        with self._lock:
            self._changes = (row["id"], self.clock(), got if isinstance(got, dict) else None)

    def terminal_of(self, conn, row: dict) -> str:
        """The terminal id of the session's own terminal panel, or "".

        Realm hides a session's terminal item from items.list (store/items.ts
        listIncludingHidden is server-only), so its id is known only from
        the sessions.openTerminal a press made, kept per session with the
        item it named; it counts only while the session still names that
        item. Found live on 2026-10-10: the first build looked it up in
        items.list and never saw the terminal it had just opened."""
        with self._lock:
            known = self._term_ids.get(row["id"])
        if not known or not row.get("terminal_item") or row["terminal_item"] != known[0]:
            return ""
        return known[1]

    def read_terminal(self, conn, row: dict) -> None:
        """What the open agent's terminal printed since the last read
        (terminals.read from a cursor, realm's own scrollback), and what it is
        running (terminals.programs). Reads only; the pty is never written."""
        tid = self.terminal_of(conn, row)
        if not tid:
            with self._lock:
                if self._term and self._term["sid"] == row["id"]:
                    self._term = None
            return
        with self._lock:
            prev = self._term if self._term and self._term["sid"] == row["id"] and self._term["tid"] == tid else None
        got = conn.call("terminals.read", {"terminalId": tid, "cursor": prev["cursor"] if prev else None},
                        timeout=CALL_TIMEOUT)
        if not isinstance(got, dict):
            return
        live = str(got.get("live") or "")
        history = got.get("history") if isinstance(got.get("history"), dict) else None
        fresh = prev is None or got.get("truncated") or got.get("runId") != prev["cursor"]["runId"] or history
        raw = (str(history.get("data") or "") if history else "") + live if fresh else prev["raw"] + live
        programs = conn.call("terminals.programs", {}, timeout=CALL_TIMEOUT)
        program = programs.get(tid) if isinstance(programs, dict) else None
        with self._lock:
            self._term = {"sid": row["id"], "tid": tid, "raw": raw[-TERM_KEEP_CHARS:],
                          "cursor": {"runId": str(got.get("runId") or ""), "seq": int(got.get("seq") or 0)},
                          "program": clean(program.get("label"), 30) if isinstance(program, dict) else "",
                          "running": bool(got.get("running"))}

    def read_browser(self, conn, row: dict) -> None:
        """The newest browser pane in the open agent's space (items of kind
        browser, then browsers.get for each), every DIFF_EVERY seconds."""
        with self._lock:
            fresh = self._browser and self._browser[0] == row["id"] and self.clock() - self._browser[1] < DIFF_EVERY
        if fresh or not row.get("space_id"):
            return
        items = conn.call("items.list", {"spaceId": row["space_id"]}, timeout=CALL_TIMEOUT)
        refs = [i.get("refId") for i in items if isinstance(i, dict) and i.get("kind") == "browser"
                and not i.get("archived") and isinstance(i.get("refId"), str)] if isinstance(items, list) else []
        panes = []
        for ref in refs[-BROWSERS_READ:]:
            try:
                got = conn.call("browsers.get", {"browserId": ref}, timeout=CALL_TIMEOUT)
            except realm_client.RealmRpcError:
                continue  # closed between the list and the read
            if isinstance(got, dict) and got.get("id") == ref:
                panes.append(got)
        panes.sort(key=lambda b: b.get("updatedAt") if isinstance(b.get("updatedAt"), (int, float)) else 0)
        pane = panes[-1] if panes else None
        found = {"id": pane["id"], "url": str(pane.get("url") or ""), "title": clean(pane.get("title"), 60),
                 "count": len(refs)} if pane and not any(hidden(ch) for ch in pane["id"]) else None
        with self._lock:
            self._browser = (row["id"], self.clock(), found)

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
                "cwd_raw": cwd if not any(hidden(ch) for ch in cwd) else "",
                "agent": label_of(s.get("agentKind")), "kind": clean(s.get("agentKind"), 40),
                "mode": clean(s.get("permissionMode"), 30),
                "model": s.get("model") if isinstance(s.get("model"), str) else "",
                "effort": s.get("effort") if isinstance(s.get("effort"), str) else "",
                "environment": s.get("environmentId") if isinstance(s.get("environmentId"), str) else "",
                "space_id": s.get("spaceId") if isinstance(s.get("spaceId"), str) else "",
                "terminal_item": s.get("terminalItemId") if isinstance(s.get("terminalItemId"), str) else "",
                "provider_sid": s.get("providerSessionId") if isinstance(s.get("providerSessionId"), str) else "",
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
            # The home folder is where a tab was opened, not a project: a new
            # agent there read "Claude in joelnewton" (screenshot, 2026-10-10).
            if text == os.path.realpath(ctx.home):
                return
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
            "The engine is realm, Carlton Aikins' open source agent server. It runs Claude, Codex, Cursor, "
            "Gemini and the other ACP agents on this Mac with no editor or terminal window, and listens only "
            "on this Mac (127.0.0.1).",
            ("Build and start downloads realm from github.com/31Carlton7/realm and builds it once, a few "
             "minutes, with node and pnpm." if not ready else
             "Start the engine runs it in the background. `realm-engine stop` stops it."),
            "Then pick an agent and a folder, start a session, and type to it here. A Claude or Codex "
            "session started here asks you before every tool it runs.",
        ]
        return {"down": {"headline": headline, "steps": steps, "why": why_words(err), "built": ready}}

    # ── drawing ──────────────────────────────────────────────────────────

    def shape(self) -> str:
        """What is drawn, as set by the last model. The daemon redraws the
        surface whole when it changes (kyber-surfaces push), so a lane that
        empties takes its rows with it rather than leaving blank space."""
        return self._shape

    def layout(self) -> list[str]:
        p, c = self.p, self.cid
        plan = self._plan
        parts = [comp(c("s"), "Screen", title=self.title)]
        order = []
        if plan.get("note"):
            parts.append(comp(c("note"), "Text", value=Bind(p("note")), tone="muted"))
            order.append("note")
        if plan.get("down"):
            parts += [comp(c("setup"), "List", items=Bind(p("setup"))),
                      comp(c("engine"), "Events", caption="", items=Bind(p("engine")),
                           action=f"{ACTION_PREFIX}engine", actionLabel=Bind(p("engineLabel")))]
            order += ["setup", "engine"]
        if plan.get("tiles"):
            parts.append(comp(c("tiles"), "Tiles", items=Bind(p("tiles")), counts=Bind(p("counts")),
                              action=f"{ACTION_PREFIX}pick"))
            order.append("tiles")
        if plan.get("pinned"):
            parts += [comp(c("head"), "Heading", text=Bind(p("head")), level=2),
                      comp(c("meta"), "Text", value=Bind(p("meta")), tone="muted"),
                      comp(c("transcript"), "Transcript", items=Bind(p("transcript")))]
            order += ["head", "meta", "transcript"]
            if plan.get("ask"):
                parts.append(comp(c("ask"), "Text", value=Bind(p("ask"))))
                order.append("ask")
            parts += [comp(c("allow"), "Events", caption="", items=Bind(p("allow")),
                           action=f"{ACTION_PREFIX}allow", actionLabel="Allow once"),
                      comp(c("deny"), "Events", caption="", items=Bind(p("deny")), action=f"{ACTION_PREFIX}deny",
                           actionLabel="Deny"),
                      comp(c("draft"), "Field", label="Reply", placeholder=Bind(p("placeholder")),
                           value=Bind(p("draft"))),
                      comp(c("send"), "Events", caption="", items=Bind(p("send")), action=f"{ACTION_PREFIX}send",
                           actionLabel="Send"),
                      comp(c("models"), "Chips", options=Bind(p("models")), value=Bind(p("modelValue")),
                           action=f"{ACTION_PREFIX}model", dots=False),
                      comp(c("efforts"), "Chips", options=Bind(p("efforts")), value=Bind(p("effortValue")),
                           action=f"{ACTION_PREFIX}effort", dots=False),
                      comp(c("modes"), "Chips", options=Bind(p("modes")), value=Bind(p("modeValue")),
                           action=f"{ACTION_PREFIX}modepick", dots=False),
                      comp(c("mode"), "Events", caption="", items=Bind(p("mode")), action=f"{ACTION_PREFIX}mode",
                           actionLabel="Switch"),
                      comp(c("interrupt"), "Events", caption="", items=Bind(p("interrupt")),
                           action=f"{ACTION_PREFIX}interrupt", actionLabel="Stop"),
                      comp(c("fork"), "Events", caption="", items=Bind(p("fork")), action=f"{ACTION_PREFIX}fork",
                           actionLabel="Fork")]
            order += ["allow", "deny", "draft", "send", "models", "efforts", "modes", "mode", "interrupt", "fork"]
            if plan.get("changed"):
                parts.append(comp(c("changed"), "Events", caption=Bind(p("changedCap")), items=Bind(p("changed")),
                                  action=f"{ACTION_PREFIX}file", actionLabel="Diff"))
                order.append("changed")
            if plan.get("patch"):
                parts.append(comp(c("patch"), "Diff", text=Bind(p("patch")), path=Bind(p("patchPath"))))
                order.append("patch")
            if plan.get("git"):
                parts += [comp(c("stage"), "Events", caption="", items=Bind(p("stage")),
                               action=f"{ACTION_PREFIX}stage", actionLabel="Stage"),
                          comp(c("unstage"), "Events", caption="", items=Bind(p("unstage")),
                               action=f"{ACTION_PREFIX}unstage", actionLabel="Unstage")]
                order += ["stage", "unstage"]
            if plan.get("ship"):
                parts += [comp(c("message"), "Field", label="Commit message",
                               placeholder="What these changes do", value=Bind(p("message"))),
                          comp(c("ship"), "Events", caption="", items=Bind(p("ship")),
                               action=f"{ACTION_PREFIX}ship", actionLabel="Commit and push")]
                order += ["message", "ship"]
            if plan.get("shipped"):
                parts.append(comp(c("shipped"), "Text", value=Bind(p("shipped")), tone="muted"))
                order.append("shipped")
            if plan.get("upstream"):
                parts.append(comp(c("upstream"), "Events", caption="", items=Bind(p("upstream")),
                                  action=f"{ACTION_PREFIX}upstream", actionLabel="Push"))
                order.append("upstream")
            if plan.get("terminal"):
                parts += [comp(c("termhead"), "Text", value=Bind(p("termHead")), tone="muted"),
                          comp(c("terminal"), "Diff", text=Bind(p("terminal")), plain=True),
                          comp(c("command"), "Field", label="Terminal", placeholder=Bind(p("commandHint")),
                               value=Bind(p("command"))),
                          comp(c("run"), "Events", caption="", items=Bind(p("run")), action=f"{ACTION_PREFIX}run",
                               actionLabel="Run"),
                          comp(c("ctrlc"), "Events", caption="", items=Bind(p("ctrlc")),
                               action=f"{ACTION_PREFIX}ctrlc", actionLabel="Ctrl-C")]
                order += ["termhead", "terminal", "command", "run", "ctrlc"]
            if plan.get("web"):
                parts += [comp(c("webhead"), "Text", value=Bind(p("webHead")), tone="muted"),
                          comp(c("web"), "Web", url=Bind(p("webUrl")))]
                order += ["webhead", "web"]
            if plan.get("address"):
                parts += [comp(c("address"), "Field", label="Address", placeholder="https://",
                               value=Bind(p("address"))),
                          comp(c("go"), "Events", caption="", items=Bind(p("go")), action=f"{ACTION_PREFIX}go",
                               actionLabel="Go")]
                order += ["address", "go"]
            if plan.get("termopen"):
                parts.append(comp(c("termopen"), "Events", caption="", items=Bind(p("termopen")),
                                  action=f"{ACTION_PREFIX}termopen", actionLabel="Open"))
                order.append("termopen")
        if plan.get("start"):
            parts += [comp(c("kinds"), "Chips", options=Bind(p("kinds")), value=Bind(p("agent")),
                           action=f"{ACTION_PREFIX}agent"),
                      comp(c("task"), "Field", label="New agent", placeholder="Ask an agent to…",
                           value=Bind(p("task"))),
                      comp(c("new"), "Events", caption="", items=Bind(p("new")), action=f"{ACTION_PREFIX}new",
                           actionLabel="Start")]
            order += ["kinds", "task", "new"]
        parts.append(comp(c("status"), "Status", message=Bind(p("status")), level=Bind(p("level"))))
        order.append("status")
        return parts + [f"> {c('s')} " + " ".join(c(i) for i in order), f"r {c('s')}"]

    def initial(self) -> dict:
        return {self.p("draft"): "", self.p("task"): "", self.p("agent"): "", self.p("message"): "",
                self.p("command"): "", self.p("address"): "",
                self.p("status"): "", self.p("level"): "info"}

    def blank(self) -> dict:
        p = self.p
        return {p("note"): "", p("setup"): [], p("engine"): [], p("engineLabel"): "Start the engine", p("head"): "",
                p("meta"): "", p("transcript"): [], p("ask"): "", p("allow"): [], p("deny"): [], p("send"): [],
                p("interrupt"): [], p("fork"): [], p("new"): [], p("kinds"): [], p("tiles"): [],
                p("counts"): {"needs": 0, "running": 0, "done": 0}, p("changed"): [], p("changedCap"): "",
                p("patch"): "", p("patchPath"): "", p("stage"): [], p("unstage"): [], p("ship"): [],
                p("shipped"): "", p("upstream"): [], p("shipping"): False,
                p("termHead"): "", p("terminal"): "", p("commandHint"): "", p("run"): [], p("ctrlc"): [],
                p("termopen"): [], p("termOn"): False,
                p("models"): [], p("modelValue"): "", p("efforts"): [], p("effortValue"): "", p("modes"): [],
                p("mode"): [], p("webHead"): "", p("webUrl"): "", p("go"): [], p("addressOn"): False,
                p("placeholder"): "Typed here, sent only by Send"}

    def model(self, data, error, values, ctx) -> dict:
        out = self._model(data, error, values, ctx)
        if error and data is not None and not data.get("down"):
            # A refresh failed after the engine had answered before: the tiles
            # are the last good read, kept to be read (rule 7), but no verb is
            # offered on them, since the engine those verbs need isn't answering.
            for verb in VERBS:
                out[self.p(verb)] = []
            out[self.p("placeholder")] = "The engine isn't answering. Nothing can be sent until it does."
        self._replan(data, out)
        return out

    def _replan(self, data, out: dict) -> None:
        """Set what layout() draws from what the model holds."""
        p = self.p
        plan: dict = {"note": bool(out.get(p("note")))}
        if data is not None and data.get("down"):
            plan["down"] = True
        elif data is not None:
            plan.update(tiles=bool(out.get(p("tiles"))), pinned=bool(out.get(p("head"))),
                        changed=bool(out.get(p("changed"))), patch=bool(out.get(p("patch"))),
                        git=bool(out.get(p("stage")) or out.get(p("unstage"))), ship=bool(out.get(p("shipping"))),
                        shipped=bool(out.get(p("shipped"))), upstream=bool(out.get(p("upstream"))),
                        terminal=bool(out.get(p("termOn"))), termopen=bool(out.get(p("termopen"))),
                        web=bool(out.get(p("webUrl"))), address=bool(out.get(p("addressOn"))),
                        ask=bool(out.get(p("ask"))), start=bool(out.get(p("kinds"))))
        with self._lock:
            self._plan = plan
            self._shape = json.dumps(plan, sort_keys=True)

    def tiles(self, data) -> list[dict]:
        """Every agent worth a tile: realm sessions, with the live state of
        the tab each came from, then live tabs not in the engine yet. What
        needs the person first, then what is moving, then the newest done."""
        now = float(data.get("now") or time.time())
        tabs = {t["id"]: t for t in data.get("tabs") or [] if isinstance(t, dict) and t.get("id")}
        out, used = [], set()
        for r in data["rows"]:
            tab = tabs.get(r.get("provider_sid") or "")
            if tab:
                used.add(tab["id"])
            state = TAB_STATE.get(tab["state"], "done") if tab else REALM_STATE.get(r["status"], "done")
            last = float(tab["last"]) if tab else (r["updated"] or 0) / 1000
            if state == "done" and now - last > DONE_KEEP_S:
                continue
            detail = (tab.get("ask") or (doing(tab.get("detail")) if state == "running" else tab.get("detail"))) \
                if tab else \
                {"needs": "Waiting on you", "failed": "Stopped with an error"}.get(state, "")
            where = (tab.get("project") if tab else "") or r["folder"] or r["space"]
            out.append({"id": r["id"], "state": state, "provider": r["kind"], "name": r["agent"],
                        "title": r["title"], "detail": detail, "where": where, "last": last,
                        "open_in": (tab or {}).get("open_in", "")})
        for t in tabs.values():
            if t["id"] in used or (TAB_STATE.get(t.get("state")) == "done"
                                   and now - float(t.get("last") or 0) > DONE_KEEP_S):
                continue
            kind = "codex" if t.get("agent") == "codex" else "claude"
            out.append({"id": f"tab:{t['id']}", "state": TAB_STATE.get(t.get("state"), "done"), "provider": kind,
                        "name": label_of(kind), "title": t.get("title") or "", "detail": t.get("ask") or (
                            doing(t.get("detail")) if t.get("state") == "working" else t.get("detail") or ""),
                        "where": t.get("project") or "", "last": float(t.get("last") or 0),
                        "open_in": t.get("open_in", "")})
        for t in out:
            calm = out_until(t["detail"], t["name"]) if t["state"] in ("failed", "needs") else ""
            if calm:
                t["state"], t["detail"] = "out", calm
        out.sort(key=lambda x: (TILE_ORDER.get(x["state"], 9), -x["last"]))
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
        pinned = data.get("pinned")
        tiles = self.tiles(data)
        counts = {"needs": 0, "running": 0, "done": 0}
        for t in tiles:
            if t["state"] in counts or t["state"] == "failed":
                counts["needs" if t["state"] in ("needs", "failed") else t["state"]] += 1
        if pinned and any(t["id"] == pinned for t in tiles):
            # Open: the tile stays and the others give it the room, so the
            # card reads as that tile opened. A press on it closes it again.
            tiles = [t for t in tiles if t["id"] == pinned]
        out[p("counts")] = counts
        out[p("tiles")] = [{
            "id": t["id"], "state": t["state"], "provider": t["provider"], "name": t["name"],
            "title": short_title(t["title"]), "detail": clean(t["detail"], DETAIL_CHARS),
            "meta": " · ".join(x for x in (clean(t["where"], 24), ago(datetime.fromtimestamp(t["last"]).astimezone()
                                                                       if t["last"] else None, now),
                                           clean(t["open_in"], 16)) if x),
            "selected": t["id"] == pinned} for t in tiles[:MAX_TILES]]
        empty = "" if tiles else "No agents running."
        if data.get("gone"):
            empty = ("The agent you had open is gone from the engine. " + empty).strip()
        out[p("note")] = note_for(data, error, empty, data.get("_at"))
        self.start_model(data, values, out)
        shown = next((r for r in rows if r["id"] == pinned), None)
        if shown is None:
            return out
        pending = data.get("pending") or {}
        out[p("head")] = short_title(shown["title"], 60)
        mode = (MODE_WORDS.get(shown["mode"], shown["mode"]) if shown["kind"] in ASKS_FIRST
                else "decides when it asks")
        out[p("meta")] = " · ".join(x for x in (shown["agent"], shown["state"], shown["cwd"], mode) if x)
        out[p("transcript")] = list(data.get("items") or [])
        changes = data.get("changes") or {}
        files = git_files(changes)
        if files:
            total = int(changes.get("totalFiles") or len(files))
            out[p("changedCap")] = f"Changed, {total} file{'s' if total != 1 else ''}" + (
                f" on {clean(changes.get('branch'), 40)}" if changes.get("branch") else "")
            out[p("changed")] = [{"id": f["path"], "text": clean(f["path"], 70), "time": " · ".join(x for x in (
                clean(f.get("status"), 12), f"+{int(f.get('additions') or 0)} -{int(f.get('deletions') or 0)}"
                if not f.get("binary") else "binary",
                ("staged" if not f.get("unstaged") else "partly staged") if f.get("staged") else "") if x)}
                for f in files[:CHANGED_SHOWN]]
        patch = data.get("patch")
        if patch:
            out[p("patch")], out[p("patchPath")] = patch[2], clean(patch[1], 120)
        self.git_model(shown, files, changes, patch, data.get("shipped"), values, out)
        self.terminal_model(shown, data.get("terminal"), values, out)
        self.options_model(shown, data, values, out)
        self.browser_model(shown, data.get("browser"), values, out)
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
            # The row names the checkpoint drawn, so a turn that lands
            # between drawing and pressing can't move what gets forked.
            out[p("fork")] = [{"id": f"{shown['id']}@{data['checkpoint']}", "text": f"Copies {where} as it was before your last message "
                                                           "into a new worktree, with a new session · the "
                                                           "original is untouched"}]
        return out

    def git_model(self, shown: dict, files: list, changes: dict, patch, shipped, values: dict, out: dict) -> None:
        """Stage, Unstage, and Commit and push, each row saying what the
        press touches before it is pressed. Nothing here writes."""
        p = self.p
        if shipped:
            out[p("shipped")] = ship_words(shipped)
            push = shipped.get("push") if isinstance(shipped.get("push"), dict) else {}
            branch = clean(push.get("branch"), 60)
            if push.get("state") == "no-upstream" and branch and shown["status"] not in BUSY:
                remote = clean(push.get("remote"), 40) or "its remote"
                out[p("upstream")] = [{"id": f"upstream:{branch}", "accent": True, "text": clean(
                    f"{branch} to {remote}, and track it there · its first push", 100)}]
        if not files or not shown.get("cwd_raw"):
            return
        loose = [f["path"] for f in files if f.get("unstaged")]
        staged = [f["path"] for f in files if f.get("staged")]
        open_file = next((f for f in files if patch and f["path"] == patch[1]), None)
        if open_file and open_file.get("unstaged"):
            out[p("stage")].append({"id": f"file:{open_file['path']}", "text": clean(
                f"{Path(open_file['path']).name} · Unstage takes it back", 90)})
        if len(loose) > 1 or (loose and not open_file):
            out[p("stage")].append({"id": f"all:{paths_key(loose)}", "text": f"All {plural(len(loose), 'unstaged file')}"
                                                                           " · Unstage takes them back"})
        if open_file and open_file.get("staged"):
            out[p("unstage")].append({"id": f"file:{open_file['path']}", "text": clean(
                f"{Path(open_file['path']).name} · out of the commit, its edits stay", 90)})
        if not staged or shown["status"] in BUSY:
            return
        # The Field shows whenever something is staged; the row only once a
        # message is typed, and its id carries that message.
        out[p("ship")] = []
        message = str(values.get(p("message")) or "").strip()
        branch = clean(changes.get("branch"), 60)
        if message and len(message) <= MESSAGE_CHARS:
            out[p("ship")] = [{"id": ship_id(branch, staged, message), "accent": True, "text": clean(
                f"{plural(len(staged), 'staged file')} on {branch or 'this checkout'}, then pushed"
                " · a push can't be taken back here", 120)}]
        out[p("shipping")] = True

    def models_for(self, kind: str, data) -> list[dict]:
        """The models a session of this agent can be switched to: Claude's
        curated list, else what agents.probe reported, each with the
        efforts it takes (the agent's own word first, then the catalog's)."""
        catalog = (data or {}).get("catalog") or {}
        if kind == "claude":
            models = [{"id": i, "label": label, "default": n == 0, "efforts": []}
                      for n, (i, label) in enumerate(CLAUDE_MODELS)]
        else:
            agent = next((a for a in (data or {}).get("agents") or [] if a["kind"] == kind), None)
            models = [dict(m) for m in (agent or {}).get("models") or []]
        for m in models:
            if not m["efforts"]:
                m["efforts"] = list(catalog.get(m["label"].lower()) or [])
        return models

    def options_model(self, shown: dict, data, values: dict, out: dict) -> None:
        """Model, effort and permission chips for the open session. A model
        or effort chip applies on its press; a permission chip only picks,
        and a Switch row naming what the agent may then do applies it."""
        p, sid = self.p, shown["id"]
        models = self.models_for(shown["kind"], data)
        current = next((m for m in models if m["id"] == shown["model"]), None) or next(
            (m for m in models if m["default"]), None) or (models[0] if models else None)
        if models:
            shown_models = models[:MODEL_CHIPS]
            if current and current not in shown_models:
                shown_models = shown_models[:-1] + [current]
            out[p("models")] = [{"id": f"{sid}|{m['id']}", "label": m["label"].removeprefix("Claude ")}
                                for m in shown_models]
            out[p("modelValue")] = f"{sid}|{current['id']}" if current else ""
        efforts = (current or {}).get("efforts") or []
        if efforts:
            out[p("efforts")] = [{"id": f"{sid}|", "label": "Default effort"}] + [
                {"id": f"{sid}|{e}", "label": e.capitalize()} for e in efforts]
            out[p("effortValue")] = f"{sid}|{shown['effort'] if shown['effort'] in efforts else ''}"
        if shown["kind"] not in ASKS_FIRST:
            return
        out[p("modes")] = [{"id": f"{sid}|{m}", "label": label} for m, label, _ in PERMISSION_CHIPS]
        now = shown["mode"] if shown["mode"] in [m for m, _, _ in PERMISSION_CHIPS] else "default"
        picked = str(values.get(p("modeValue")) or "")
        want = picked.partition("|")[2] if picked.startswith(f"{sid}|") else now
        want = want if want in [m for m, _, _ in PERMISSION_CHIPS] else now
        out[p("modeValue")] = f"{sid}|{want}"
        if want != now:
            label, does = next((lbl, d) for m, lbl, d in PERMISSION_CHIPS if m == want)
            out[p("mode")] = [{"id": f"{sid}|{now}>{want}", "accent": True, "text": clean(
                f"{label} for {shown['title']}: it {does}", 120)}]

    def browser_model(self, shown: dict, pane, values: dict, out: dict) -> None:
        """The agent's browser pane, live, inside its card, and an address
        field whose Go row says which pane it loads into."""
        p = self.p
        if not shown.get("space_id"):
            return
        out[p("addressOn")] = True
        if pane:
            url = web_address(pane["url"])
            host = re.sub(r"^https?://", "", url, flags=re.I).split("/", 1)[0] if url else ""
            more = f" · {plural(pane['count'], 'pane')} in this space" if pane["count"] > 1 else ""
            # A pane realm made with no title is called "Browser", which read
            # "Browser · Browser · example.com" on the glass (2026-10-10).
            if pane["title"].lower() in ("browser", "new tab"):
                pane = dict(pane, title="")
            out[p("webUrl")] = url
            out[p("webHead")] = clean(f"Browser · {pane['title'] or host or 'a blank page'}"
                                      f"{' · ' + host if host and pane['title'] else ''}{more}", 100)
        typed = web_address(values.get(p("address")))
        if typed:
            target = "its browser pane" if pane else "a new browser pane in its space"
            out[p("go")] = [{"id": ("go:" if pane else "new:") + (pane["id"] if pane else shown["space_id"]) + "|"
                             + hashlib.sha256(typed.encode()).hexdigest()[:10], "accent": True,
                             "text": clean(f"Loads it in {target} · only http and https", 90)}]

    def terminal_model(self, shown: dict, term, values: dict, out: dict) -> None:
        """The agent's own terminal inside its card: the last lines it printed,
        a field, and Run and Ctrl-C rows naming the shell they type into."""
        p = self.p
        where = shown["folder"] or "its folder"
        if not term:
            out[p("termopen")] = [{"id": f"open:{shown['id']}", "text": clean(
                f"A shell in {where}, kept with this agent · nothing runs until you type", 100)}]
            return
        tid = term["tid"]
        out[p("termOn")] = True
        lines = screen_lines(term.get("raw"))
        out[p("terminal")] = "\n".join(lines) if lines else "(nothing printed yet)"
        state = f"running {term['program']}" if term.get("program") else (
            "shell idle" if term.get("running") else "the shell exited")
        out[p("termHead")] = clean(f"Terminal in {where} · {state}", 80)
        out[p("commandHint")] = clean(f"A command for the shell in {where}", 60)
        command = str(values.get(p("command")) or "")
        if command.strip() and len(command) <= COMMAND_CHARS and not any(hidden(ch) for ch in command):
            out[p("run")] = [{"id": command_id(tid, command), "accent": True, "text": clean(
                f"Types it into the shell in {where} and presses Return · a command can't be taken back", 110)}]
        if term.get("program"):
            out[p("ctrlc")] = [{"id": f"ctrlc:{tid}", "text": clean(
                f"Stops {term['program']} in {where} · the shell stays", 80)}]

    def start_model(self, data, values: dict, out: dict) -> None:
        """New agent: a chip per installed agent, one field, one Start row.
        An agent that isn't installed is never listed."""
        p = self.p
        ready = [a for a in data.get("agents") or [] if a["ready"]]
        out[p("kinds")] = [{"id": a["kind"], "label": a["label"]} for a in ready]
        chosen = str(values.get(p("agent")) or "")
        if ready and chosen not in [a["kind"] for a in ready]:
            # Nothing picked yet, or the pick stopped being ready: the first
            # ready agent, set here so the chips show what Start will use.
            chosen = ready[0]["kind"]
            out[p("agent")] = chosen
        agent = next((a for a in ready if a["kind"] == chosen), None)
        folders = data.get("folders") or []
        task = str(values.get(p("task")) or "")
        hit, words = where_to(task, folders, str(values.get(p("want")) or ""))
        if agent and hit:
            out[p("new")] = [{"id": start_id(agent["kind"], hit["label"], task), "accent": True,
                              "text": clean(f"{agent['label']} in {Path(hit['path']).name}", 60)}]

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

    def show_file(self, ctx: Context, data, values: dict) -> Result:
        """Draw one changed file's patch on the open agent's card. A read:
        workspace.fileDiff runs git and changes nothing."""
        path = str(values.get("row") or "")
        with self._lock:
            sid = self.pinned
        row = next((r for r in (data or {}).get("rows") or [] if r["id"] == sid), None)
        listed = {f["path"]: f for f in git_files((data or {}).get("changes"))}
        if row is None or path not in listed or not row.get("cwd_raw"):
            return Result(False, "That file isn't in the open agent's changes any more.", refetch=True)
        # A file that is only staged has no unstaged patch: its staged side is the change.
        staged = bool(listed[path].get("staged")) and not listed[path].get("unstaged")
        try:
            with self.connect(ctx) as conn:
                got = conn.call("workspace.fileDiff", {"cwd": row["cwd_raw"], "path": path, "staged": staged},
                                timeout=CALL_TIMEOUT, allow_exec=True)
        except realm_client.RealmError as err:
            return Result(False, f"Couldn't read that diff: {rpc_words(err)}", refetch=True)
        with self._lock:
            self._patch = (sid, path, patch_text(got))
        return Result(True, f"Showing the diff of {Path(path).name}.", refetch=True)

    def _git_press(self, ctx: Context, data, values: dict, verb: str):
        """(row, connection, files read now) for a Stage, Unstage or Commit
        press on the open agent's folder, or a Result saying why not. The
        files are read again here, never taken from the drawing."""
        with self._lock:
            sid = self.pinned
        row = next((r for r in (data or {}).get("rows") or [] if r["id"] == sid), None)
        if row is None or not row.get("cwd_raw"):
            return Result(False, "No agent's folder is open. Open one, then press.",
                          updates={self.p("level"): "error"})
        try:
            conn = self.connect(ctx)
        except realm_client.RealmError as err:
            return Result(False, f"Nothing was {verb}: {rpc_words(err)}.", updates={self.p("level"): "error"})
        try:
            got = conn.call("workspace.diff", {"cwd": row["cwd_raw"]}, timeout=CALL_TIMEOUT, allow_exec=True)
        except realm_client.RealmError as err:
            conn.close()
            return Result(False, f"Nothing was {verb}: couldn't read its changes ({rpc_words(err)}).",
                          updates={self.p("level"): "error"})
        return row, conn, got if isinstance(got, dict) else {}

    def _paths_for(self, key: str, files: list[dict], side: str) -> list[str] | None:
        """The paths a Stage or Unstage row named, if they are still what it
        showed: one file still on that side, or all of them, unchanged."""
        on_side = [f["path"] for f in files if f.get(side)]
        if key.startswith("file:") and key[5:] in on_side:
            return [key[5:]]
        if key.startswith("all:") and on_side and key[4:] == paths_key(on_side):
            return on_side
        return None

    def stage(self, ctx: Context, data, values: dict) -> Result:
        return self._index(ctx, data, values, "stage")

    def unstage(self, ctx: Context, data, values: dict) -> Result:
        return self._index(ctx, data, values, "unstage")

    def _index(self, ctx: Context, data, values: dict, verb: str) -> Result:
        """git add, or git restore --staged, on exactly the files the row
        named, through realm (workspace.stage, workspace.unstage). Neither
        touches a file's contents."""
        key = str(values.get("row") or "")
        got = self._git_press(ctx, data, values, f"{verb}d")
        if isinstance(got, Result):
            return got
        row, conn, changes = got
        bad = {self.p("level"): "error"}
        with conn:
            paths = self._paths_for(key, git_files(changes), "unstaged" if verb == "stage" else "staged")
            if not paths:
                return Result(False, f"Nothing was {verb}d: the files changed since that was drawn.", updates=bad,
                              refetch=True)
            if not self._claim("index", row["id"]):
                return Result(False, "Still staging the last press.")
            try:
                conn.call(f"workspace.{verb}", {"cwd": row["cwd_raw"], "paths": paths}, timeout=CALL_TIMEOUT,
                          write=True)
            except realm_client.RealmError as err:
                if err.maybe_applied:
                    return Result(False, f"It may have been {verb}d; the engine didn't confirm.",
                                  updates={self.p("level"): "warning"}, refetch=self._stale_changes())
                return Result(False, f"Nothing was {verb}d: {rpc_words(err)}", updates=bad, refetch=True)
            finally:
                self._release("index", row["id"])
        self._stale_changes()
        word = "Staged" if verb == "stage" else "Unstaged"
        return Result(True, f"{word} {plural(len(paths), 'file')} in {row['folder'] or 'its folder'}.",
                      updates={self.p("level"): "success"}, refetch=True)

    def _stale_changes(self) -> bool:
        """Read the open folder's changes on the next fetch, not DIFF_EVERY later."""
        with self._lock:
            self._changes = None
            self._soon = True
        return True

    def ship(self, ctx: Context, data, values: dict) -> Result:
        """Commit what is staged with the typed message, then push, as realm's
        workspace.ship: one press, each step reporting its own outcome. Never
        a force push; realm has none."""
        key = str(values.get("row") or "")
        message = str(values.get(self.p("message")) or "").strip()
        bad = {self.p("level"): "error"}
        if not message or len(message) > MESSAGE_CHARS:
            return Result(False, "Type a commit message first.", updates=bad)
        got = self._git_press(ctx, data, values, "committed")
        if isinstance(got, Result):
            return got
        row, conn, changes = got
        with conn:
            staged = [f["path"] for f in git_files(changes) if f.get("staged")]
            if not staged or ship_id(clean(changes.get("branch"), 60), staged, message) != key:
                return Result(False, "Nothing was committed: what's staged, the branch or the message changed "
                                     "since that was drawn.", updates=bad, refetch=True)
            if not self._claim("ship", row["id"]):
                return Result(False, "Still committing the last press.")
            try:
                if self._fresh(conn, row["id"]).get("status") in BUSY:
                    return Result(False, "Nothing was committed: the agent is still working. Commit once it stops.",
                                  updates=bad, refetch=True)
                result = conn.call("workspace.ship", {
                    "cwd": row["cwd_raw"], "commit": True, "message": message, "push": True, "setUpstream": False,
                    "openPr": False, "environmentId": self._environment_at(conn, row)},
                    timeout=SHIP_TIMEOUT, write=True)
            except realm_client.RealmError as err:
                if err.maybe_applied:
                    return Result(False, "It may have committed or pushed; the engine didn't confirm. Check its "
                                         "changes before pressing again.", updates={self.p("level"): "warning"},
                                  refetch=self._stale_changes())
                return Result(False, f"Nothing was committed: {rpc_words(err)}", updates=bad, refetch=True)
            finally:
                self._release("ship", row["id"])
        return self._shipped_result(row, result)

    def upstream(self, ctx: Context, data, values: dict) -> Result:
        """The first push of a branch, offered only after Commit and push said
        it had never been pushed: realm's ship with commit off and
        setUpstream on, the one case realm's own pane asks yes to."""
        key = str(values.get("row") or "")
        with self._lock:
            sid = self.pinned
            last = self._shipped[1] if self._shipped and self._shipped[0] == sid else None
        push = (last or {}).get("push") if isinstance((last or {}).get("push"), dict) else {}
        if push.get("state") != "no-upstream" or key != f"upstream:{clean(push.get('branch'), 60)}":
            return Result(False, "That push isn't the one offered any more.", updates={self.p("level"): "error"})
        got = self._git_press(ctx, data, values, "pushed")
        if isinstance(got, Result):
            return got
        row, conn, changes = got
        with conn:
            if clean(changes.get("branch"), 60) != clean(push.get("branch"), 60):
                return Result(False, "Nothing was pushed: a different branch is checked out now.",
                              updates={self.p("level"): "error"}, refetch=True)
            if not self._claim("ship", row["id"]):
                return Result(False, "Still pushing the last press.")
            try:
                result = conn.call("workspace.ship", {
                    "cwd": row["cwd_raw"], "commit": False, "message": "", "push": True, "setUpstream": True,
                    "openPr": False, "environmentId": None}, timeout=SHIP_TIMEOUT, write=True)
            except realm_client.RealmError as err:
                if err.maybe_applied:
                    return Result(False, "It may have pushed; the engine didn't confirm.",
                                  updates={self.p("level"): "warning"}, refetch=self._stale_changes())
                return Result(False, f"Nothing was pushed: {rpc_words(err)}", updates={self.p("level"): "error"},
                              refetch=True)
            finally:
                self._release("ship", row["id"])
        return self._shipped_result(row, result)

    @staticmethod
    def _environment_at(conn, row: dict):
        """The session's environment id when that environment is the folder
        being shipped, so realm files the ship under it; else None, since
        realm refuses a mismatch (ENVIRONMENT_MISMATCH)."""
        if not row.get("environment"):
            return None
        try:
            env = conn.call("environments.get", {"id": row["environment"]}, timeout=CALL_TIMEOUT)
        except realm_client.RealmRpcError:
            return None
        return row["environment"] if isinstance(env, dict) and env.get("path") == row["cwd_raw"] else None

    def _shipped_result(self, row: dict, result) -> Result:
        with self._lock:
            self._shipped = (row["id"], result if isinstance(result, dict) else {})
        self._stale_changes()
        commit = (result or {}).get("commit") if isinstance(result, dict) else None
        push = (result or {}).get("push") if isinstance(result, dict) else None
        committed = isinstance(commit, dict) and commit.get("state") == "committed"
        pushed = isinstance(push, dict) and push.get("state") in ("pushed", "up-to-date")
        where = row["folder"] or "its folder"
        updates = {self.p("message"): ""} if committed else {}
        if pushed:
            return Result(True, f"{'Committed and pushed' if committed else 'Pushed'} in {where}.",
                          updates={**updates, self.p("level"): "success"}, refetch=True)
        if committed:
            return Result(True, f"Committed in {where}; the push didn't go. The card says why.",
                          updates={**updates, self.p("level"): "warning"}, refetch=True)
        return Result(False, f"Nothing was committed in {where}. The card says why.",
                      updates={self.p("level"): "warning"}, refetch=True)

    def _term_press(self, ctx: Context, data, values: dict, tid: str, verb: str):
        """(row, connection) for a write to the open agent's terminal, only
        when realm says now that tid is still that session's terminal; else a
        Result saying why not."""
        bad = {self.p("level"): "error"}
        with self._lock:
            sid = self.pinned
        row = next((r for r in (data or {}).get("rows") or [] if r["id"] == sid), None)
        if row is None or not tid:
            return Result(False, f"Nothing was {verb}: no agent is open.", updates=bad)
        try:
            conn = self.connect(ctx)
        except realm_client.RealmError as err:
            return Result(False, f"Nothing was {verb}: {rpc_words(err)}.", updates=bad)
        try:
            fresh = self.row(self._fresh(conn, sid), {}, ctx)
            now = self.terminal_of(conn, fresh)
        except realm_client.RealmError as err:
            conn.close()
            return Result(False, f"Nothing was {verb}: couldn't read its terminal ({rpc_words(err)}).", updates=bad)
        if now != tid:
            conn.close()
            return Result(False, f"Nothing was {verb}: that terminal isn't this agent's any more.", updates=bad,
                          refetch=True)
        return row, conn

    def _write_terminal(self, ctx, data, values, tid: str, payload: str, verb: str, done: str) -> Result:
        got = self._term_press(ctx, data, values, tid, verb)
        if isinstance(got, Result):
            return got
        row, conn = got
        if not self._claim("terminal", tid):
            conn.close()
            return Result(False, "Still typing the last press.")
        try:
            with conn:
                conn.call("terminals.write", {"terminalId": tid, "data": payload}, timeout=CALL_TIMEOUT, write=True)
        except realm_client.RealmError as err:
            if err.maybe_applied:
                return Result(False, "It may have reached the shell; the engine didn't confirm. Read the terminal "
                                     "before pressing again.", updates={self.p("level"): "warning"}, refetch=True)
            return Result(False, f"Nothing was {verb}: {rpc_words(err)}", updates={self.p("level"): "error"},
                          refetch=True)
        finally:
            self._release("terminal", tid)
        with self._lock:
            self._term_watch = self.clock() + TERM_WATCH_S
            self._soon = True
        return Result(True, f"{done} in {row['folder'] or 'its folder'}.", updates={self.p("level"): "success"},
                      refetch=True)

    def run(self, ctx: Context, data, values: dict) -> Result:
        """Type the field's command into the open agent's terminal and press
        Return: terminals.write, only the command the Run row was drawn for."""
        key = str(values.get("row") or "")
        command = str(values.get(self.p("command")) or "")
        bad = {self.p("level"): "error"}
        if not command.strip() or len(command) > COMMAND_CHARS or any(hidden(ch) for ch in command):
            return Result(False, "Type one line of command first; nothing hidden, no line breaks.", updates=bad)
        _, _, rest = key.partition(":")
        tid = rest.rpartition(":")[0]
        if not key.startswith("run:") or command_id(tid, command) != key:
            return Result(False, "Nothing was run: the command changed since that was drawn.", updates=bad)
        result = self._write_terminal(ctx, data, values, tid, command + "\r", "run", "Ran it in the shell")
        if result.ok:
            result.updates[self.p("command")] = ""
        return result

    def ctrl_c(self, ctx: Context, data, values: dict) -> Result:
        """Ctrl-C to what the open agent's terminal is running."""
        key = str(values.get("row") or "")
        if not key.startswith("ctrlc:"):
            return Result(False, "That press named no terminal.", updates={self.p("level"): "error"})
        return self._write_terminal(ctx, data, values, key[6:], "\x03", "sent", "Sent Ctrl-C")

    def term_open(self, ctx: Context, data, values: dict) -> Result:
        """Open the open agent's own terminal: sessions.openTerminal, which
        spawns a shell in its folder the first time and returns the same one
        after. Nothing is typed into it."""
        key = str(values.get("row") or "")
        row, why = self._pinned_row(data, {"row": key.removeprefix("open:")})
        if row is None or not key.startswith("open:"):
            return Result(False, why or "That press named no agent.", updates={self.p("level"): "error"})
        if not self._claim("termopen", row["id"]):
            return Result(False, "Already opening it.")
        try:
            with self.connect(ctx) as conn:
                got = conn.call("sessions.openTerminal", {"id": row["id"]}, timeout=CALL_TIMEOUT, write=True)
        except realm_client.RealmError as err:
            if err.maybe_applied:
                return Result(False, "The terminal may have opened; the engine didn't confirm.",
                              updates={self.p("level"): "warning"}, refetch=True)
            return Result(False, f"No terminal opened: {rpc_words(err)}", updates={self.p("level"): "error"},
                          refetch=True)
        finally:
            self._release("termopen", row["id"])
        tid = got.get("terminalId") if isinstance(got, dict) else None
        item = got.get("itemId") if isinstance(got, dict) else None
        if not all(isinstance(x, str) and x and not any(hidden(ch) for ch in x) for x in (tid, item)):
            return Result(False, "The engine opened something but didn't say which terminal.",
                          updates={self.p("level"): "warning"}, refetch=True)
        with self._lock:
            self._term_ids[row["id"]] = (item, tid)
            self._term_watch = self.clock() + TERM_WATCH_S
            self._soon = True
        return Result(True, f"Opened a shell in {row['folder'] or 'its folder'}.",
                      updates={self.p("level"): "success"}, refetch=True)

    def _set_options(self, ctx: Context, data, sid: str, params: dict, check, said: str) -> Result:
        """sessions.setOptions on the open session, after reading it again and
        `check(fresh session)` still holding; else nothing is set."""
        bad = {self.p("level"): "error"}
        with self._lock:
            pinned = self.pinned
        row = next((r for r in (data or {}).get("rows") or [] if r["id"] == sid), None)
        if not sid or sid != pinned or row is None:
            return Result(False, "That chip is for an agent that isn't the open one.", updates=bad)
        if not self._claim("options", sid):
            return Result(False, "Still setting the last one.")
        try:
            with self.connect(ctx) as conn:
                fresh = self._fresh(conn, sid)
                why = check(fresh)
                if why:
                    return Result(False, why, updates=bad, refetch=True)
                conn.call("sessions.setOptions", {"id": sid, **params}, timeout=CALL_TIMEOUT, write=True)
        except realm_client.RealmError as err:
            if err.maybe_applied:
                return Result(False, "It may have changed; the engine didn't confirm.",
                              updates={self.p("level"): "warning"}, refetch=True)
            return Result(False, f"Not changed: {rpc_words(err)}", updates=bad, refetch=True)
        finally:
            self._release("options", sid)
        return Result(True, f"{said} in {row['folder'] or 'its folder'}.", updates={self.p("level"): "success"},
                      refetch=True)

    def pick_model(self, ctx: Context, data, values: dict) -> Result:
        """A model chip: that model for the open session, from its next turn."""
        sid, _, model = str(values.get("row") or "").partition("|")
        row = next((r for r in (data or {}).get("rows") or [] if r["id"] == sid), None)
        kind = (row or {}).get("kind", "")
        offered = {m["id"]: m for m in self.models_for(kind, data)}
        if model not in offered:
            return Result(False, "That model isn't offered for this agent.", updates={self.p("level"): "error"})

        def check(fresh: dict) -> str:
            return "" if fresh.get("agentKind") == kind else "Not changed: the agent behind it changed."

        return self._set_options(ctx, data, sid, {"model": model}, check,
                                 f"{offered[model]['label']} from the next turn")

    def pick_effort(self, ctx: Context, data, values: dict) -> Result:
        """An effort chip: that reasoning level, or the model's own default."""
        sid, _, effort = str(values.get("row") or "").partition("|")
        row = next((r for r in (data or {}).get("rows") or [] if r["id"] == sid), None)
        if row is None:
            return Result(False, "That chip is for an agent that isn't the open one.",
                          updates={self.p("level"): "error"})
        models = self.models_for(row["kind"], data)
        current = next((m for m in models if m["id"] == row["model"]), None) or next(
            (m for m in models if m["default"]), None)
        if effort and effort not in ((current or {}).get("efforts") or []):
            return Result(False, "That effort isn't offered for this model.", updates={self.p("level"): "error"})

        def check(fresh: dict) -> str:
            same = (fresh.get("model") or "") == (row["model"] or "")
            return "" if same else "Not changed: its model changed since the chips were drawn."

        return self._set_options(ctx, data, sid, {"effort": effort or None}, check,
                                 f"{effort.capitalize() if effort else 'Default'} effort")

    def pick_mode(self, ctx: Context, data, values: dict) -> Result:
        """A permission chip only picks: its Switch row is what applies it."""
        key = str(values.get("row") or "")
        sid, _, mode = key.partition("|")
        with self._lock:
            pinned = self.pinned
        if sid != pinned or mode not in [m for m, _, _ in PERMISSION_CHIPS]:
            return Result(False, "That chip is for an agent that isn't the open one.",
                          updates={self.p("level"): "error"})
        return Result(True, "", updates={self.p("modeValue"): key})

    def set_mode(self, ctx: Context, data, values: dict) -> Result:
        """Switch the open session's permission level, from the row that
        named both levels; refused if it moved since."""
        sid, _, change = str(values.get("row") or "").partition("|")
        was, _, want = change.partition(">")
        modes = [m for m, _, _ in PERMISSION_CHIPS]
        row = next((r for r in (data or {}).get("rows") or [] if r["id"] == sid), None)
        if row is None or want not in modes or was not in modes or row["kind"] not in ASKS_FIRST:
            return Result(False, "That switch isn't on the panel any more.", updates={self.p("level"): "error"})

        def check(fresh: dict) -> str:
            now = fresh.get("permissionMode") if fresh.get("permissionMode") in modes else "default"
            return "" if now == was else "Not switched: its permission level changed since that was drawn."

        label = next(lbl for m, lbl, _ in PERMISSION_CHIPS if m == want)
        return self._set_options(ctx, data, sid, {"permissionMode": want}, check, f"Switched to {label}")

    def go(self, ctx: Context, data, values: dict) -> Result:
        """Point the open agent's browser pane at the typed address
        (browsers.update), or open one in its space at it (browsers.create)."""
        key = str(values.get("row") or "")
        url = web_address(values.get(self.p("address")))
        bad = {self.p("level"): "error"}
        verb, _, rest = key.partition(":")
        target, _, digest = rest.partition("|")
        if not url or verb not in ("go", "new") or digest != hashlib.sha256(url.encode()).hexdigest()[:10]:
            return Result(False, "Nothing was loaded: the address changed since that was drawn, or isn't http(s).",
                          updates=bad)
        with self._lock:
            sid = self.pinned
            pane = self._browser[2] if self._browser and self._browser[0] == sid else None
        row = next((r for r in (data or {}).get("rows") or [] if r["id"] == sid), None)
        if row is None:
            return Result(False, "No agent is open.", updates=bad)
        if (verb == "go" and (not pane or pane["id"] != target)) or (verb == "new" and target != row["space_id"]):
            return Result(False, "Nothing was loaded: that pane isn't this agent's any more.", updates=bad,
                          refetch=True)
        if not self._claim("browser", sid):
            return Result(False, "Still loading the last one.")
        try:
            with self.connect(ctx) as conn:
                if verb == "go":
                    if conn.call("browsers.get", {"browserId": target}, timeout=CALL_TIMEOUT).get("spaceId") \
                            != row["space_id"]:
                        return Result(False, "Nothing was loaded: that pane isn't in this agent's space.",
                                      updates=bad, refetch=True)
                    conn.call("browsers.update", {"browserId": target, "url": url}, timeout=CALL_TIMEOUT, write=True)
                else:
                    conn.call("browsers.create", {"spaceId": target, "url": url}, timeout=CALL_TIMEOUT, write=True)
        except realm_client.RealmError as err:
            if err.maybe_applied:
                return Result(False, "It may have loaded; the engine didn't confirm.",
                              updates={self.p("level"): "warning"}, refetch=True)
            return Result(False, f"Nothing was loaded: {rpc_words(err)}", updates=bad, refetch=True)
        finally:
            self._release("browser", sid)
        with self._lock:
            self._browser = None
            self._soon = True
        return Result(True, f"Loaded it in the browser pane for {row['folder'] or 'its folder'}.",
                      updates={self.p("address"): "", self.p("level"): "success"}, refetch=True)

    def choose(self, ctx: Context, data, values: dict) -> Result:
        """A chip press: which agent Start makes."""
        kind = str(values.get("row") or "")
        ready = [a for a in (data or {}).get("agents") or [] if a["ready"]]
        agent = next((a for a in ready if a["kind"] == kind), None)
        if agent is None:
            return Result(False, "That agent isn't installed any more.", refetch=True)
        return Result(True, "", updates={self.p("agent"): kind})

    def pick(self, ctx: Context, data, values: dict) -> Result:
        """Open a tile into its agent's card, or close the open one. A tab
        that isn't in the engine yet is brought in by this press, then opened."""
        sid = str(values.get("row") or "")
        with self._lock:
            if sid and sid == self.pinned:
                self.pinned, self._log = "", None
                self._gen += 1
                self._soon = True
                return Result(True, "", updates={self.p("draft"): ""}, refetch=True)
        if sid.startswith("tab:"):
            got = self._bring_in(ctx, data, sid[4:])
            if isinstance(got, Result):
                return got
            sid = got
            with self._lock:
                self._repin(sid)
            return Result(True, "", updates={self.p("draft"): ""}, refetch=True)
        row = next((r for r in (data or {}).get("rows") or [] if r["id"] == sid), None)
        if row is None:
            return Result(False, "That agent isn't here any more.")
        with self._lock:
            moved = self.pinned != sid
            self._repin(sid)
        # A draft typed for one session is not carried to the next.
        cleared = {self.p("draft"): ""} if moved else {}
        return Result(True, "", updates=cleared, refetch=True)

    def _bring_in(self, ctx: Context, data, tab_id: str):
        """import.apply for the one tab a press opened; its new session id,
        or a Result saying why not."""
        tab = next((t for t in (data or {}).get("tabs") or [] if t.get("id") == tab_id), None)
        if tab is None or not tab.get("transcript"):
            return Result(False, "That tab isn't open any more.", refetch=True)
        try:
            with self.connect(ctx) as conn:
                profiles = conn.call("profiles.list", timeout=CALL_TIMEOUT)
                profile = next((x["id"] for x in profiles if isinstance(x, dict) and isinstance(x.get("id"), str)),
                               None) if isinstance(profiles, list) else None
                if profile is None:
                    return Result(False, "The engine has no profile to bring it into yet.", refetch=True)
                got = import_call(conn, "import.apply", {"sessions": [{"key": tab["transcript"], "spaceId": None,
                                                                       "profileId": profile}]}, APPLY_TIMEOUT)
        except realm_client.RealmError as err:
            return Result(False, f"Couldn't open it: {rpc_words(err)}", refetch=True)
        with self._lock:
            self._imported.add(tab["transcript"])
        out = next((o for o in (got.get("sessions") if isinstance(got, dict) else None) or []
                    if isinstance(o, dict)), {})
        if out.get("state") == "imported" and isinstance(out.get("refId"), str):
            return out["refId"]
        # Already in: the realm session that carries this tab's id.
        row = next((r for r in (data or {}).get("rows") or [] if r.get("provider_sid") == tab_id), None)
        if row is not None:
            return row["id"]
        return Result(False, "It's still coming into the engine. Tap it again in a moment.", refetch=True)

    def send(self, ctx: Context, data, values: dict) -> Result:
        row, why = self._pinned_row(data, values)
        if row is None:
            return Result(False, why, updates={self.p("level"): "error"})
        typed = str(values.get(self.p("draft")) or "")
        text = typed.strip()
        if not text:
            return Result(False, "Type a message first.", updates={self.p("level"): "error"})
        tab = next((t for t in (data or {}).get("tabs") or [] if row.get("provider_sid")
                    and t.get("id") == row["provider_sid"] and t.get("open_in")), None)
        if tab is not None:
            # Two writers on one conversation: the engine would resume it while
            # the tab it came from is still open and may be mid-turn.
            return Result(False, f"It's open in {clean(tab['open_in'], 20)}. Answer it there, or close that tab "
                                 "and Send here.", updates={self.p("level"): "warning"})
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
        sid, _, drawn = str(values.get("row") or "").partition("@")
        row, why = self._pinned_row(data, {**values, "row": sid})
        if row is None or not drawn:
            why = why or "That Fork row named no checkpoint. Open the agent again, then press."
            return Result(False, why, updates={self.p("level"): "error"})
        if not self._claim("fork", row["id"]):
            return Result(False, "Already forking it.")
        where = row["folder"] or "its folder"
        try:
            try:
                with self.connect(ctx) as conn:
                    if self._fresh(conn, row["id"]).get("status") in BUSY:
                        return Result(False, f"Not forked: the session in {where} is working again.", refetch=True)
                    checkpoint = self.newest_checkpoint(conn, row)
                    if checkpoint is None:
                        return Result(False, "Nothing to fork from yet: a checkpoint is taken before each message.",
                                      refetch=True)
                    if checkpoint != drawn:
                        return Result(False, "Not forked: a newer turn landed since that was drawn. Look again, "
                                             "then press.", refetch=True)
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
        row = str(values.get("row") or "")
        kind, _, rest = row.partition("|")
        label, _, _ = rest.rpartition("|")
        bad = {self.p("level"): "error"}
        agent = next((a for a in (data or {}).get("agents") or [] if a["kind"] == kind and a["ready"]), None)
        if agent is None or kind != str(values.get(self.p("agent")) or ""):
            return Result(False, "That agent isn't the one picked, or isn't installed any more.", updates=bad)
        task = str(values.get(self.p("task")) or "")
        hit, words = where_to(task, (data or {}).get("folders") or [], str(values.get(self.p("want")) or ""))
        if hit is None or hit["label"] != label or start_id(kind, label, task) != row:
            return Result(False, "The message or folder changed since that was drawn. Check it and press again.",
                          updates=bad)
        path = Path(hit["path"])
        try:
            real = path.resolve(strict=True)
        except (OSError, RuntimeError):
            return Result(False, "That folder is gone.", updates=bad)
        if str(real) != hit["path"] or not real.is_dir():
            return Result(False, "That folder moved since the list was read.", updates=bad)
        if not self._claim("new", hit["path"]):
            return Result(False, "Already starting an agent there.")
        try:
            return self._new(ctx, hit, agent, words)
        finally:
            self._release("new", hit["path"])

    def _new(self, ctx: Context, hit: dict, agent: dict, words: str = "") -> Result:
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
                created = conn.call("sessions.create", {"spaceId": space_id, "agentKind": agent["kind"],
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
        done = {self.p("level"): "success", self.p("draft"): "", self.p("task"): ""}
        if not words:
            return Result(True, f"Started {agent['label']} in {name}. Type to it, then Send.", updates=done,
                          refetch=True)
        try:
            with self.connect(ctx) as conn:
                conn.call("sessions.send", {"id": session["id"], "text": words}, timeout=CALL_TIMEOUT, write=True)
        except realm_client.RealmError as err:
            if err.maybe_applied:
                return Result(False, f"Started {agent['label']} in {name}; the message may have gone. Check its "
                                     "conversation before sending again.", updates={self.p("level"): "warning"},
                              refetch=True)
            return Result(False, f"Started {agent['label']} in {name}, but the message didn't go "
                                 f"({rpc_words(err)}). It's still in the box.",
                          updates={self.p("level"): "warning"}, refetch=True)
        with self._lock:
            self._busy = True
        return Result(True, f"Started {agent['label']} in {name} on that.", updates=done, refetch=True)

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
