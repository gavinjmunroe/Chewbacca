#!/usr/bin/env python3
"""kyber-sessions without Claude Code, a socket or the real transcripts:
built entries in, decisions out. Run: python3 tests/test_kyber_sessions.py

The inbox tests stand up a fake Claude Code inbox (a Unix socket in /tmp and
a 0600 key file) in this process, so the wire shape and every refusal are
checked with no session and no network. The live proof, run by hand against
a throwaway session the check starts itself in a temp folder, never one of
Caleb's: start `claude --input-format stream-json --output-format
stream-json --verbose` (the VS Code extension's own flags) there, give it one
turn, then `kyber-sessions send <its id> "<text>"` and read the transcript
back for the text and the reply.
"""
import importlib.machinery
import json
import os
import re
import socket
import sys
import tempfile
import threading
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
ks = importlib.machinery.SourceFileLoader("kyber_sessions", str(ROOT / "bin" / "kyber-sessions")).load_module()
inbox = ks.sessions_inbox

PASSED = 0
FAILED = 0


def check(name: str, cond: bool, detail: object = "") -> None:
    global PASSED, FAILED
    if cond:
        PASSED += 1
        print(f"  pass  {name}")
    else:
        FAILED += 1
        print(f"  FAIL  {name}  {detail}")


def user(text, **kw):
    return {"type": "user", "uuid": kw.pop("uuid", "u1"), "message": {"role": "user", "content": text}, **kw}


def assistant(blocks, stop=None, uuid="a1", **kw):
    return {"type": "assistant", "uuid": uuid,
            "message": {"role": "assistant", "model": "claude-opus-5-5", "stop_reason": stop, "content": blocks}, **kw}


def tool(name, **args):
    return {"type": "tool_use", "id": "t1", "name": name, "input": args}


def result(text="ok", error=False):
    return {"type": "user", "uuid": "r1", "message": {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "t1", "content": text, "is_error": error}]}}


def test_classify() -> None:
    print("state from a transcript tail")
    done = [user("fix it"), assistant([{"type": "text", "text": "Fixed."}], stop="end_turn")]
    check("an answered turn is finished", ks.classify(done, 600)[0] == "finished")
    check("a finished turn's sign-off is not shown as its status", ks.classify(done, 600)[1] == "")
    mid = [user("run tests"), assistant([tool("Bash", command="npm test")], stop="tool_use")]
    check("a fresh tool call is working", ks.classify(mid, 5)[0] == "working")
    check("a stalled tool call needs a person", ks.classify(mid, 300) == ("needs", "Bash: npm test"))
    check("a tool call stalled for hours is not waiting on anyone", ks.classify(mid, 3 * 3600)[0] == "failed")
    waiting = [user("go"), assistant([tool("Read", file_path="/x")]), result()]
    check("a tool result just back is working", ks.classify(waiting, 10)[0] == "working")
    check("a question nobody answered for long is failed", ks.classify(waiting, 3600)[0] == "failed")
    schema = [user("review"), assistant([tool("StructuredOutput", verdict="ok")]), result("Structured output provided successfully")]
    check("a --json-schema run that returned is finished, not stalled",
          ks.classify(schema, 3600)[0] == "finished")
    api = [user("go"), assistant([{"type": "text", "text": "API Error: 529 overloaded"}], isApiErrorMessage=True)]
    check("an API error is failed", ks.classify(api, 60)[0] == "failed")
    side = [user("go"), assistant([{"type": "text", "text": "done"}], stop="end_turn"),
            assistant([tool("Bash", command="x")], isSidechain=True)]
    check("a subagent's sidechain does not decide the state", ks.classify(side, 600)[0] == "finished")


def test_meta_and_rows() -> None:
    print("titles, projects and rows")
    entries = [{"type": "ai-title", "aiTitle": "Old"}, user("hello", cwd="/Users/x/code/chewbacca/.claude/worktrees/agent-1", entrypoint="claude-vscode"),
               assistant([{"type": "text", "text": "hi"}]), {"type": "ai-title", "aiTitle": "Kyber glass"}]
    m = ks.meta(entries)
    check("the newest title wins", m["title"] == "Kyber glass", m)
    check("a VS Code session is interactive", m["interactive"])
    check("a scripted run is not",
          not ks.meta([user("x", entrypoint="sdk-py")])["interactive"])
    check("a worktree is its repo", ks.project_of("/Users/x/code/chewbacca/.claude/worktrees/agent-1") == "chewbacca")
    check("a plain folder is itself", ks.project_of("/Users/x/code/lemma") == "lemma")
    rows = [{"id": "b", "state": "finished", "last": 9}, {"id": "a", "state": "needs", "last": 1},
            {"id": "c", "state": "working", "last": 5}, {"id": "d", "state": "failed", "last": 8}]
    check("needs you first, then working, failed, finished",
          [r["id"] for r in ks.order(rows)] == ["a", "c", "d", "b"])
    shown = ks.session_rows([{"id": "a", "state": "needs", "project": "lemma", "title": "Ship it",
                              "model": "opus", "last": 100.0}], now=400.0)
    check("a row says what it needs, the model and the age",
          shown[0]["time"] == "needs you · opus · 5m" and shown[0]["accent"], shown)


def test_card_items() -> None:
    print("a transcript as rows on the glass")
    entries = [
        user("<command-name>/clear</command-name>"),
        user("make the rail glass"),
        assistant([{"type": "text", "text": "On it."}, tool("Edit", file_path="/Users/x/a.swift",
                                                             old_string="a", new_string="b")], uuid="a2"),
        result("boom", error=True),
        assistant([tool("Bash", command="swift test")], uuid="a3"),
    ]
    items = ks.card_items(entries)
    roles = [i["role"] for i in items]
    check("a command wrapper is not shown as something they typed", roles[0] == "user" and items[0]["text"] == "make the rail glass", items)
    check("prose, a folded tool call and an error", roles == ["user", "assistant", "tool", "error", "tool"], roles)
    check("an edit can be opened as a diff", items[2].get("open") is True)
    check("a shell call cannot", "open" not in items[4])
    use = ks.tool_use_by_key(entries, items[2]["id"])
    diff = ks.edit_diff(use)
    check("an edit renders as - then +", "-a" in diff and "+b" in diff and diff.startswith("--- /Users/x/a.swift"), diff)


def test_safety() -> None:
    print("nothing in a transcript decides anything")
    with tempfile.TemporaryDirectory(dir=Path.home()) as d:
        f = Path(d) / "x.txt"
        f.write_text("hi")
        check("a file under home can be viewed", ks.under_home(str(f)) == str(f.resolve()))
    check("a file outside home cannot", ks.under_home("/etc/hosts") is None)
    with tempfile.TemporaryDirectory() as d:
        cwd = Path(d)
        check("status and diff are allowlisted", ks.allowlisted("status", cwd)[:2] == ["git", "status"]
              and ks.allowlisted("diff", cwd)[:2] == ["git", "diff"])
        check("tests run only what the folder declares", ks.allowlisted("tests", cwd) is None)
        (cwd / "package.json").write_text(json.dumps({"scripts": {"test": "vitest"}}))
        check("a declared npm test runs as npm test", ks.allowlisted("tests", cwd) == ["npm", "test", "--silent"])
        check("anything else is refused", ks.allowlisted("rm", cwd) is None)
        base = {"agent": "claude", "cwd": d, "id": "abc", "config": ""}
        check("a finished session can be sent to", ks.can_send({**base, "state": "finished"}) is None)
        check("a working one cannot", ks.can_send({**base, "state": "working"}) is not None)
        check("one waiting on a permission cannot", ks.can_send({**base, "state": "needs"}) is not None)
        check("codex is read-only", ks.can_send({**base, "agent": "codex", "state": "finished"}) is not None)
    argv = ks.send_argv({"id": "abc"})
    check("a send resumes the session with no permission flag",
          argv[:4] == ["claude", "-p", "--resume", "abc"]
          and not any("permission" in a or "dangerously" in a for a in argv), argv)


def test_env_matches_hud_listen() -> None:
    print("the same session scrubbing as hud-listen")
    src = (ROOT / "bin" / "hud-listen").read_text()
    names = set(re.findall(r'"([A-Z_]+)"', re.search(r"INHERITED_SESSION_VARS = frozenset\((.*?)\)", src, re.S).group(1)))
    prefixes = re.search(r"INHERITED_SESSION_PREFIXES = \((.*?)\)", src, re.S).group(1)
    check("the variable list is hud-listen's", names == set(ks.INHERITED_SESSION_VARS), names)
    check("the prefixes are hud-listen's", '"CLAUDE_CODE_"' in prefixes and ks.INHERITED_SESSION_PREFIXES == ("CLAUDE_CODE_",))


def test_stream_and_events() -> None:
    print("the reply stream and the display's presses")
    seen = []
    lines = [json.dumps({"type": "stream_event", "event": {"delta": {"type": "text_delta", "text": "Run"}}}),
             "not json",
             json.dumps({"type": "stream_event", "event": {"delta": {"type": "text_delta", "text": "ning."}}}),
             json.dumps({"type": "result", "result": "Running.", "permission_denials": [{"tool_name": "Bash"}]})]
    out = ks.stream_reply(lines, seen.append)
    check("deltas fold into the reply so far", seen == ["Run", "Running."], seen)
    check("a refused permission comes back to be shown", out["permission_denials"][0]["tool_name"] == "Bash")
    ev = ks.parse_event('e action send row="s-abc" surface="s-abc" text="run the tests, then \\"push\\""')
    check("a typed message is read with its quotes intact",
          ev == {"name": "send", "component": "send", "row": "s-abc", "surface": "s-abc",
                 "text": 'run the tests, then "push"'}, ev)
    ev = ks.parse_event("e action open row=\"6d901cd1-aaaa\" surface=\"sessions\"")
    check("a row press names the session", ev["name"] == "open" and ev["row"] == "6d901cd1-aaaa")
    check("anything not an event is ignored", ks.parse_event('h "hello"') is None)
    route = ks.route("tell the lemma session to run the tests", sessions=[
        {"id": "L1", "project": "lemma-replica", "title": "Lemma site"},
        {"id": "C1", "project": "chewbacca", "title": "Kyber"}])
    check("a named session is picked without a model",
          route == {"session": "L1", "message": "run the tests", "why": "named lemma"}, route)


# ── The inbox: typing into a session open in VS Code or a terminal ──────────

class FakeInbox:
    """A Unix socket and key file shaped like Claude Code's, in /tmp (a
    socket path over ~104 bytes cannot bind, and the default temp folder on
    macOS is longer than that)."""

    def __init__(self, status: str = "idle", sid: str = "sess-1") -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="ks", dir="/tmp"))
        (self.dir / "sessions").mkdir()
        self.sock_path = str(self.dir / "i.sock")
        self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.server.bind(self.sock_path)
        self.server.listen(1)
        self.got = b""
        self.done = threading.Event()
        self.token = "ab" * 32
        self.rec = {"pid": os.getpid(), "sessionId": sid, "status": status, "entrypoint": "claude-vscode",
                    "messagingSocketPath": self.sock_path, "_dir": str(self.dir / "sessions")}
        key = inbox.key_path(self.rec)
        key.write_text(json.dumps({"peerToken": self.token}))
        os.chmod(key, 0o600)
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self) -> None:
        self.server.settimeout(5)
        try:
            conn, _ = self.server.accept()
        except OSError:
            self.done.set()
            return
        conn.settimeout(5)
        while True:
            try:
                chunk = conn.recv(65536)
            except OSError:
                break
            if not chunk:
                break
            self.got += chunk
        conn.close()
        self.done.set()

    def lines(self) -> list[dict]:
        self.done.wait(5)
        return [json.loads(x) for x in self.got.decode().splitlines() if x.strip()]

    def close(self) -> None:
        self.server.close()
        for f in list((self.dir / "sessions").iterdir()):
            f.unlink()
        (self.dir / "sessions").rmdir()
        Path(self.sock_path).unlink(missing_ok=True)
        for f in list(self.dir.iterdir()):
            f.unlink()
        self.dir.rmdir()


def test_registry() -> None:
    print("which sessions are open in a client right now")
    with tempfile.TemporaryDirectory() as d:
        sessions = Path(d) / "sessions"
        sessions.mkdir()
        me = os.getpid()
        rows = {
            f"{me}.json": {"pid": me, "sessionId": "live", "procStart": "Mon Oct  5 02:43:40 2026", "status": "idle"},
            "999999.json": {"pid": 999999, "sessionId": "dead", "status": "idle"},
            "1.json": {"pid": 1, "sessionId": "recycled", "procStart": "Thu Jan  1 00:00:00 1970", "status": "idle"},
            "4242.json": {"pid": 77, "sessionId": "liar", "status": "idle"},
        }
        for name, body in rows.items():
            (sessions / name).write_text(json.dumps(body))
        (sessions / "notes.json").write_text("{}")
        alive = {me: "Mon Oct 5 02:43:40 2026", 1: "Fri Oct  2 09:00:00 2026", 77: "x", 4242: "x"}
        got = inbox.live_records([Path(d)], starts=lambda pids: {p: alive[p] for p in pids if p in alive})
        check("a live process with a matching start time is open", "live" in got, got.keys())
        check("a dead pid is not", "dead" not in got)
        check("a recycled pid (different start time) is not", "recycled" not in got)
        check("a record naming another pid than its file is not trusted", "liar" not in got)
    mine = inbox._proc_starts([os.getpid()]).get(os.getpid(), "")
    check("ps reads this process's own start time", bool(mine))
    # Claude Code's procStart is UTC. Read in local time, every live session
    # looked recycled on 2026-10-05 and every send fell back to a resume.
    from datetime import datetime, timezone
    started = datetime.strptime(mine, "%a %b %d %H:%M:%S %Y").replace(tzinfo=timezone.utc).timestamp()
    import time as _time
    check("and reads it in UTC, as Claude Code writes procStart", abs(_time.time() - started) < 600, mine)
    check("the client is named in words", inbox.client_name({"entrypoint": "claude-vscode"}) == "VS Code"
          and inbox.client_name({"entrypoint": "cli"}) == "a terminal")


def test_inbox_refusals() -> None:
    print("the inbox refuses on any doubt, before writing")
    box = FakeInbox(status="busy")
    try:
        check("a busy session is refused as mid-turn", "mid-turn in VS Code" in (inbox.why_not(box.rec) or ""))
        box.rec["status"] = "idle"
        check("an idle one with its own socket and key is ready", inbox.why_not(box.rec) is None, inbox.why_not(box.rec))
        os.chmod(inbox.key_path(box.rec), 0o644)
        check("a key other users can read is refused", "private" in (inbox.why_not(box.rec) or ""))
        os.chmod(inbox.key_path(box.rec), 0o600)
        link = box.dir / "l.sock"
        link.symlink_to(box.sock_path)
        check("a symlinked socket is refused", "socket" in (inbox.why_not({**box.rec, "messagingSocketPath": str(link)}) or ""))
        link.unlink()
        check("no socket at all means the inbox is off",
              "inbox is off" in (inbox.why_not({**box.rec, "messagingSocketPath": ""}) or ""))
        check("a relative socket path is refused", inbox.why_not({**box.rec, "messagingSocketPath": "x.sock"}) is not None)
        try:
            inbox.deliver(box.rec, "hi", pid_of=lambda conn: 1)
            check("a socket held by another process is refused", False)
        except inbox.Refused as err:
            check("a socket held by another process is refused", "different process" in str(err), err)
        check("and nothing reached it", box.lines() == [], box.got)
    finally:
        box.close()
    box = FakeInbox()
    try:
        inbox.key_path(box.rec).write_text(json.dumps({"peerToken": "not hex!"}))
        try:
            inbox.deliver(box.rec, "hi")
            check("a malformed key is refused", False)
        except inbox.Refused as err:
            check("a malformed key is refused", "shape" in str(err), err)
        try:
            inbox.deliver(box.rec, "\x1b\x07  ")
            check("a message of only control characters is refused", False)
        except inbox.Refused as err:
            check("a message of only control characters is refused", "Nothing" in str(err), err)
    finally:
        box.close()


def test_inbox_delivery() -> None:
    print("the two lines Claude Code's inbox reads")
    box = FakeInbox(sid="6d901cd1-aaaa")
    try:
        inbox.deliver(box.rec, "run the tests\x1b[2J\x07, then push ")
        got = box.lines()
        check("an auth line with the key's token comes first", got[0] == {"type": "auth", "token": box.token}, got)
        msg = got[1] if len(got) > 1 else {}
        check("then one user message", msg.get("type") == "user" and msg["message"]["role"] == "user", msg)
        check("control characters are stripped before it goes",
              msg.get("message", {}).get("content") == "run the tests[2J, then push", msg)
        check("it names the session, so a reused socket drops it", msg.get("session_id") == "6d901cd1-aaaa")
        check("it is queued as the next prompt", msg.get("priority") == "next")
        check("exactly two lines, nothing else", len(got) == 2)
    finally:
        box.close()
    check("a long paste is capped", len(inbox.clean("x" * 50_000)) == inbox.MAX_CHARS)
    check("newlines survive cleaning", inbox.clean("a\nb\tc") == "a\nb\tc")


def peer_entry(body: str, sender: str = "unknown", uuid: str = "p1") -> dict:
    content = inbox.PEER_HEAD + body + inbox.PEER_TAIL + " \u2014 not typed by your user."
    return {"type": "user", "uuid": uuid, "isMeta": True, "origin": {"kind": "peer", "from": sender},
            "message": {"role": "user", "content": content}}


def test_follow() -> None:
    print("arrival and the reply, read back from the transcript")
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "t.jsonl"
        path.write_text(json.dumps(user("earlier")) + "\n")
        offset = inbox.size_of(path)
        with path.open("a") as f:
            f.write(json.dumps(peer_entry("run the tests")) + "\n")
            f.write(json.dumps(assistant([{"type": "text", "text": "Running.\x1b[0m"}], uuid="a9")) + "\n")
            f.write(json.dumps(assistant([{"type": "text", "text": "All 12 pass."}], stop="end_turn", uuid="a10")) + "\n")
        states = iter(["busy", "busy", "idle"])
        seen: list[str] = []
        ticks = iter(range(1000))
        out = inbox.follow(path, offset, "run the tests", lambda: next(states, "idle"), seen.append,
                           clock=lambda: float(next(ticks)), sleep=lambda s: None)
        check("the message is proved to have arrived", out.get("delivered") is True, out)
        check("the reply streams, cleaned", seen[:2] == ["Running.[0m", "All 12 pass."], seen)
        check("it ends when the session is idle again", out == {"is_error": False, "delivered": True, "result": "All 12 pass."}, out)
        ticks = iter(range(0, 10_000, 5))
        out = inbox.follow(path, inbox.size_of(path), "something else", lambda: "idle", seen.append,
                           confirm_s=20, clock=lambda: float(next(ticks)), sleep=lambda s: None)
        check("a message that never shows up is reported, not assumed",
              out["is_error"] and out["delivered"] is False, out)
        offset = inbox.size_of(path)
        with path.open("a") as f:
            f.write(json.dumps({"type": "system", "subtype": "informational", "level": "warning",
                                "content": "Held peer message \u2014 from an unidentified session; preview: "
                                           "\u00absomebody else's words\u00bb \u2014 not delivered"}) + "\n")
            f.write(json.dumps({"type": "system", "subtype": "informational", "level": "warning",
                                "content": "Held peer message \u2014 from an unidentified session [verified pid 1]; "
                                           "preview: \u00abrun the linter\u00bb \u2014 not delivered to Claude (1 held)."}) + "\n")
        ticks = iter(range(1000))
        out = inbox.follow(path, offset, "run the linter", lambda: "idle", seen.append,
                           clock=lambda: float(next(ticks)), sleep=lambda s: None)
        check("a message held for review in a bypass session is reported as held at once",
              out.get("held") is True and out["delivered"] is False and "review" in out["result"], out)


def test_open_sessions() -> None:
    print("open sessions: state, sending and the card")
    rows = {"a": {"state": "finished", "detail": ""}, "b": {"state": "failed", "detail": "x"},
            "c": {"state": "needs", "detail": "Bash: npm test"}, "d": {"state": "working", "detail": ""}}
    ks.merge_live(rows, {"a": {"status": "busy", "entrypoint": "cli"}, "b": {"status": "idle"},
                         "c": {"status": "busy"}, "d": {"status": "idle", "entrypoint": "claude-vscode"}})
    check("busy in the registry is working", rows["a"]["state"] == "working" and rows["a"]["open_in"] == "a terminal")
    check("idle in the registry is not a failure", rows["b"]["state"] == "finished")
    check("a stalled tool call while busy still needs you", rows["c"]["state"] == "needs")
    check("a transcript guess of working yields to idle", rows["d"]["state"] == "finished" and rows["d"]["open_in"] == "VS Code")
    box = FakeInbox()
    try:
        base = {"agent": "claude", "cwd": "/nonexistent", "id": "sess-1", "state": "finished",
                "config": str(box.dir), "mode": "default"}
        saved_managed, inbox.MANAGED_SETTINGS = inbox.MANAGED_SETTINGS, box.dir / "no-managed.json"
        check("an idle open session can be sent to, even with its folder gone", ks.can_send(base, box.rec) is None)
        check("a busy one cannot", ks.can_send(base, {**box.rec, "status": "busy"}) is not None)
        check("one waiting on a permission cannot, open or not", ks.can_send({**base, "state": "needs"}, box.rec) is not None)
        inbox.MANAGED_SETTINGS = saved_managed
    finally:
        box.close()
    items = ks.card_items([user("go"), peer_entry("run the tests"), peer_entry("ship it", sender="uds:/tmp/cc-socks/1.sock", uuid="p2"),
                           assistant([{"type": "text", "text": "ok\x1b]0;evil\x07"}], uuid="a3")])
    check("a message sent from the glass shows as theirs", items[1] == {"id": "p1:0", "role": "user", "text": "run the tests"}, items)
    check("one from another session says so", items[2]["text"] == "From another session: ship it", items)
    check("terminal control sequences never reach the glass", "\x1b" not in items[3]["text"] and "\x07" not in items[3]["text"], items)
    lines = ks.card_surface({"id": "6d901cd1-aaaa", "project": "lemma", "title": "t", "model": "opus",
                             "state": "finished", "open_in": "VS Code"}, [], [])
    joined = "\n".join(lines)
    check("the card has a message Field bound to its own pointer", 'c msg Field label="Message"' in joined
          and "value=@/s-6d901cd1/draft" in joined, joined)
    check("and one primary Send that presses `send`", 'c go Button label="Send" action=send variant=primary' in joined)
    check("an idle open session says where Send types", "Idle in VS Code" in joined)


def test_serve_draft() -> None:
    print("the card's Field and Send, without a display")
    tmp = tempfile.mkdtemp()
    card = {"id": "6d901cd1-aaaa", "project": "lemma", "agent": "claude", "state": "finished", "cwd": tmp}
    saved = (ks.find, ks.live_record)
    ks.find = lambda sid, now=None: dict(card) if sid == card["id"] else None
    ks.live_record = lambda session: None
    srv = object.__new__(ks.Serve)
    srv.lock = threading.Lock()
    srv.cards = {"s-6d901cd1": dict(card)}
    srv.drafts = {}
    sent_lines: list[list[str]] = []
    srv.send = sent_lines.append
    calls: list[tuple] = []
    fired = threading.Event()
    srv.send_message = lambda surface, text, fork=False: (calls.append((surface, text, fork)), fired.set())
    srv.on_value('v /s-6d901cd1/draft "run the tests"')
    srv.on_value('v /s-other/draft "not ours"')
    srv.on_value('v /s-6d901cd1/other "ignored"')
    check("a typed message is kept for its card only", srv.drafts == {"s-6d901cd1": "run the tests"}, srv.drafts)
    srv.handle({"name": "send", "component": "go", "surface": "s-6d901cd1"})
    fired.wait(2)
    check("Send sends what was typed to that card's session", calls == [("s-6d901cd1", "run the tests", False)], calls)
    check("and clears the Field", srv.drafts["s-6d901cd1"] == "" and ['@ s-6d901cd1', 'd /s-6d901cd1/draft ""'] in sent_lines, sent_lines)
    calls.clear()
    srv.handle({"name": "send", "component": "go", "surface": "s-6d901cd1"})
    check("Send with nothing typed sends nothing", calls == [] and "Type a message first" in json.dumps(sent_lines[-1]))
    srv.handle({"name": "send", "component": "go", "surface": "s-unknown"})
    check("a press for a card it did not draw does nothing", calls == [])
    srv.on_value('v /s-6d901cd1/draft "keep going"')
    card["state"] = "working"
    srv.handle({"name": "send", "component": "go", "surface": "s-6d901cd1"})
    check("a refused Send keeps the draft and says why",
          calls == [] and srv.drafts["s-6d901cd1"] == "keep going" and "mid-turn" in json.dumps(sent_lines[-1]), sent_lines[-1])
    card["state"] = "finished"
    fired.clear()
    srv.handle({"name": "fork", "component": "fork", "surface": "s-6d901cd1"})
    fired.wait(2)
    check("Fork sends the draft to a fork", calls == [("s-6d901cd1", "keep going", True)], calls)
    ks.find, ks.live_record = saved
    os.rmdir(tmp)


def test_held_prediction() -> None:
    print("a message Claude Code would hold unseen is refused up front")
    with tempfile.TemporaryDirectory() as d:
        config, repo = Path(d) / "config", Path(d) / "repo"
        (config).mkdir()
        (repo / ".claude").mkdir(parents=True)
        nowhere = Path(d) / "managed.json"
        check("nothing set is no policy", inbox.inbound_policy(str(repo), config, nowhere) is None)
        (config / "settings.json").write_text(json.dumps({"crossSessionInbound": "accept"}))
        check("the user's accept is accept", inbox.inbound_policy(str(repo), config, nowhere) == "accept")
        (repo / ".claude" / "settings.json").write_text(json.dumps({"crossSessionInbound": "hold"}))
        check("a repo's hold beats the user's accept", inbox.inbound_policy(str(repo), config, nowhere) == "hold")
        nowhere.write_text(json.dumps({"crossSessionInbound": "refuse"}))
        check("managed refuse beats everything", inbox.inbound_policy(str(repo), config, nowhere) == "refuse")
        nowhere.write_text(json.dumps({"crossSessionInbound": "sometimes"}))
        (repo / ".claude" / "settings.json").write_text("{}")
        check("an unrecognized value holds, as Claude Code does", inbox.inbound_policy(str(repo), config, nowhere) == "hold")
    check("bypass with no setting is held, and says to fork",
          "Fork" in (inbox.hold_reason("bypassPermissions", None, "VS Code") or ""))
    check("a prompting session takes it", inbox.hold_reason("default", None, "VS Code") is None
          and inbox.hold_reason("acceptEdits", None, "a terminal") is None)
    # 2.1.289 treats dontAsk as prompting: refusing it refused a send that lands.
    check("dontAsk takes it, it is not a prompts-off mode", inbox.hold_reason("dontAsk", None, "VS Code") is None)
    check("plan, which holds when bypass is available, is refused closed",
          "Fork" in (inbox.hold_reason("plan", None, "VS Code") or ""))
    check("a mode refusal says the mode is only as new as the last turn",
          "last turn" in (inbox.hold_reason("bypassPermissions", None, "VS Code") or "")
          and "changed in VS Code" in (inbox.hold_reason("bypassPermissions", None, "VS Code") or ""))
    check("accept delivers even to bypass", inbox.hold_reason("bypassPermissions", "accept", "VS Code") is None)
    check("hold holds even a prompting session", inbox.hold_reason("default", "hold", "VS Code") is not None)
    check("refuse refuses", "refuse" in (inbox.hold_reason("default", "refuse", "VS Code") or ""))
    check("an unknown mode fails closed", "could not be read" in (inbox.hold_reason("", None, "VS Code") or ""))
    check("but accept still delivers", inbox.hold_reason("", "accept", "VS Code") is None)
    with tempfile.TemporaryDirectory() as d:
        t = Path(d) / "t.jsonl"
        lines = [json.dumps(user("a", permissionMode="default")), json.dumps(user("b", permissionMode="bypassPermissions"))]
        lines += [json.dumps(result("x" * 200))] * 50
        t.write_text("\n".join(lines) + "\n")
        check("the mode is found far behind the tail, newest first", inbox.last_mode(t, step=300) == "bypassPermissions")
        t.write_text(json.dumps(user("a")) + "\n")
        check("a transcript that never says has no mode", inbox.last_mode(t) == "")
    box = FakeInbox()
    try:
        with tempfile.TemporaryDirectory() as d:
            base = {"agent": "claude", "cwd": d, "id": "sess-1", "state": "finished", "config": d, "open_in": "VS Code"}
            saved = inbox.MANAGED_SETTINGS
            inbox.MANAGED_SETTINGS = Path(d) / "none.json"
            check("an idle bypass session in VS Code is refused before sending",
                  "Fork" in (ks.can_send({**base, "mode": "bypassPermissions"}, box.rec) or ""))
            check("an idle prompting one is not", ks.can_send({**base, "mode": "default"}, box.rec) is None)
            inbox.MANAGED_SETTINGS = saved
            check("a fork is allowed while it sits idle", ks.can_fork(base) is None)
            check("but not mid-turn", ks.can_fork({**base, "live": "busy"}) is not None)
    finally:
        box.close()
    argv = ks.send_argv({"id": "abc"}, fork=True)
    check("a fork resumes into a new session id, still with no permission flag",
          argv[-1] == "--fork-session" and argv[2:4] == ["--resume", "abc"]
          and not any("permission" in a or "dangerously" in a for a in argv), argv)
    entries = [user("x", permissionMode="default"), user("y", permissionMode="bypassPermissions")]
    check("a session's mode is its newest permissionMode", ks.meta(entries)["mode"] == "bypassPermissions")
    # The live bypass probe on 2026-10-05 read as mode "" because the title,
    # model and folder were all found after the mode's line and the walk stopped.
    late = [user("go", permissionMode="bypassPermissions", cwd="/x"), assistant([{"type": "text", "text": "ok"}]),
            {"type": "ai-title", "aiTitle": "T"}]
    check("the mode is found even when title, model and folder come after it", ks.meta(late)["mode"] == "bypassPermissions")


class FakeProc:
    """Stands in for `claude -p`: records argv and what arrived on stdin."""
    made: list["FakeProc"] = []

    def __init__(self, argv, **kw):
        self.argv = argv
        self.kw = kw
        self.fed = ""
        self.closed = threading.Event()
        proc = self

        class In:
            def write(self, text):
                proc.fed += text

            def close(self):
                proc.closed.set()

        self.stdin = In()
        self.stdout = iter([json.dumps({"type": "result", "result": "ok", "session_id": "new-1"})])
        FakeProc.made.append(self)

    def wait(self):
        self.closed.wait(2)
        return 0


def test_review_fixes() -> None:
    print("the 2026-10-05 review: flags, prefixes, --fork, hidden characters, modes")
    tmp = tempfile.mkdtemp()
    session = {"id": "abc-123", "agent": "claude", "state": "finished", "cwd": tmp, "config": ""}
    saved = (ks.subprocess.Popen, ks.live_record)
    ks.subprocess.Popen, ks.live_record = FakeProc, (lambda s: None)
    try:
        for fork in (False, True):
            FakeProc.made.clear()
            out = ks.send(session, "--version", lambda t: None, fork=fork)
            proc = FakeProc.made[-1] if FakeProc.made else None
            check(f"a message starting with a dash is never in argv ({'fork' if fork else 'resume'})",
                  proc is not None and "--version" not in proc.argv and out.get("result") == "ok",
                  proc.argv if proc else out)
            check(f"it goes on stdin instead ({'fork' if fork else 'resume'})",
                  proc is not None and proc.fed == "--version" and proc.kw.get("stdin") == ks.subprocess.PIPE,
                  proc.fed if proc else None)
        FakeProc.made.clear()
        out = ks.send({**session, "id": "--dangerously-skip-permissions"}, "hi", lambda t: None)
        check("an id shaped like a flag is refused, nothing started",
              out.get("is_error") and FakeProc.made == [], out)
    finally:
        ks.subprocess.Popen, ks.live_record = saved
        os.rmdir(tmp)

    rows = [{"id": "b1-aaaa", "state": "finished", "last": 1}, {"id": "b2-bbbb", "state": "finished", "last": 2},
            {"id": "c1-cccc", "state": "finished", "last": 3}, {"id": "c1", "state": "finished", "last": 4}]
    saved_discover = ks.discover
    ks.discover = lambda now=None, board=None, everything=False, live=None: [dict(r) for r in rows]
    sent: list[tuple] = []
    saved_send = ks.send
    ks.send = lambda s, text, on_text, fork=False: (sent.append((s["id"], text, fork)) or
                                                    {"result": "ok", "via": "fork" if fork else "resume"})
    try:
        check("an ambiguous prefix finds nothing", ks.find("b") is None)
        check("a unique prefix finds its session", (ks.find("b2") or {}).get("id") == "b2-bbbb")
        check("an exact id wins over ids it prefixes", (ks.find("c1") or {}).get("id") == "c1")
        code = ks.main(["send", "b", "run", "the", "tests"])
        check("send refuses a prefix matching two sessions, and sends nothing", code == 1 and sent == [], sent)
        code = ks.main(["send", "b1", "keep", "--fork", "out"])
        check("--fork after the id is part of the message, not a flag",
              code == 0 and sent == [("b1-aaaa", "keep --fork out", False)], sent)
        sent.clear()
        code = ks.main(["send", "--fork", "b1", "go", "on"])
        check("a leading --fork forks", code == 0 and sent == [("b1-aaaa", "go on", True)], sent)
        sent.clear()
        import contextlib
        import io
        buf = io.StringIO()
        ks.send = lambda s, text, on_text, fork=False: {"is_error": True, "held": True, "delivered": False,
                                                        "result": "Held for review", "via": "inbox"}
        with contextlib.redirect_stdout(buf):
            code = ks.main(["send", "b1", "hi"])
        last = json.loads(buf.getvalue().strip().splitlines()[-1])
        check("a message held after delivery reports held, not delivered",
              code == 1 and last.get("held") is True and last.get("delivered") is False, last)
    finally:
        ks.discover, ks.send = saved_discover, saved_send

    hidden = "\u202aA\u202bB\u202cC\u202dD\u202eE\u2066F\u2067G\u2068H\u2069I\u200bJ\u200cK\u200dL\ufeffM\u2028N\u2029O"
    check("bidi overrides, zero-width characters, the BOM and separators are stripped",
          inbox.clean(hidden) == "ABCDEFGHIJKLMNO", repr(inbox.clean(hidden)))
    check("tab and newline still survive", inbox.clean("a\tb\nc\x1b") == "a\tb\nc")
    items = ks.card_items([assistant([{"type": "text", "text": "safe\u202eexe.txt"}])])
    check("a transcript cannot reorder the glass", items[0]["text"] == "safeexe.txt", items)

    with tempfile.TemporaryDirectory() as d:
        t = Path(d) / "x.jsonl"
        filler = json.dumps(result("y" * 2000)) + "\n"
        t.write_text(json.dumps(user("go", permissionMode="bypassPermissions", cwd=d)) + "\n"
                     + filler * (ks.TAIL_BYTES // len(filler) + 20))
        tail_mode = ks.meta(ks.tail_entries(t))["mode"]
        row = ks.from_transcript(Path(d), t, now=t.stat().st_mtime)
        check("the mode is behind the tail in this fixture", tail_mode == "", tail_mode)
        check("--json reports the effective mode, read from behind the tail",
              row["mode"] == "bypassPermissions", row["mode"])


def test_card_text_is_cleaned() -> None:
    """Title, model and status detail come from the transcript. A review on
    2026-10-05 drew a bidi override from aiTitle and from a pending Bash
    command onto the card."""
    s = {"id": "abc12345", "project": "p", "title": "fix \u202egnp.exe", "model": "opus",
         "state": "needs", "ask": "Bash: echo \u202eevil\u200b", "detail": "", "cwd": "/tmp"}
    out = "\n".join(ks.card_surface(s, [], []))
    check("no bidi or zero-width character reaches the card", not re.search("[\u202a-\u202e\u2066-\u2069\u200b-\u200d]|\\\\u202e", out), out[:200])


def main() -> int:
    test_classify()
    test_meta_and_rows()
    test_card_items()
    test_safety()
    test_env_matches_hud_listen()
    test_stream_and_events()
    test_registry()
    test_inbox_refusals()
    test_inbox_delivery()
    test_follow()
    test_open_sessions()
    test_serve_draft()
    test_held_prediction()
    test_review_fixes()
    test_card_text_is_cleaned()
    print("all passed" if not FAILED else f"{FAILED} failed")
    return 1 if FAILED else 0


def test_all() -> None:
    assert main() == 0


if __name__ == "__main__":
    sys.exit(main())
