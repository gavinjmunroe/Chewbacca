"""Typing into a Claude Code session that is open right now, in VS Code or a
terminal, through the inbox Claude Code itself gives every running session.

Every interactive Claude Code process (the VS Code extension's, a terminal's,
an SDK host's) writes a record to `<config>/sessions/<pid>.json` naming its
session id, its status (`idle` or `busy`) and a Unix socket, and a key file
beside it, `<pid>.<sha256 of the socket path>.key`, mode 0600, holding the
token that socket wants. One line `{"type":"auth","token":...}` and then one
`{"type":"user","message":{"role":"user","content":...}}` puts the text on
the session's prompt queue. Claude Code prints this recipe in its own debug
log ("[uds-messaging] Inject messages ..."). Observed in 2.1.278 and 2.1.288,
2026-10-05; `tests/test_kyber_sessions.py` pins the wire shape and the live
check in its docstring proves it against a throwaway session.

What the receiving model sees is honest about where it came from: Claude Code
wraps it as "Another Claude session sent a message", a teammate's request
that cannot grant a permission or answer a pending prompt. That is the right
ceiling for a press on the glass, and nothing here tries to raise it.

Fails closed at every step: the session must be idle, the record's process
must be alive and the same process (start time, not just pid), the socket and
key must be ours and not links, and the connected peer must be that pid. Any
doubt is a refusal with the reason in words, and nothing is written.

The one case it cannot reach is the common one on this Mac: a session that
skips permission prompts (bypassPermissions, the default in
~/.claude/settings.json here) holds a message from a sender that asserts no
permission mode, and the VS Code
extension has no view for a held message (its webview and extension bundle
contain no `peer_message_hold` handling; the host only gets a
`system:peer_message_hold` event). So `hold_reason` predicts the hold from
the session's own permission mode and the `crossSessionInbound` setting, and
the send is refused before anything is written, never parked unseen. The
sender's permission mode is never asserted here: claiming one to get past
that review would be forging the thing the review checks.

That prediction has a blind spot, and the refusal says so. A transcript
records `permissionMode` only on turns, so a mode switched in the client's
own UI after the last turn is not seen here until the next turn. A send that
was predicted to land and is then held anyway shows up in the transcript as
a held note, and `follow` reports it as held, not as delivered.

Before this, the glass could reach only a session that had finished, by
`claude -p --resume`, which for a session still open in VS Code meant two
processes appending to one transcript.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import socket
import stat
import subprocess
import time
import unicodedata
from pathlib import Path
from typing import Callable

# Claude Code drops a line over 1 MiB (`fUt=1048576` in its bundle). A typed
# message from the glass is a sentence or a paragraph; this cap is guessed,
# never measured, and only exists so a pasted log cannot hit that limit.
MAX_CHARS = 16_000
# The client in Claude Code's own bundle gives a send 5 s to connect and
# write. Same here.
CONNECT_TIMEOUT_S = 5.0
# Claude Code's own client waits 150 ms on macOS before ending the write
# side (`Ve=150` beside "Timed out sending to"), so the server has read the
# lines before it sees the close. Copied, not measured here.
CLOSE_DELAY_S = 0.15
# How long a delivered message may take to appear in the transcript before
# the send is reported as unconfirmed. On 2026-10-05 the throwaway session
# wrote it in under a second; 20 s is guessed headroom for a slow disk.
CONFIRM_S = 20.0
# How long a reply is followed before giving up on watching it (the session
# keeps going; the card keeps refreshing). Same 900 s as the glass's test
# runs in kyber-sessions. Guessed, never measured.
REPLY_S = 900.0
# macOS getsockopt constants from <sys/un.h>: SOL_LOCAL and LOCAL_PEERPID.
SOL_LOCAL = 0
LOCAL_PEERPID = 0x002
# The wrapper Claude Code puts around a peer message in the transcript, read
# back from the throwaway session on 2026-10-05.
PEER_HEAD = "Another Claude session sent a message:\n"
PEER_TAIL = "\n\nThis came from another Claude session"
# What a session writes instead when it holds a peer message for review. A
# session that skips permission prompts (Caleb's VS Code sessions run with
# bypassPermissions) holds any message whose sender did not attest a
# permission mode, unless its settings say `"crossSessionInbound": "accept"`.
# Seen in a throwaway terminal session on 2026-10-05, Claude Code 2.1.288.
HELD_HEAD = "Held peer message"

TOKEN = re.compile(r"[0-9a-f]{32,256}")
# Unicode categories dropped by `clean`, tab and newline excepted: every
# category C (controls, format characters such as the bidi overrides
# U+202A-202E and U+2066-2069, zero-width U+200B-200D and the BOM U+FEFF,
# surrogates, private use, unassigned) and the line and paragraph separators.
# Text typed on the glass and text read from a transcript both pass through
# it. A review on 2026-10-05 found the bidi and zero-width ones passing the
# old C0/C1-only filter, which let transcript text reorder what the glass shows.
DROPPED_CATEGORIES = ("C", "Zl", "Zp")
KEPT_CONTROLS = frozenset("\t\n")


# The one permission mode in which Claude Code holds an unattested peer
# message for certain: seen held in bypassPermissions on 2026-10-05. A review
# of 2.1.289 the same day found dontAsk counted as prompting (it was listed
# here before and refused sends that would have landed), and plan holding
# only when bypass is available to that session.
NO_PROMPT_MODES = frozenset({"bypassPermissions"})
# Holds only when bypass is available to that session, which is set at its
# launch and is not written anywhere this can read. Refused, closed.
MAYBE_NO_PROMPT_MODES = frozenset({"plan"})
MANAGED_SETTINGS = Path("/Library/Application Support/ClaudeCode/managed-settings.json")


class Refused(Exception):
    """A send that did not happen, with the reason in words for the card."""


def clean(text: str) -> str:
    """Control, format and separator characters out, length capped. Newlines
    and tabs stay: a message can be a paragraph, and the inbox reads it as
    one JSON string."""
    kept = "".join(ch for ch in str(text or "") if ch in KEPT_CONTROLS
                   or not unicodedata.category(ch).startswith(DROPPED_CATEGORIES))
    return kept.strip()[:MAX_CHARS]


# ── The registry ─────────────────────────────────────────────────────────────

def _proc_starts(pids: list[int]) -> dict[int, str]:
    """pid -> `ps -o lstart` for the ones alive, in one `ps` call. In UTC:
    Claude Code writes `procStart` in UTC, and read in local time every live
    session on 2026-10-05 looked like a recycled pid (17:19 against 10:19)."""
    if not pids:
        return {}
    try:
        out = subprocess.run(["ps", "-o", "pid=,lstart=", "-p", ",".join(str(p) for p in pids)],
                             capture_output=True, text=True, timeout=5,
                             env={**os.environ, "LC_ALL": "C", "TZ": "UTC0"}).stdout
    except (OSError, subprocess.SubprocessError):
        return {}
    found = {}
    for line in out.splitlines():
        parts = line.split(None, 1)
        if len(parts) == 2 and parts[0].isdigit():
            found[int(parts[0])] = " ".join(parts[1].split())
    return found


def live_records(config_dirs: list[Path], starts: Callable[[list[int]], dict[int, str]] = _proc_starts) -> dict[str, dict]:
    """sessionId -> its registry record, for processes alive right now and
    still the process that wrote the record. A recycled pid is not the
    session: the start time must match whenever the record carries one."""
    raw: list[dict] = []
    for config in config_dirs:
        folder = config / "sessions"
        try:
            names = [n for n in os.listdir(folder) if re.fullmatch(r"\d+\.json", n)]
        except OSError:
            continue
        for name in names:
            try:
                rec = json.loads((folder / name).read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if not isinstance(rec, dict) or str(rec.get("pid")) != name[:-5]:
                continue  # a record that names another pid than its file is not trusted
            rec["_dir"] = str(folder)
            raw.append(rec)
    alive = starts([int(r["pid"]) for r in raw])
    out: dict[str, dict] = {}
    for rec in raw:
        pid = int(rec["pid"])
        if pid not in alive:
            continue
        want = " ".join(str(rec.get("procStart") or "").split())
        if want and want != alive[pid]:
            continue
        sid = str(rec.get("sessionId") or "")
        if sid and (sid not in out or float(rec.get("updatedAt") or 0) > float(out[sid].get("updatedAt") or 0)):
            out[sid] = rec
    return out


def client_name(rec: dict) -> str:
    point = str(rec.get("entrypoint") or "")
    return {"claude-vscode": "VS Code", "cli": "a terminal", "claude-desktop": "the desktop app",
            "sdk-cli": "a script", "sdk-py": "a script"}.get(point, "another window")


def key_path(rec: dict) -> Path:
    sock = str(rec.get("messagingSocketPath") or "")
    digest = hashlib.sha256(sock.encode()).hexdigest()
    return Path(rec["_dir"]) / f"{int(rec['pid'])}.{digest}.key"


def why_not(rec: dict) -> str | None:
    """Why this open session cannot take a message now, or None."""
    where = client_name(rec)
    if rec.get("status") != "idle":
        return f"It is mid-turn in {where}. Wait for it to finish."
    sock = str(rec.get("messagingSocketPath") or "")
    if not sock:
        return f"It is open in {where}, but its inbox is off on this Claude Code version."
    if not os.path.isabs(sock):
        return "Its inbox address is not a local path."
    try:
        st = os.lstat(sock)
    except OSError:
        return f"Its inbox is gone. Is it still open in {where}?"
    if not stat.S_ISSOCK(st.st_mode) or st.st_uid != os.getuid():
        return "Its inbox is not a socket this user owns."
    try:
        kst = os.lstat(key_path(rec))
    except OSError:
        return "Its inbox key is missing."
    if not stat.S_ISREG(kst.st_mode) or kst.st_uid != os.getuid() or kst.st_mode & 0o077 \
            or kst.st_size > 4096:
        return "Its inbox key is not a private file this user owns."
    return None


def token_of(rec: dict) -> str:
    try:
        body = json.loads(key_path(rec).read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        raise Refused("Its inbox key could not be read.") from err
    token = body.get("peerToken") if isinstance(body, dict) else None
    if not isinstance(token, str) or not TOKEN.fullmatch(token):
        raise Refused("Its inbox key is not in the shape Claude Code writes.")
    return token


def _setting(path: Path) -> str | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8")).get("crossSessionInbound")
    except (OSError, ValueError, AttributeError):
        return None
    return value if isinstance(value, str) else None


def inbound_policy(cwd: str, config: Path, managed: Path | None = None) -> str | None:
    """The `crossSessionInbound` a session in `cwd` runs with: "accept",
    "hold", "refuse", or None when nothing sets it. Managed policy and a
    repo can only tighten (Claude Code's own schema text), so the strictest
    explicit value wins. An unrecognized value holds, as Claude Code does."""
    found = [v for v in (_setting(managed or MANAGED_SETTINGS), _setting(config / "settings.json"),
                         _setting(config / "settings.local.json"),
                         _setting(Path(cwd) / ".claude" / "settings.json") if cwd else None,
                         _setting(Path(cwd) / ".claude" / "settings.local.json") if cwd else None) if v]
    if not found:
        return None
    if "refuse" in found:
        return "refuse"
    if any(v != "accept" for v in found):
        return "hold"
    return "accept"


# Said with every mode-based refusal, because the mode is read from the
# transcript and only a turn writes it there.
STALE_MODE = ("Its mode is read from its last turn; a mode changed in {where} since then is not seen "
              "here until it takes another turn.")


def hold_reason(mode: str, policy: str | None, where: str) -> str | None:
    """Why Claude Code would hold or refuse a message from here instead of
    delivering it, or None when it delivers. `mode` is the session's newest
    `permissionMode` from its own transcript, so a mode switched in the
    client after its last turn is not seen; `follow` catches that hold."""
    if policy == "accept":
        return None
    if policy == "refuse":
        return "Its settings refuse messages from other sessions (crossSessionInbound: refuse)."
    if policy == "hold":
        return f"Its settings hold messages from other sessions for review in {where} (crossSessionInbound: hold)."
    if mode in NO_PROMPT_MODES:
        return (f"It runs with permission prompts off in {where}, so Claude Code would hold this for review "
                f"there, and {where} has no view for a held message. Fork it to keep going here. "
                + STALE_MODE.format(where=where))
    if mode in MAYBE_NO_PROMPT_MODES:
        return (f"It is in {mode} mode in {where}, where Claude Code holds a message from outside if that "
                "session can switch prompts off, and that is not readable from here. Fork it to keep going "
                "here. " + STALE_MODE.format(where=where))
    if not mode:
        # Unknown is treated as off: a message held where nothing shows it is
        # worse than a refusal that says to fork.
        return (f"Its permission mode could not be read, and if prompts are off in {where} Claude Code would "
                "hold this where nothing shows it. Fork it to keep going here.")
    return None


MODE_RE = re.compile(rb'"permissionMode"\s*:\s*"([A-Za-z]+)"')
# Backward read size for `last_mode`. On 2026-10-05 two live VS Code
# sessions had no permissionMode in their last 768 KB (a long agentic turn
# writes only tool results, which carry none); reading back in 1 MB steps
# found it. The step is guessed.
MODE_STEP = 1_000_000


def last_mode(path: Path, step: int = MODE_STEP) -> str:
    """The newest `permissionMode` anywhere in a transcript, read from the
    end backwards, or "" when it never says."""
    try:
        with path.open("rb") as f:
            end = f.seek(0, 2)
            while end > 0:
                start = max(0, end - step)
                f.seek(start)
                # Overlap by 100 bytes so a field split across steps is seen.
                chunk = f.read(end - start + 100)
                found = MODE_RE.findall(chunk)
                if found:
                    return found[-1].decode()
                end = start
    except OSError:
        return ""
    return ""


# ── Delivering ───────────────────────────────────────────────────────────────

def frames(token: str, session_id: str, text: str) -> bytes:
    """The two lines the inbox reads. `session_id` makes Claude Code drop the
    message if the socket now belongs to a different session."""
    auth = {"type": "auth", "token": token}
    msg = {"type": "user", "message": {"role": "user", "content": text},
           "session_id": session_id, "priority": "next"}
    return (json.dumps(auth) + "\n" + json.dumps(msg) + "\n").encode()


def peer_pid(sock: socket.socket) -> int | None:
    try:
        return int(sock.getsockopt(SOL_LOCAL, LOCAL_PEERPID))
    except OSError:
        return None


def deliver(rec: dict, text: str, pid_of: Callable[[socket.socket], int | None] = peer_pid) -> None:
    """Put `text` on the open session's prompt queue, or raise Refused."""
    why = why_not(rec)
    if why:
        raise Refused(why)
    body = clean(text)
    if not body:
        raise Refused("Nothing to send.")
    payload = frames(token_of(rec), str(rec.get("sessionId") or ""), body)
    conn = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    conn.settimeout(CONNECT_TIMEOUT_S)
    try:
        try:
            conn.connect(str(rec["messagingSocketPath"]))
        except OSError as err:
            raise Refused(f"Its inbox did not answer ({err.strerror or err}).") from err
        got = pid_of(conn)
        if got != int(rec["pid"]):
            # Whatever is listening there is not the session the record names.
            raise Refused("The inbox is held by a different process. Nothing was sent.")
        conn.sendall(payload)
        time.sleep(CLOSE_DELAY_S)
    finally:
        conn.close()


# ── Reading the result back from the transcript ──────────────────────────────

def peer_body(entry: dict) -> str | None:
    """The text of a peer message in a transcript entry, unwrapped, or None
    when the entry is not one."""
    origin = entry.get("origin") if isinstance(entry.get("origin"), dict) else {}
    if entry.get("type") != "user" or origin.get("kind") != "peer":
        return None
    content = (entry.get("message") or {}).get("content")
    if not isinstance(content, str):
        return None
    if content.startswith(PEER_HEAD):
        content = content[len(PEER_HEAD):]
        cut = content.find(PEER_TAIL)
        if cut != -1:
            content = content[:cut]
    return content


def _new_entries(path: Path, offset: int) -> tuple[list[dict], int]:
    try:
        with path.open("rb") as f:
            f.seek(offset)
            chunk = f.read()
    except OSError:
        return [], offset
    end = chunk.rfind(b"\n")
    if end == -1:
        return [], offset
    out = []
    for line in chunk[:end].decode("utf-8", errors="replace").splitlines():
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if isinstance(entry, dict):
            out.append(entry)
    return out, offset + end + 1


def size_of(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def held_note(entry: dict, body: str) -> bool:
    """Whether a transcript entry is Claude Code holding this message for
    review. The note quotes a preview of the body, so the first words must
    match: a held message from someone else is not ours."""
    if entry.get("type") != "system" or entry.get("subtype") != "informational":
        return False
    content = str(entry.get("content") or "")
    return content.startswith(HELD_HEAD) and body[:40] in content


def follow(path: Path, offset: int, text: str, status: Callable[[], str | None],
           on_text: Callable[[str], None], confirm_s: float = CONFIRM_S, reply_s: float = REPLY_S,
           poll_s: float = 0.4, clock: Callable[[], float] = time.monotonic,
           sleep: Callable[[float], None] = time.sleep) -> dict:
    """Watch the transcript from `offset`: first for the message itself (the
    proof it arrived), then for the reply, until the session is idle again.

    Returns the same shape as a `claude -p` result event, plus `delivered`.
    `status()` is the registry's live status for the session, None once its
    process is gone.
    """
    body = clean(text)
    start = clock()
    arrived = False
    reply = ""
    replied = False
    while True:
        entries, offset = _new_entries(path, offset)
        for e in entries:
            if not arrived:
                if peer_body(e) == body:
                    arrived = True
                elif held_note(e, body):
                    return {"is_error": True, "delivered": False, "held": True,
                            "result": "Held for review in its window, not delivered: Claude Code holds a "
                                      "message from outside a session that skips permission prompts until "
                                      "someone approves it there (or its settings say crossSessionInbound: "
                                      "accept). Its mode may have changed after its last turn, which is "
                                      "where the mode is read from."}
                continue
            if e.get("type") == "assistant" and not e.get("isSidechain"):
                for b in (e.get("message") or {}).get("content") or []:
                    if isinstance(b, dict) and b.get("type") == "text" and str(b.get("text") or "").strip():
                        reply = clean(b["text"])
                        replied = True
                        on_text(reply)
        now = clock() - start
        if not arrived and now > confirm_s:
            return {"is_error": True, "delivered": False,
                    "result": "Sent to its inbox, but it never showed up in the transcript."}
        live = status()
        if arrived and live is None:
            return {"is_error": True, "delivered": True, "result": reply or "The session closed."}
        if arrived and replied and live == "idle":
            return {"is_error": False, "delivered": True, "result": reply}
        if arrived and now > reply_s:
            return {"is_error": False, "delivered": True,
                    "result": reply or "Delivered. It is still working; the card keeps following it."}
        sleep(poll_s)
