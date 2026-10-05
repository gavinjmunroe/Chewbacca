"""A stdlib-only client for the realm engine's local WebSocket RPC.

realm (github.com/31Carlton7/realm, Carlton Aikins) runs a Node server that
speaks JSON over a WebSocket bound to 127.0.0.1:

    request    {"id", "method", "params"}
    response   {"id", "ok": true, "result"} | {"id", "ok": false, "error": {code, message}}
    broadcast  {"event", "payload"}

`bin/realm-engine start` writes {pid, port, started} to
${CHEWBACCA_REALM_HOME:-~/.chewbacca/realm}/engine.json. This module reads
that file, connects only to 127.0.0.1 on that port, and implements the
RFC 6455 client side by hand (handshake, masked frames, ping/pong, close)
so Kyber needs no pip install on a fresh Mac.

    import realm_client
    info = realm_client.call("system.info")
    with realm_client.connect() as conn:
        conn.subscribe(session_id)
        conn.call("sessions.send", {...}, write=True)   # only from a press
        for ev in conn.poll(timeout=5): ...

The engine's socket has no auth, so anything on this Mac can drive it. This
client does not make that safer; it only refuses to be the thing that drives
it by accident. Every method is one of three kinds:

    READ_METHODS   read realm's own state; always allowed
    EXEC_METHODS   read, but run a process on this Mac (a CLI probe, or git
                   in a caller-chosen cwd, where repo config such as
                   core.fsmonitor can execute code); need allow_exec=True
    anything else  creates, writes, sends, approves, stages or ships; needs
                   write=True, which the surface passes only from a human press

connect() proves who it is talking to before the first call: engine.json's
pid must be a realm server whose REALM_HOME is this home, and system.info on
the port must report the same realmHome. A recycled pid or a stranger on the
old port is refused rather than handed session text.

Everything a result or event carries (session text, file contents, diffs) is
untrusted. This module returns it as parsed JSON and never acts on it; the
surface strips it before it reaches the glass.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import socket
import stat
import struct
import subprocess
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Any, Iterable

HOST = "127.0.0.1"
_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"  # RFC 6455 section 1.3

# The largest single message accepted. Guessed, never measured: sessions.events
# defaults to 2000 events per page and a long tool result can be hundreds of
# KB, so 32 MiB leaves room while refusing a runaway stream.
MAX_MESSAGE = 32 * 1024 * 1024
# Broadcasts kept while waiting on a response or between polls. Guessed, never
# measured: a streaming Claude turn emits a few events per second, and a poll
# loop that falls a few minutes behind should drop the oldest, not grow.
MAX_BUFFERED_EVENTS = 5000

# Methods that only read realm's own state. Taken from
# packages/contracts/src/rpc.ts at realm 0ae5b8b (2026-10-05).
READ_METHODS = frozenset({
    "system.info", "profiles.list", "spaces.list",
    "projects.list", "items.list", "environments.list", "environments.get",
    "checkpoints.list", "documents.get", "documents.list", "documents.read",
    "settings.get", "skills.list", "mcp.list", "memory.get",
    "ships.list", "schedules.list", "runs.list", "runs.get",
    "notifications.list", "review.get",
    "sessions.list", "sessions.get", "sessions.events", "failover.get",
})
# Reads that run a process. agents.probe and cli.status take force:true and
# spawn every agent CLI; the workspace three run git in whatever cwd the
# caller names (rpc.ts lines 768-775). A verifier flagged all five on
# 2026-10-05: not state writes, but not free of side effects either.
EXEC_METHODS = frozenset({
    "agents.probe", "cli.status",
    "workspace.gitInfo", "workspace.diff", "workspace.fileDiff",
})


class RealmError(Exception):
    """Base for everything this module raises.

    maybe_applied is True when a write request had already been handed to the
    socket before the failure: the engine may have run it. A surface must
    never retry such a call automatically, whatever the subclass. On
    2026-10-05 a verifier SIGKILLed the server mid-write and got a plain
    RealmUnavailable with no flag, which reads as "nothing happened".
    """

    maybe_applied = False


class RealmUnavailable(RealmError):
    """No engine.json, a dead engine, a refused connection, or a dropped socket."""


class RealmTimeout(RealmError):
    """The engine did not answer within the timeout (see RealmError.maybe_applied)."""


class RealmProtocolError(RealmError):
    """The peer broke RFC 6455 or the realm wire format."""


class RealmRpcError(RealmError):
    """The engine answered ok:false."""

    def __init__(self, method: str, code: str, message: str):
        super().__init__(f"{method}: {code}: {message}")
        self.method, self.code, self.message = method, code, message


class RealmWriteRefused(RealmError):
    """A write method was called without write=True."""


class RealmExecRefused(RealmWriteRefused):
    """A method in EXEC_METHODS was called without allow_exec=True."""


def realm_home() -> Path:
    return Path(os.environ.get("CHEWBACCA_REALM_HOME")
                or Path.home() / ".chewbacca" / "realm").expanduser()


def engine_file(home: Path | None = None) -> Path:
    return (home or realm_home()) / "engine.json"


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _same_home(value: str, home: Path) -> bool:
    """value names the same directory as home, however it is spelled.

    realpath folds a trailing slash, `..` and symlinks. Comparing spellings
    alone let a hand-started `REALM_HOME=<home>/` server hide from strays(),
    so `start` would launch a second server on the same realm.db.
    """
    return os.path.realpath(value) == os.path.realpath(home)


def is_realm_server(pid: int, home: Path | None = None) -> bool:
    """pid is alive, runs a realm dist/main.js, and has REALM_HOME=home in its env.

    A command-line match alone is not identity: on 2026-10-05 a verifier
    pointed engine.json at an unrelated `node dist/main.js` and the old check
    let `realm-engine stop` kill it. REALM_HOME is what ties a server to one
    realm.db, so it is the part that has to match.
    """
    if not pid_alive(pid):
        return False
    try:
        out = subprocess.run(["ps", "eww", "-o", "command=", "-p", str(pid)],
                             capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.TimeoutExpired):
        return False
    if "dist/main.js" not in out:
        return False
    home = home or realm_home()
    # `ps eww` joins the environment with spaces, so a value cannot be split
    # out of it. A home with a space in its path (2026-10-05, verifier: "space
    # home/realm") never matched `\S+`, the engine stopped recognising its own
    # server, and a second `start` put two servers on one realm.db. Look for
    # each spelling of the home we know instead, ending at a space or the end.
    spellings = {str(home), str(home).rstrip("/") + "/", os.path.realpath(home),
                 os.path.realpath(home).rstrip("/") + "/"}
    return any(re.search(r"(?:^|\s)REALM_HOME=" + re.escape(sp) + r"(?=\s|$)", out) for sp in spellings) \
        or any(_same_home(v, home) for v in re.findall(r"(?:^|\s)REALM_HOME=(\S+)", out))


def read_engine(home: Path | None = None) -> dict[str, Any]:
    """engine.json, validated. Raises RealmUnavailable when absent, unsafe or not ours.

    The file decides which port gets our requests, so a copy another user
    could rewrite is refused: it must be ours and not group/other accessible.
    """
    home = home or realm_home()
    path = engine_file(home)
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        raise RealmUnavailable(f"engine not started ({path} missing); run realm-engine start") from None
    if not stat.S_ISREG(st.st_mode) or st.st_uid != os.getuid() or st.st_mode & 0o077:
        raise RealmUnavailable(f"{path} must be a regular file owned by you with mode 0600")
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError) as e:
        raise RealmUnavailable(f"{path} unreadable: {e}") from None
    if not isinstance(data, dict):
        raise RealmUnavailable(f"{path} is not a JSON object")
    pid, port = data.get("pid"), data.get("port")
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        raise RealmUnavailable(f"{path} has no valid pid")
    if not isinstance(port, int) or isinstance(port, bool) or not 0 < port < 65536:
        raise RealmUnavailable(f"{path} has no valid port")
    if not pid_alive(pid):
        raise RealmUnavailable(f"engine pid {pid} is not running; run realm-engine start")
    if not is_realm_server(pid, home):
        raise RealmUnavailable(f"pid {pid} in {path} is not a realm server on {home}; "
                               "run realm-engine start")
    return data


_PROVEN = object()


class Connection:
    """One WebSocket to the engine. Not thread-safe; one reader at a time.

    Get one from connect(), never by constructing it: connect() is what proves
    the port serves this realm home. A Connection built straight from a cached
    port would, after an engine restart, talk to whatever owns that port now.
    """

    def __init__(self, port: int, timeout: float = 5.0, *, _token: object = None):
        if _token is not _PROVEN:
            raise RealmError("Connection is not public; use realm_client.connect(), "
                             "which proves the port belongs to this realm home")
        if not isinstance(port, int) or not 0 < port < 65536:
            raise RealmUnavailable(f"bad port {port!r}")
        self.port = port
        self.events: deque[dict[str, Any]] = deque(maxlen=MAX_BUFFERED_EVENTS)
        self._buf = bytearray()
        # A fragmented message in progress. Kept on the connection, not in
        # recv_message's locals, so a timeout between fragments loses nothing.
        self._frag: list[bytes] = []
        self._frag_size = 0
        self._frag_op: int | None = None
        self._sessions: set[str] | None = None
        self._event_names: set[str] | None = None
        self._closed = False
        try:
            self._sock = socket.create_connection((HOST, port), timeout=timeout)
        except OSError as e:
            raise RealmUnavailable(f"cannot reach engine on {HOST}:{port}: {e}") from None
        try:
            self._handshake(timeout)
        except BaseException:
            self._sock.close()
            raise

    # context manager
    def __enter__(self) -> "Connection":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # handshake
    def _handshake(self, timeout: float) -> None:
        key = base64.b64encode(os.urandom(16)).decode()
        req = (f"GET / HTTP/1.1\r\nHost: {HOST}:{self.port}\r\n"
               "Upgrade: websocket\r\nConnection: Upgrade\r\n"
               f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
        self._sock.sendall(req.encode())
        deadline = time.monotonic() + timeout
        while b"\r\n\r\n" not in self._buf:
            if len(self._buf) > 16384:
                raise RealmProtocolError("handshake response too large")
            self._fill(deadline)
        head, _, rest = bytes(self._buf).partition(b"\r\n\r\n")
        self._buf = bytearray(rest)
        lines = head.decode("latin-1").split("\r\n")
        parts = lines[0].split(" ", 2)
        if len(parts) < 2 or parts[1] != "101":
            raise RealmProtocolError(f"handshake refused: {lines[0]!r}")
        headers = {}
        for line in lines[1:]:
            name, sep, value = line.partition(":")
            if sep:
                headers[name.strip().lower()] = value.strip()
        want = base64.b64encode(hashlib.sha1((key + _GUID).encode()).digest()).decode()
        if headers.get("sec-websocket-accept") != want:
            raise RealmProtocolError("handshake accept key mismatch")
        if headers.get("upgrade", "").lower() != "websocket":
            raise RealmProtocolError("handshake missing Upgrade: websocket")
        if headers.get("sec-websocket-extensions"):
            raise RealmProtocolError("server negotiated an extension we did not offer")

    # bytes
    def _fill(self, deadline: float | None) -> None:
        if deadline is None:
            self._sock.settimeout(None)
        else:
            left = deadline - time.monotonic()
            if left <= 0:
                raise RealmTimeout("timed out waiting for the engine")
            self._sock.settimeout(left)
        try:
            chunk = self._sock.recv(65536)
        except socket.timeout:
            raise RealmTimeout("timed out waiting for the engine") from None
        except OSError as e:
            self._closed = True
            raise RealmUnavailable(f"engine connection lost: {e}") from None
        if not chunk:
            self._closed = True
            raise RealmUnavailable("engine closed the connection")
        self._buf += chunk

    # frames
    def _send_frame(self, opcode: int, payload: bytes) -> None:
        if self._closed:
            raise RealmUnavailable("connection is closed")
        n = len(payload)
        head = bytearray([0x80 | opcode])
        if n < 126:
            head.append(0x80 | n)
        elif n < 65536:
            head.append(0x80 | 126)
            head += struct.pack("!H", n)
        else:
            head.append(0x80 | 127)
            head += struct.pack("!Q", n)
        mask = os.urandom(4)
        head += mask
        try:
            self._sock.sendall(bytes(head) + _xor(payload, mask))
        except OSError as e:
            self._closed = True
            raise RealmUnavailable(f"engine connection lost: {e}") from None

    def _send_text(self, text: str) -> None:
        self._send_frame(0x1, text.encode("utf-8"))

    def _parse_frame(self) -> tuple[bool, int, bytes] | None:
        """One whole frame off the front of the buffer, or None if it has not all arrived.

        Nothing is consumed until the frame is complete. A 200 KB event that
        straddled a poll deadline used to lose its already-read header, and
        the next poll parsed payload bytes as a frame header ("reserved bits
        set"); found by a verifier on 2026-10-05.
        """
        buf = self._buf
        if len(buf) < 2:
            return None
        b0, b1 = buf[0], buf[1]
        fin, opcode = bool(b0 & 0x80), b0 & 0x0F
        if b0 & 0x70:
            raise RealmProtocolError("reserved bits set without an extension")
        if b1 & 0x80:
            raise RealmProtocolError("server frames must not be masked")
        n, at = b1 & 0x7F, 2
        if n == 126:
            if len(buf) < 4:
                return None
            n, at = struct.unpack("!H", buf[2:4])[0], 4
        elif n == 127:
            if len(buf) < 10:
                return None
            n, at = struct.unpack("!Q", buf[2:10])[0], 10
        if opcode >= 0x8:
            if n > 125 or not fin:
                raise RealmProtocolError("bad control frame")
        elif self._frag_size + n > MAX_MESSAGE:
            raise RealmProtocolError(f"message over {MAX_MESSAGE} bytes")
        if len(buf) < at + n:
            return None
        payload = bytes(buf[at:at + n])
        del buf[:at + n]
        return fin, opcode, payload

    def recv_message(self, deadline: float | None) -> str:
        """The next complete text message. Answers pings; raises on close.

        A RealmTimeout leaves the connection usable: a partial frame stays in
        the buffer and a partial message stays in _frag. A protocol error
        closes the connection, since the stream can no longer be framed.
        """
        try:
            return self._recv_message(deadline)
        except RealmProtocolError:
            self._closed = True
            try:
                self._sock.close()
            except OSError:
                pass
            raise

    def _recv_message(self, deadline: float | None) -> str:
        while True:
            frame = self._parse_frame()
            if frame is None:
                self._fill(deadline)
                continue
            fin, opcode, payload = frame
            if opcode == 0x9:
                self._send_frame(0xA, payload)
                continue
            if opcode == 0xA:
                continue
            if opcode == 0x8:
                self._closing(payload)
            if opcode >= 0x8:
                raise RealmProtocolError(f"unknown control opcode {opcode}")
            if opcode == 0x0:
                if self._frag_op is None:
                    raise RealmProtocolError("continuation without a first frame")
            elif opcode in (0x1, 0x2):
                if self._frag_op is not None:
                    raise RealmProtocolError("new message inside a fragmented one")
                self._frag_op = opcode
            else:
                raise RealmProtocolError(f"unknown opcode {opcode}")
            self._frag.append(payload)
            self._frag_size += len(payload)
            if fin:
                data = b"".join(self._frag)
                self._frag, self._frag_size, self._frag_op = [], 0, None
                try:
                    return data.decode("utf-8")
                except UnicodeDecodeError:
                    raise RealmProtocolError("message is not UTF-8") from None

    def _closing(self, payload: bytes) -> None:
        try:
            self._send_frame(0x8, payload[:2])
        except RealmError:
            pass
        self._closed = True
        self._sock.close()
        code = struct.unpack("!H", payload[:2])[0] if len(payload) >= 2 else None
        raise RealmUnavailable(f"engine closed the connection (code {code})")

    def close(self) -> None:
        if self._closed:
            return
        try:
            self._send_frame(0x8, struct.pack("!H", 1000))
        except RealmError:
            pass
        self._closed = True
        try:
            self._sock.close()
        except OSError:
            pass

    # rpc
    def _route(self, raw: str) -> dict[str, Any] | None:
        """Parse one message; buffer it if it is a broadcast; return it if a response."""
        try:
            msg = json.loads(raw)
        except ValueError:
            raise RealmProtocolError("engine sent a message that is not JSON") from None
        if not isinstance(msg, dict):
            raise RealmProtocolError("engine sent a non-object message")
        if "event" in msg and isinstance(msg.get("event"), str):
            if self._wants(msg):
                self.events.append(msg)
            return None
        if isinstance(msg.get("id"), str) and isinstance(msg.get("ok"), bool):
            return msg
        raise RealmProtocolError("engine sent an unrecognized message")

    def _wants(self, msg: dict[str, Any]) -> bool:
        if self._sessions is None and self._event_names is None:
            return False
        if self._event_names is not None and msg["event"] in self._event_names:
            return True
        if self._sessions is not None:
            payload = msg.get("payload")
            sid = payload.get("sessionId") if isinstance(payload, dict) else None
            return sid in self._sessions
        return False

    def call(self, method: str, params: dict[str, Any] | None = None,
             timeout: float = 10.0, write: bool = False, allow_exec: bool = False) -> Any:
        """One request. A RealmTimeout on a write may still have run: see maybe_applied."""
        if not isinstance(method, str) or not method:
            raise RealmError("method must be a non-empty string")
        is_write = method not in READ_METHODS and method not in EXEC_METHODS
        if is_write and not write:
            raise RealmWriteRefused(
                f"{method} changes state; pass write=True, and only from a human press")
        if method in EXEC_METHODS and not allow_exec:
            raise RealmExecRefused(
                f"{method} runs a process on this Mac; pass allow_exec=True, and only "
                "with params the surface chose (never text from a session or file)")
        if self._closed:
            # Nothing has left this process yet, so this one is safe to retry.
            raise RealmUnavailable("connection is closed")
        rid = uuid.uuid4().hex
        text = json.dumps({"id": rid, "method": method,
                           "params": {} if params is None else params})
        deadline = time.monotonic() + timeout
        try:
            # From the first byte handed to sendall on, a write may have
            # reached the engine: a partial send, a reset, a close frame, a
            # crash after applying or a restart on a new port all land here.
            self._send_text(text)
            while True:
                msg = self._route(self.recv_message(deadline))
                if msg is None or msg["id"] != rid:
                    continue
                if msg["ok"]:
                    return msg.get("result")
                err = msg.get("error") if isinstance(msg.get("error"), dict) else {}
                raise RealmRpcError(method, str(err.get("code", "UNKNOWN")),
                                    str(err.get("message", "")))
        except RealmRpcError:
            raise  # the engine answered, so the outcome is known
        except RealmError as e:
            if is_write:
                e.maybe_applied = True
                what = "not answered in time" if isinstance(e, RealmTimeout) else str(e)
                e.args = (f"{method} was sent but {what}; it may have run, so do not "
                          "retry it automatically",)
            raise

    def subscribe(self, session_id: str | None = None,
                  events: Iterable[str] | None = None) -> None:
        """Start keeping broadcasts for a session (payload.sessionId) or by event name.

        Until something is subscribed, broadcasts are read and dropped, so a
        connection that only calls never grows.
        """
        if session_id is not None:
            self._sessions = (self._sessions or set()) | {session_id}
        if events is not None:
            self._event_names = (self._event_names or set()) | set(events)

    def poll(self, timeout: float = 1.0, max_events: int = 1000) -> list[dict[str, Any]]:
        """Broadcasts kept so far, waiting up to timeout for at least one."""
        deadline = time.monotonic() + timeout
        while not self.events:
            try:
                self._route(self.recv_message(deadline))
            except RealmTimeout:
                break
        out = []
        while self.events and len(out) < max_events:
            out.append(self.events.popleft())
        return out


def _xor(payload: bytes, mask: bytes) -> bytes:
    n = len(payload)
    key = int.from_bytes((mask * (n // 4 + 1))[:n], "big")
    return (int.from_bytes(payload, "big") ^ key).to_bytes(n, "big")


def descends_from(pid: int | None, ancestor: int) -> bool:
    """pid is ancestor or one of its children's children. The engine's own
    process listens today; a wrapper that forks the listener still counts,
    anything outside its tree does not. Bounded walk up the ppid chain."""
    for _ in range(16):
        if pid is None or pid <= 1:
            return False
        if pid == ancestor:
            return True
        try:
            out = subprocess.run(["ps", "-o", "ppid=", "-p", str(pid)], capture_output=True,
                                 text=True, timeout=5).stdout.strip()
            pid = int(out) if out else None
        except (OSError, subprocess.TimeoutExpired, ValueError):
            return False
    return False


def port_owner(port: int) -> int | None:
    """The pid listening on 127.0.0.1:port, or None. One lsof read; a port with
    several listeners or none is None, which connect() treats as not ours."""
    try:
        out = subprocess.run(["lsof", "-nP", f"-iTCP@127.0.0.1:{int(port)}", "-sTCP:LISTEN", "-Fp"],
                             capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return None
    pids = {int(line[1:]) for line in out.splitlines() if line.startswith("p") and line[1:].isdigit()}
    return pids.pop() if len(pids) == 1 else None


def connect(timeout: float = 5.0, home: Path | None = None) -> Connection:
    """A connection to the engine in engine.json, proven to serve this home.

    read_engine's pid check does not cover the port: after a crash the old
    port can be bound by anything. So system.info must report this realmHome
    before the caller gets the connection.
    """
    home = home or realm_home()
    eng = read_engine(home)
    # system.info is the server's own claim, and any local process can answer
    # it with our realmHome (security review, 2026-10-05). The socket on that
    # port has to belong to the pid engine.json names, checked before we
    # connect, so a squatter on a dead engine's port is refused unheard.
    owner = port_owner(eng["port"])
    if not descends_from(owner, eng["pid"]):
        raise RealmUnavailable(f"port {eng['port']} is held by pid {owner}, not the engine "
                               f"(pid {eng['pid']}); run realm-engine start")
    conn = Connection(eng["port"], timeout=timeout, _token=_PROVEN)
    try:
        info = conn.call("system.info", timeout=timeout)
        served = info.get("realmHome") if isinstance(info, dict) else None
        if not isinstance(served, str) or not _same_home(served, home):
            raise RealmUnavailable(f"port {conn.port} answers for realm home {served!r}, "
                                   f"not {home}; run realm-engine start")
    except RealmRpcError as e:
        conn.close()
        raise RealmUnavailable(f"port {conn.port} is not a realm engine: {e}") from None
    except BaseException:
        conn.close()
        raise
    return conn


def call(method: str, params: dict[str, Any] | None = None, timeout: float = 10.0,
         write: bool = False, home: Path | None = None, allow_exec: bool = False) -> Any:
    """One request on a fresh connection."""
    with connect(timeout=min(timeout, 5.0), home=home) as conn:
        return conn.call(method, params, timeout=timeout, write=write, allow_exec=allow_exec)


def session_events(session_id: str, seconds: float, home: Path | None = None) -> list[dict[str, Any]]:
    """Every broadcast for one session over the next `seconds`."""
    out: list[dict[str, Any]] = []
    deadline = time.monotonic() + seconds
    with connect(home=home) as conn:
        conn.subscribe(session_id)
        while (left := deadline - time.monotonic()) > 0:
            out += conn.poll(timeout=left)
    return out
