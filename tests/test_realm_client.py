#!/usr/bin/env python3
"""realm_client and realm-engine against an in-process fake WebSocket server.

No network beyond 127.0.0.1, no Node, no realm checkout: the fake speaks the
server half of RFC 6455 and realm's {id, ok, result} wire format, and a fake
`node` stands in for the server so start/stop/status run end to end.
Run: python3 tests/test_realm_client.py
"""
import base64
import fcntl
import hashlib
import json
import re
import os
import plistlib
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bin" / "lib"))
import realm_client as rc  # noqa: E402

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


def raises(fn, exc):
    try:
        fn()
    except exc as e:
        return e
    except Exception as e:  # noqa: BLE001 (the test reports the wrong type)
        return ("wrong", type(e).__name__, str(e))
    return None


# fake server

class Peer:
    """The server side of one accepted connection."""

    def __init__(self, sock):
        self.sock = sock
        self.buf = b""
        self.client_frames_masked = True

    def take(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise EOFError
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def handshake(self, accept_override=None):
        while b"\r\n\r\n" not in self.buf:
            self.buf += self.sock.recv(4096)
        head, _, self.buf = self.buf.partition(b"\r\n\r\n")
        headers = {}
        for line in head.decode().split("\r\n")[1:]:
            k, _, v = line.partition(":")
            headers[k.strip().lower()] = v.strip()
        self.request_headers = headers
        accept = accept_override or base64.b64encode(
            hashlib.sha1((headers["sec-websocket-key"] + GUID).encode()).digest()).decode()
        self.sock.sendall(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n"
                           f"Connection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n").encode())

    def read_frame(self):
        b0, b1 = self.take(2)
        n = b1 & 0x7F
        if n == 126:
            n = struct.unpack("!H", self.take(2))[0]
        elif n == 127:
            n = struct.unpack("!Q", self.take(8))[0]
        masked = bool(b1 & 0x80)
        self.client_frames_masked &= masked
        mask = self.take(4) if masked else b"\0\0\0\0"
        data = bytes(b ^ mask[i % 4] for i, b in enumerate(self.take(n)))
        return b0 & 0x0F, data

    def read_request(self):
        while True:
            op, data = self.read_frame()
            if op == 0x1:
                return json.loads(data)
            if op == 0x8:
                raise EOFError

    def frame(self, opcode, payload, fin=True, masked=False):
        head = bytes([(0x80 if fin else 0) | opcode])
        n = len(payload)
        mbit = 0x80 if masked else 0
        if n < 126:
            head += bytes([mbit | n])
        elif n < 65536:
            head += bytes([mbit | 126]) + struct.pack("!H", n)
        else:
            head += bytes([mbit | 127]) + struct.pack("!Q", n)
        if masked:
            head += b"\0\0\0\0"
        self.sock.sendall(head + payload)

    def send(self, obj):
        self.frame(0x1, json.dumps(obj).encode())

    def reply(self, req, result=None, error=None):
        if error:
            self.send({"id": req["id"], "ok": False, "error": error})
        else:
            self.send({"id": req["id"], "ok": True, "result": result})


class Fake:
    """Accepts connections on 127.0.0.1 and hands each to `script(peer)`."""

    def __init__(self, script):
        self.script = script
        self.srv = socket.socket()
        self.srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.srv.bind(("127.0.0.1", 0))
        self.srv.listen(8)
        self.port = self.srv.getsockname()[1]
        self.peers = []
        self.errors = []
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        while True:
            try:
                sock, _ = self.srv.accept()
            except OSError:
                return
            peer = Peer(sock)
            self.peers.append(peer)
            threading.Thread(target=self._run, args=(peer,), daemon=True).start()

    def _run(self, peer):
        try:
            self.script(peer)
        except EOFError:
            pass
        except Exception as e:  # noqa: BLE001 (surfaced by the test that owns it)
            self.errors.append(repr(e))
        finally:
            try:
                peer.sock.close()
            except OSError:
                pass

    def close(self):
        self.srv.close()


def echo_server(peer):
    """Answers every request with its own method and params."""
    peer.handshake()
    while True:
        req = peer.read_request()
        peer.reply(req, {"method": req["method"], "params": req["params"]})


def realm_server(home):
    """echo_server, except system.info reports realmHome=home the way realm does."""
    def script(peer):
        peer.handshake()
        while True:
            req = peer.read_request()
            if req["method"] == "system.info":
                peer.reply(req, {"realmHome": str(home), "version": "test",
                                 "machineName": "m", "userName": "u"})
            else:
                peer.reply(req, {"method": req["method"], "params": req["params"]})
    return script


def answer_info_then(home, then):
    """Answer the connect-time system.info for `home`, then run `then(peer)`."""
    def script(peer):
        peer.handshake()
        req = peer.read_request()
        peer.reply(req, {"realmHome": str(home), "version": "test"})
        then(peer)
    return script


def fake_engine_proc(home, argv_tail="/opt/realm/apps/server/dist/main.js"):
    """A process that looks like a realm server on `home` to ps: dist/main.js
    in its argv, REALM_HOME in its environment. None for home means no REALM_HOME."""
    env = {k: v for k, v in os.environ.items() if k != "REALM_HOME"}
    if home is not None:
        env["REALM_HOME"] = str(home)
    return subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)", argv_tail], env=env)


def unproven(port, timeout=5.0):
    """A Connection without connect()'s identity proof, for the protocol tests only."""
    return rc.Connection(port, timeout, _token=rc._PROVEN)


# tests

def test_basic_call():
    fake = Fake(echo_server)
    with unproven(fake.port) as conn:
        got = conn.call("system.info")
        check("call returns the result", got == {"method": "system.info", "params": {}}, got)
        got = conn.call("agents.probe", {"force": False}, allow_exec=True)
        check("params pass through", got["params"] == {"force": False}, got)
        big = "x" * 70000
        got = conn.call("documents.read", {"documentsId": "d", "path": big})
        check("64-bit length frames both ways", got["params"]["path"] == big, len(str(got)))
        mid = "y" * 300
        got = conn.call("documents.read", {"documentsId": "d", "path": mid})
        check("16-bit length frames", got["params"]["path"] == mid)
    time.sleep(0.05)
    peer = fake.peers[0]
    check("every client frame is masked", peer.client_frames_masked)
    check("handshake sends version 13", peer.request_headers.get("sec-websocket-version") == "13")
    check("Host is loopback", peer.request_headers.get("host", "").startswith("127.0.0.1:"))
    fake.close()


def test_errors():
    def script(peer):
        peer.handshake()
        req = peer.read_request()
        peer.reply(req, error={"code": "NOT_FOUND", "message": "no such session"})
        peer.read_request()
        peer.read_request()
        time.sleep(1.5)  # never answer the second or third: the client times out

    fake = Fake(script)
    with unproven(fake.port) as conn:
        e = raises(lambda: conn.call("sessions.get", {"id": "s1"}), rc.RealmRpcError)
        check("ok:false raises RealmRpcError", isinstance(e, rc.RealmRpcError) and e.code == "NOT_FOUND", e)
        t0 = time.monotonic()
        e = raises(lambda: conn.call("sessions.get", {"id": "s2"}, timeout=0.3), rc.RealmTimeout)
        check("no answer raises RealmTimeout", isinstance(e, rc.RealmTimeout), e)
        check("timeout is honored", time.monotonic() - t0 < 2.0)
        check("a timed-out read is not flagged as maybe applied", not e.maybe_applied, e)
        e = raises(lambda: conn.call("sessions.send", {"id": "s", "text": "hi"},
                                     timeout=0.3, write=True), rc.RealmTimeout)
        check("a timed-out write says it may have run",
              isinstance(e, rc.RealmTimeout) and e.maybe_applied and "may have run" in str(e), e)
    fake.close()


def test_write_failures_after_send():
    """Any failure after a write leaves the socket may have run it (verifier, 2026-10-05:
    SIGKILL mid-write gave a plain RealmUnavailable that a surface would retry)."""
    def drop(peer):
        peer.handshake()
        peer.read_request()
        peer.sock.shutdown(socket.SHUT_RDWR)
        peer.sock.close()

    def close_frame(peer):
        peer.handshake()
        peer.read_request()
        peer.frame(0x8, struct.pack("!H", 1011))
        time.sleep(0.5)

    for label, script in (("a dropped socket", drop), ("a close frame", close_frame)):
        fake = Fake(script)
        with unproven(fake.port) as conn:
            e = raises(lambda: conn.call("settings.set", {"k": "v"}, timeout=2, write=True),
                       rc.RealmUnavailable)
            check(f"{label} after a write raises RealmUnavailable with maybe_applied",
                  isinstance(e, rc.RealmUnavailable) and e.maybe_applied and "may have run" in str(e), e)
            e = raises(lambda: conn.call("settings.set", {"k": "v"}, write=True), rc.RealmUnavailable)
            check(f"a write on the connection {label} closed never sent, so is not maybe_applied",
                  isinstance(e, rc.RealmUnavailable) and not e.maybe_applied, e)
        fake.close()
        fake = Fake(script)
        with unproven(fake.port) as conn:
            e = raises(lambda: conn.call("settings.get", timeout=2), rc.RealmUnavailable)
            check(f"{label} after a read is not maybe_applied",
                  isinstance(e, rc.RealmUnavailable) and not e.maybe_applied, e)
        fake.close()

    def refuse(peer):
        peer.handshake()
        req = peer.read_request()
        peer.reply(req, error={"code": "INVALID_PARAMS", "message": "no"})
        time.sleep(0.5)

    fake = Fake(refuse)
    with unproven(fake.port) as conn:
        e = raises(lambda: conn.call("settings.set", {}, timeout=2, write=True), rc.RealmRpcError)
        check("an ok:false answer to a write is a known outcome, not maybe_applied",
              isinstance(e, rc.RealmRpcError) and not e.maybe_applied, e)
    fake.close()


def test_connection_is_not_public():
    fake = Fake(echo_server)
    e = raises(lambda: rc.Connection(fake.port), rc.RealmError)
    check("Connection(port) without connect()'s proof is refused",
          isinstance(e, rc.RealmError) and "connect()" in str(e), e)
    time.sleep(0.1)
    check("the refused constructor never opened a socket", not fake.peers, len(fake.peers))
    fake.close()


def test_write_gate():
    fake = Fake(echo_server)
    with unproven(fake.port) as conn:
        e = raises(lambda: conn.call("sessions.send", {"id": "s", "text": "hi"}), rc.RealmWriteRefused)
        check("write method refused without write=True", isinstance(e, rc.RealmWriteRefused), e)
        for m in ("workspace.ship", "sessions.respondPermission", "documents.write", "workspace.stage"):
            e = raises(lambda m=m: conn.call(m, {}), rc.RealmWriteRefused)
            check(f"{m} refused without write=True", isinstance(e, rc.RealmWriteRefused), e)
        got = conn.call("sessions.send", {"id": "s"}, write=True)
        check("write=True sends", got["method"] == "sessions.send", got)
        for m in sorted(rc.EXEC_METHODS):
            e = raises(lambda m=m: conn.call(m, {"cwd": "/tmp", "force": True}), rc.RealmExecRefused)
            check(f"{m} refused without allow_exec", isinstance(e, rc.RealmExecRefused), e)
            e = raises(lambda m=m: conn.call(m, {"cwd": "/tmp"}, write=True), rc.RealmExecRefused)
            check(f"{m} refused with write=True but no allow_exec", isinstance(e, rc.RealmExecRefused), e)
        got = conn.call("workspace.diff", {"cwd": "/tmp"}, allow_exec=True)
        check("allow_exec=True sends an exec read", got["method"] == "workspace.diff", got)
        check("exec methods are not in READ_METHODS", not (rc.EXEC_METHODS & rc.READ_METHODS))
        check("no public unguarded send on Connection", not hasattr(conn, "send_text"))
    time.sleep(0.05)
    check("refused calls never reached the socket", not fake.errors, fake.errors)
    fake.close()


def test_events_and_ping():
    pong = {}

    def script(peer):
        peer.handshake()
        req = peer.read_request()
        peer.send({"event": "session.event", "payload": {"sessionId": "A", "seq": 1}})
        peer.send({"event": "session.event", "payload": {"sessionId": "B", "seq": 1}})
        peer.send({"event": "items.changed", "payload": {"spaceId": "sp"}})
        peer.send({"id": "someone-else", "ok": True, "result": "not yours"})
        peer.frame(0x9, b"ping!")
        op, data = peer.read_frame()
        pong["op"], pong["data"] = op, data
        # a fragmented response: text frame then a continuation
        body = json.dumps({"id": req["id"], "ok": True, "result": {"n": 1}}).encode()
        peer.frame(0x1, body[:10], fin=False)
        peer.frame(0x9, b"mid")
        peer.read_frame()
        peer.frame(0x0, body[10:])
        peer.send({"event": "session.status", "payload": {"sessionId": "A", "status": "idle"}})
        peer.send({"event": "session.status", "payload": {"sessionId": "B", "status": "idle"}})
        peer.read_request()

    fake = Fake(script)
    with unproven(fake.port) as conn:
        conn.subscribe("A")
        got = conn.call("sessions.list", {"spaceId": "sp"})
        check("fragmented response with a ping inside reassembles", got == {"n": 1}, got)
        check("ping answered with a pong carrying its payload",
              pong.get("op") == 0xA and pong.get("data") == b"ping!", pong)
        evs = conn.poll(timeout=1.0)
        evs += conn.poll(timeout=0.3)
        seen = [(e["event"], e["payload"].get("sessionId")) for e in evs]
        check("poll keeps only the subscribed session",
              seen == [("session.event", "A"), ("session.status", "A")], seen)
        check("poll with nothing pending returns empty", conn.poll(timeout=0.1) == [])
    fake.close()

    def script2(peer):
        peer.handshake()
        req = peer.read_request()
        for i in range(50):
            peer.send({"event": "session.event", "payload": {"sessionId": "A", "seq": i}})
        peer.reply(req, "ok")
        peer.read_request()

    fake = Fake(script2)
    with unproven(fake.port) as conn:
        conn.call("system.info")
        check("unsubscribed connection buffers nothing", len(conn.events) == 0, len(conn.events))
    fake.close()

    def script3(peer):
        peer.handshake()
        req = peer.read_request()
        peer.send({"event": "notifications.changed", "payload": {}})
        peer.send({"event": "items.changed", "payload": {}})
        peer.reply(req, "ok")
        peer.read_request()

    fake = Fake(script3)
    with unproven(fake.port) as conn:
        conn.subscribe(events=["items.changed"])
        conn.call("system.info")
        evs = conn.poll(timeout=1.0)
        check("subscribe by event name", [e["event"] for e in evs] == ["items.changed"], evs)
    fake.close()


def test_frame_across_poll_deadline():
    """A big event whose bytes straddle a poll deadline arrives whole on the next poll.

    Verifier repro, 2026-10-05: a 200 KB session.event split across the
    deadline made the next poll raise "reserved bits set" and killed the
    connection, because the frame header already read was thrown away.
    """
    body = json.dumps({"event": "session.event",
                       "payload": {"sessionId": "A", "text": "z" * 200000}}).encode()
    frame = b"\x81\x7f" + struct.pack("!Q", len(body)) + body

    def script(peer):
        peer.handshake()
        peer.sock.sendall(frame[:6])            # half the 64-bit length
        time.sleep(0.4)
        peer.sock.sendall(frame[6:100000])      # the rest of the header, part of the payload
        time.sleep(0.4)
        peer.sock.sendall(frame[100000:])
        # a fragmented message whose second half arrives after a deadline
        msg = json.dumps({"event": "session.event", "payload": {"sessionId": "A", "seq": 2}}).encode()
        time.sleep(0.2)
        peer.frame(0x1, msg[:12], fin=False)
        time.sleep(0.4)
        peer.frame(0x0, msg[12:])
        req = peer.read_request()
        peer.reply(req, "still framed")
        peer.read_request()

    fake = Fake(script)

    def polled(conn, timeout):
        try:
            return conn.poll(timeout=timeout)
        except rc.RealmError as e:  # the old reader died here: "reserved bits set"
            return [("raised", repr(e))]

    with unproven(fake.port) as conn:
        conn.subscribe("A")
        first = polled(conn, 0.2) + polled(conn, 0.4)
        check("poll that times out mid-frame returns nothing yet", first == [], first)
        evs = polled(conn, 2.0)
        check("the straddling 200 KB event arrives whole",
              len(evs) == 1 and isinstance(evs[0], dict) and len(evs[0]["payload"]["text"]) == 200000,
              [e if isinstance(e, tuple) else len(json.dumps(e)) for e in evs])
        mid = polled(conn, 0.3)
        check("poll that times out between fragments returns nothing yet", mid == [], mid)
        evs = polled(conn, 2.0)
        check("the fragmented event arrives whole after the deadline",
              [e["payload"].get("seq") if isinstance(e, dict) else e for e in evs] == [2], evs)
        try:
            got = conn.call("system.info", timeout=2)
        except rc.RealmError as e:
            got = repr(e)
        check("the connection is still framed afterwards", got == "still framed", got)
    check("fake saw no errors", not fake.errors, fake.errors)
    fake.close()


def test_protocol_failures():
    def bad_accept(peer):
        peer.handshake(accept_override="bm90IHRoZSByaWdodCBrZXk=")
        time.sleep(0.5)

    fake = Fake(bad_accept)
    e = raises(lambda: unproven(fake.port), rc.RealmProtocolError)
    check("wrong Sec-WebSocket-Accept refused", isinstance(e, rc.RealmProtocolError), e)
    fake.close()

    def masked(peer):
        peer.handshake()
        peer.read_request()
        peer.frame(0x1, b'{"id":"x","ok":true,"result":1}', masked=True)
        time.sleep(0.5)

    fake = Fake(masked)
    with unproven(fake.port) as conn:
        e = raises(lambda: conn.call("system.info", timeout=2), rc.RealmProtocolError)
        check("masked server frame refused", isinstance(e, rc.RealmProtocolError), e)
        e = raises(lambda: conn.call("system.info", timeout=2), rc.RealmUnavailable)
        check("a protocol error closes the connection", isinstance(e, rc.RealmUnavailable), e)
    fake.close()

    def hangup(peer):
        peer.handshake()
        peer.read_request()
        peer.sock.shutdown(socket.SHUT_RDWR)

    fake = Fake(hangup)
    with unproven(fake.port) as conn:
        e = raises(lambda: conn.call("system.info", timeout=2), rc.RealmUnavailable)
        check("server dropping mid-call raises RealmUnavailable", isinstance(e, rc.RealmUnavailable), e)
    fake.close()

    def close_frame(peer):
        peer.handshake()
        peer.read_request()
        peer.frame(0x8, struct.pack("!H", 1001))
        try:
            op, _ = peer.read_frame()
            peer.close_echo = op
        except EOFError:
            peer.close_echo = None

    fake = Fake(close_frame)
    with unproven(fake.port) as conn:
        e = raises(lambda: conn.call("system.info", timeout=2), rc.RealmUnavailable)
        check("close frame raises RealmUnavailable with its code",
              isinstance(e, rc.RealmUnavailable) and "1001" in str(e), e)
    time.sleep(0.1)
    check("close frame is echoed", getattr(fake.peers[0], "close_echo", None) == 0x8)
    fake.close()

    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    e = raises(lambda: unproven(port), rc.RealmUnavailable)
    check("nothing listening raises RealmUnavailable", isinstance(e, rc.RealmUnavailable), e)


def test_engine_file():
    with tempfile.TemporaryDirectory() as d:
        home = Path(d)
        e = raises(lambda: rc.read_engine(home), rc.RealmUnavailable)
        check("missing engine.json is unavailable", isinstance(e, rc.RealmUnavailable) and "start" in str(e), e)
        path = rc.engine_file(home)

        def put(obj, mode=0o600):
            path.write_text(json.dumps(obj))
            os.chmod(path, mode)

        proc = fake_engine_proc(home)
        other = fake_engine_proc(home / "elsewhere")
        bare = fake_engine_proc(None, "dist/main.js")
        procs = [proc, other, bare]
        time.sleep(0.2)
        put({"pid": proc.pid, "port": 1234}, 0o644)
        e = raises(lambda: rc.read_engine(home), rc.RealmUnavailable)
        check("engine.json readable by others is refused", isinstance(e, rc.RealmUnavailable), e)
        put({"pid": proc.pid, "port": 70000})
        e = raises(lambda: rc.read_engine(home), rc.RealmUnavailable)
        check("out-of-range port refused", isinstance(e, rc.RealmUnavailable), e)
        put({"pid": "1", "port": 1234})
        e = raises(lambda: rc.read_engine(home), rc.RealmUnavailable)
        check("string pid refused", isinstance(e, rc.RealmUnavailable), e)
        dead = subprocess.Popen([sys.executable, "-c", "pass"])
        dead.wait()
        put({"pid": dead.pid, "port": 1234})
        e = raises(lambda: rc.read_engine(home), rc.RealmUnavailable)
        check("dead pid is unavailable", isinstance(e, rc.RealmUnavailable) and "not running" in str(e), e)
        path.unlink()
        os.symlink(home / "elsewhere.json", path)
        e = raises(lambda: rc.read_engine(home), rc.RealmUnavailable)
        check("symlinked engine.json refused", isinstance(e, rc.RealmUnavailable), e)
        path.unlink()

        fake = Fake(realm_server(home))
        for name, pid in (("a live pid that is not a realm server", os.getpid()),
                          ("a realm server on another REALM_HOME", other.pid),
                          ("a `node dist/main.js` with no REALM_HOME", bare.pid)):
            put({"pid": pid, "port": fake.port})
            e = raises(lambda: rc.call("profiles.list", home=home), rc.RealmUnavailable)
            check(f"engine.json naming {name} is refused",
                  isinstance(e, rc.RealmUnavailable) and "not a realm server" in str(e), e)
        check("is_realm_server accepts the right process", rc.is_realm_server(proc.pid, home))
        link = Path(d + "-link")
        os.symlink(home, link)
        slash = fake_engine_proc(str(home) + "/")
        via_link = fake_engine_proc(link)
        procs += [slash, via_link]
        time.sleep(0.2)
        check("is_realm_server sees REALM_HOME spelled with a trailing slash",
              rc.is_realm_server(slash.pid, home))
        check("is_realm_server sees REALM_HOME spelled through a symlink",
              rc.is_realm_server(via_link.pid, home))
        check("a REALM_HOME that only shares a prefix is still another home",
              not rc.is_realm_server(other.pid, home))
        link.unlink()
        # A home with a space in its path: `ps eww` joins env values with
        # spaces, and the old `\S+` parse never matched one (verifier, 2026-10-05).
        spaced = home / "space home" / "realm"
        spaced.mkdir(parents=True)
        sp = fake_engine_proc(spaced)
        near = fake_engine_proc(home / "space home")
        procs += [sp, near]
        time.sleep(0.2)
        check("is_realm_server sees a home with a space in its path", rc.is_realm_server(sp.pid, spaced))
        check("a home that is only the space path's parent is another home",
              not rc.is_realm_server(near.pid, spaced))

        # These two exercise the system.info half of connect(), so the port
        # ownership half (test_security_review_fixes) is taken as passed here.
        real_owner = rc.port_owner
        rc.port_owner = lambda _port: proc.pid
        wrong = Fake(realm_server(home / "someone-else"))
        put({"pid": proc.pid, "port": wrong.port})
        e = raises(lambda: rc.call("sessions.get", {"id": "s"}, home=home), rc.RealmUnavailable)
        check("a port that answers for another realm home is refused before the call",
              isinstance(e, rc.RealmUnavailable) and "answers for realm home" in str(e), e)
        wrong.close()

        def not_realm(peer):
            peer.handshake()
            req = peer.read_request()
            peer.reply(req, error={"code": "METHOD_NOT_FOUND", "message": "?"})
            peer.read_request()

        stranger = Fake(not_realm)
        put({"pid": proc.pid, "port": stranger.port})
        e = raises(lambda: rc.call("sessions.get", {"id": "s"}, home=home), rc.RealmUnavailable)
        check("a port whose system.info fails is refused",
              isinstance(e, rc.RealmUnavailable) and "not a realm engine" in str(e), e)
        stranger.close()

        put({"pid": proc.pid, "port": fake.port, "started": "now"})
        got = rc.call("profiles.list", home=home)
        check("module call() reads engine.json and connects", got["method"] == "profiles.list", got)
        os.environ["CHEWBACCA_REALM_HOME"] = str(home)
        try:
            got = rc.call("spaces.list")
            check("CHEWBACCA_REALM_HOME picks the home", got["method"] == "spaces.list", got)
        finally:
            del os.environ["CHEWBACCA_REALM_HOME"]
        fake.close()

        def streamer(peer):
            for i in range(3):
                peer.send({"event": "session.event", "payload": {"sessionId": "S", "seq": i}})
                time.sleep(0.05)
            peer.send({"event": "session.event", "payload": {"sessionId": "T", "seq": 9}})
            time.sleep(1)

        fake = Fake(answer_info_then(home, streamer))
        put({"pid": proc.pid, "port": fake.port})
        evs = rc.session_events("S", 0.6, home=home)
        check("session_events collects one session for a window",
              [e["payload"]["seq"] for e in evs] == [0, 1, 2], evs)
        fake.close()
        for pr in procs:
            pr.kill()
            pr.wait()
    rc.port_owner = real_owner

def test_read_methods_are_reads():
    verbs = {"send", "write", "create", "delete", "ship", "stage", "unstage", "respondPermission",
             "update", "set", "fork", "interrupt", "openPath", "run", "start", "kill", "rename"}
    writes = [m for m in rc.READ_METHODS if m.split(".", 1)[1] in verbs]
    check("READ_METHODS holds no write-shaped name", not writes, writes)


def test_security_review_fixes():
    """Three findings from the 2026-10-05 security review."""
    # 1. A squatter on the engine's port: system.info is a claim anyone can
    #    make, so connect() must refuse when the port's listener is not the pid.
    with tempfile.TemporaryDirectory() as d:
        home = Path(d)
        squatter = Fake(realm_server(home))
        proc = fake_engine_proc(home)
        try:
            time.sleep(0.2)
            path = rc.engine_file(home)
            path.write_text(json.dumps({"pid": proc.pid, "port": squatter.port}))
            os.chmod(path, 0o600)
            e = raises(lambda: rc.connect(home=home), rc.RealmUnavailable)
            check("connect refuses a port whose listener is not the engine pid",
                  isinstance(e, rc.RealmUnavailable) and "held by pid" in str(e), e)
        finally:
            proc.kill()
    check("port_owner names this process for a port it listens on",
          rc.port_owner(Fake(realm_server(Path("/tmp"))).port) == os.getpid())
    # 2 and 3. The engine builds only a pinned commit and starts behind the
    #    Origin guard.
    src = (ROOT / "bin" / "realm-engine").read_text()
    pin = re.search(r'"CHEWBACCA_REALM_REF", "([0-9a-f]+)"', src)
    check("the engine pins a full upstream commit", bool(pin) and len(pin.group(1)) == 40, pin)
    check("the build refuses a checkout that is not at the pin", "refusing to run its build" in src)
    check("the server starts with the origin guard loaded", '"--import", ORIGIN_GUARD.as_uri()' in src)
    guard = (ROOT / "data" / "realm" / "origin-guard.mjs").read_text()
    check("the guard refuses any upgrade that carries an Origin",
          "req.headers.origin !== undefined" in guard and "403" in guard)


def test_engine_cli():
    """realm-engine start/status/stop with a fake `node` that prints a ready line."""
    engine = str(ROOT / "bin" / "realm-engine")
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        realm_dir, home = d / "realm", d / "home"
        fake = Fake(realm_server(home))
        main_js = realm_dir / "apps" / "server" / "dist" / "main.js"
        node = d / "node"
        node.write_text(
            f"#!{sys.executable}\n"
            "import json, os, signal, sys, time\n"
            "signal.signal(signal.SIGTERM, lambda *a: sys.exit(0))\n"
            "assert os.environ['REALM_HOME'] and os.environ['REALM_PORT'] == '0'\n"
            "time.sleep(float(os.environ.get('FAKE_NODE_DELAY', '0')))\n"
            f"print(json.dumps({{'type': 'ready', 'port': {fake.port}, 'home': os.environ['REALM_HOME']}}), flush=True)\n"
            "time.sleep(60)\n")
        node.chmod(0o755)
        env = dict(os.environ, CHEWBACCA_REALM_DIR=str(realm_dir), CHEWBACCA_REALM_HOME=str(home),
                   CHEWBACCA_NODE=str(node), PYTHONDONTWRITEBYTECODE="1")

        def cli(*args, extra=None):
            r = subprocess.run([sys.executable, engine, *args], env=dict(env, **(extra or {})),
                               capture_output=True, text=True, timeout=30)
            return r.returncode, r.stdout, r.stderr

        code, out, err = cli("start")
        check("start without a build fails and says build", code == 1 and "build" in err, err)
        code, out, _ = cli("status", "--json")
        check("status --json when stopped exits 3", code == 3 and json.loads(out)["running"] is False, out)

        main_js.parent.mkdir(parents=True)
        main_js.write_text("// fake\n")
        code, out, err = cli("start")
        data = json.loads(out) if code == 0 else {}
        check("start writes pid and port", code == 0 and data.get("port") == fake.port, (code, out, err))
        ef = home / "engine.json"
        check("engine.json is mode 0600", ef.exists() and (ef.stat().st_mode & 0o777) == 0o600)
        code, out, err = cli("start")
        check("second start refused while alive", code == 1 and "already running" in err, err)
        code, out, err = cli("run")
        check("run exits 0 when an engine is already up, so launchd does not retry it",
              code == 0 and "already running" in err, (code, err))
        code, out, _ = cli("status", "--json")
        st = json.loads(out)
        # The fake server listens in this test process, outside the fake
        # node's process tree, which is exactly the squatter case the
        # 2026-10-05 review found: status must say running but refuse it.
        check("status reports running, and refuses a port the engine does not own",
              st["running"] and st.get("reachable") is False and "held by pid" in str(st.get("error")), st)
        pid = data.get("pid")
        code, out, err = cli("stop")
        check("stop exits 0", code == 0, err)
        time.sleep(0.2)
        check("stop killed the engine and removed engine.json",
              pid and not rc.pid_alive(pid) and not ef.exists(), (pid, ef.exists()))
        code, out, err = cli("stop")
        check("stop when stopped is a no-op", code == 0, err)

        ef.write_text(json.dumps({"pid": os.getpid(), "port": fake.port}))
        os.chmod(ef, 0o600)
        code, out, err = cli("stop")
        check("stop never kills a pid that is not a realm server",
              code == 0 and rc.pid_alive(os.getpid()) and not ef.exists(), err)

        # The verifier's repro: an unrelated `node dist/main.js` with a stale
        # engine.json pointing at it. Status must not call it the engine and
        # stop must not kill it.
        for label, home_env in (("no REALM_HOME", None), ("another REALM_HOME", d / "other")):
            victim = fake_engine_proc(home_env, "dist/main.js")
            time.sleep(0.2)
            ef.write_text(json.dumps({"pid": victim.pid, "port": fake.port}))
            os.chmod(ef, 0o600)
            code, out, _ = cli("status", "--json")
            check(f"status does not adopt a dist/main.js with {label}",
                  code == 3 and json.loads(out)["running"] is False, out)
            ef.write_text(json.dumps({"pid": victim.pid, "port": fake.port}))
            os.chmod(ef, 0o600)
            cli("stop")
            time.sleep(0.2)
            check(f"stop leaves a dist/main.js with {label} alive", victim.poll() is None)
            victim.kill()
            victim.wait()
        if ef.exists():
            ef.unlink()

        # A hand-started server whose REALM_HOME is spelled differently is
        # still on this realm.db, so start must count it as a stray.
        stray = fake_engine_proc(str(home) + "/")
        time.sleep(0.2)
        code, out, err = cli("start")
        check("start refuses a stray whose REALM_HOME has a trailing slash",
              code == 1 and str(stray.pid) in err and not ef.exists(), (code, err))
        stray.kill()
        stray.wait()

        # Concurrent starts: the flock lets exactly one through.
        procs = [subprocess.Popen([sys.executable, engine, "start"],
                                  env=dict(env, FAKE_NODE_DELAY="0.6"),
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                 for _ in range(3)]
        results = [(p.wait(timeout=30), p.stdout.read(), p.stderr.read()) for p in procs]
        winners = [json.loads(o) for c, o, _ in results if c == 0]
        check("three concurrent starts: exactly one wins", len(winners) == 1, results)
        losers = [e for c, _, e in results if c != 0]
        check("the others are refused, not crashed",
              all("in progress" in e or "already running" in e for e in losers), losers)
        on_disk = json.loads(ef.read_text()) if ef.exists() else {}
        check("engine.json names the winner", winners and on_disk.get("pid") == winners[0]["pid"],
              (winners, on_disk))
        cli("stop")
        time.sleep(0.2)
        check("no fake engine left behind after stop",
              not any(rc.is_realm_server(w["pid"], home) for w in winners))

        lock = os.open(home / "engine.lock", os.O_RDWR | os.O_CREAT, 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        code, out, err = cli("start")
        check("start refuses while another start holds the lock",
              code == 1 and "in progress" in err, (code, err))
        code, out, err = cli("run")
        check("run exits 0 while another start holds the lock", code == 0, (code, err))
        os.close(lock)

        code, out, err = cli("plist")
        ok = code == 0 and "__" not in out
        try:
            pl = plistlib.loads(out.encode())
        except Exception as e:  # noqa: BLE001
            pl, ok = {}, False
            err = repr(e)
        check("plist renders with every placeholder filled", ok, err)
        check("plist runs `realm-engine run` with the chosen home",
              pl.get("ProgramArguments", [])[-1:] == ["run"]
              and pl.get("EnvironmentVariables", {}).get("CHEWBACCA_REALM_HOME") == str(home), pl)
        check("plist PATH holds node's folder",
              str(node.parent) in pl.get("EnvironmentVariables", {}).get("PATH", "").split(":"), pl)
        check("plist runs python3 through /usr/bin/env, not a versioned brew path",
              pl.get("ProgramArguments", [])[:2] == ["/usr/bin/env", "python3"], pl.get("ProgramArguments"))
        code, out, _ = cli("plist", extra={"CHEWBACCA_PYTHON": "/usr/bin/python3"})
        args = plistlib.loads(out.encode()).get("ProgramArguments", []) if code == 0 else []
        check("CHEWBACCA_PYTHON overrides the plist's python", args[:2] == ["/usr/bin/env", "/usr/bin/python3"], args)
    fake.close()


def main():
    test_basic_call()
    test_errors()
    test_write_failures_after_send()
    test_connection_is_not_public()
    test_write_gate()
    test_events_and_ping()
    test_frame_across_poll_deadline()
    test_protocol_failures()
    test_engine_file()
    test_read_methods_are_reads()
    test_engine_cli()
    test_security_review_fixes()
    print(f"\n{'FAILED ' + str(failed) if failed else 'all passed'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
