#!/usr/bin/env python3
"""agents: the realm-engine surface, against an in-memory fake engine.

What is held here: a down engine is a first-run state that offers "Start the
engine" (or "Build and start") and nothing that writes; the session list puts
what needs the person first and the pin does not follow a re-sort; Send goes
to the pinned session only, refuses a second press in flight and a session
mid-turn, and after a maybe_applied failure says "may have" and never sends
again on its own; a pending permission shows its tool and whole input with
Allow once and Deny for that requestId only, Allow is withheld when the input
held a hidden character or does not fit, and allow_always is never sent;
Interrupt and Fork appear only when they apply; a new session starts in a
folder picked from the Select, never a typed path, making a space and a
project only when none exists; no control, format or bidi character from the
engine reaches a `d` line or the activity log.

THE FAKE (FakeEngine). The method names, params and result shapes follow
realm's packages/contracts/src/rpc.ts, entities.ts and session-events.ts at
the checkout in ~/code/vendor/realm on 2026-10-05: Session {id, spaceId,
projectId, agentKind, permissionMode, environmentId, cwd, status, title,
updatedAt}, StoredSessionEvent {seq, sessionId, event {type, ts, payload}},
seq global across sessions. FakeConn enforces realm_client's own gate: a
method outside READ_METHODS and EXEC_METHODS raises RealmWriteRefused unless
write=True, so a write the surface makes outside a press fails here as it
would against the real client.
Run: python3 tests/test_surface_agents.py
"""
import json
import sys
import tempfile
import threading
import unicodedata
from datetime import datetime
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_kyber_surfaces as tks  # noqa: E402  validate(), FakeHud and the daemon

import realm_client as rc  # noqa: E402
import surfaces  # noqa: E402
from surfaces import Context  # noqa: E402
from surfaces import agents as SA  # noqa: E402
from surfaces.agents import Agents  # noqa: E402

tks.COMPONENTS.add("Transcript")
BIDI = "‮"
LINE_SEP = " "
ZWSP = "​"
ESC = "\x1b"
HIDDEN = (BIDI, LINE_SEP, ZWSP, "\u2066", "\x7f", ESC, "\ufe0f", "\u3164")
NOW_MS = 1_790_000_000_000

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


def maybe(err: rc.RealmError) -> rc.RealmError:
    """A failure after the write left this process, as realm_client marks it."""
    err.maybe_applied = True
    return err


class FakeEngine:
    def __init__(self):
        self.calls: list[tuple[str, dict, bool]] = []
        self.profiles = [{"id": "prof1", "name": "Caleb"}]
        self.spaces = [{"id": "sp1", "profileId": "prof1", "name": "Chewbacca", "folderPath": "/realm/sp1"},
                       {"id": "sp2", "profileId": "prof1", "name": "Amber" + BIDI, "folderPath": "/realm/sp2"}]
        self.projects = []
        self.sessions = {}
        self.events = []
        self.seq = 0
        self.checkpoints = []
        self.fail: dict = {}
        self.hold: dict = {}
        self.after: dict = {}
        self.n = 0

    def nid(self, prefix):
        self.n += 1
        return f"{prefix}{self.n}"

    def add_session(self, sid, status="idle", space="sp1", title="Fix the rail", cwd="/Users/x/code/chewbacca",
                    updated=NOW_MS, mode="default"):
        self.sessions[sid] = {"id": sid, "spaceId": space, "projectId": None, "agentKind": "claude",
                              "permissionMode": mode, "environmentId": f"env-{sid}", "cwd": cwd, "status": status,
                              "title": title, "updatedAt": updated, "createdAt": updated}

    def event(self, sid, kind, payload):
        self.seq += 1
        self.events.append({"seq": self.seq, "sessionId": sid, "event": {"type": kind, "ts": NOW_MS,
                                                                          "payload": payload}})
        return self.seq

    @property
    def writes(self):
        return [(m, p) for m, p, w in self.calls if m not in rc.READ_METHODS]

    def handle(self, method, p):
        if method in self.hold:
            self.hold[method].wait(5)
        if method in self.fail:
            err = self.fail[method]
            raise err() if callable(err) and not isinstance(err, Exception) else err
        result = self.answer(method, p)
        if method in self.after:
            # Answer as of now, but return later: a read that lands after a
            # press changed what it read.
            self.after[method].wait(5)
        return result

    def answer(self, method, p):
        if method == "spaces.list":
            return [dict(s) for s in self.spaces]
        if method == "sessions.list":
            return [dict(s) for s in self.sessions.values() if s["spaceId"] == p["spaceId"]]
        if method == "sessions.get":
            if p["id"] not in self.sessions:
                raise rc.RealmRpcError(method, "NOT_FOUND", "no session")
            return dict(self.sessions[p["id"]])
        if method == "sessions.events":
            mine = [e for e in self.events if e["sessionId"] == p["id"] and e["seq"] > p.get("afterSeq", 0)]
            return mine[: p.get("limit", 2000)]
        if method == "checkpoints.list":
            return [c for c in self.checkpoints if c["environmentId"] == p["environmentId"]
                    and (p.get("sessionId") is None or c["sessionId"] == p["sessionId"])]
        if method == "profiles.list":
            return list(self.profiles)
        if method == "profiles.create":
            prof = {"id": self.nid("prof"), "name": p["name"]}
            self.profiles.append(prof)
            return prof
        if method == "spaces.create":
            space = {"id": self.nid("sp"), "profileId": p["profileId"], "name": p["name"],
                     "folderPath": f"/realm/{p['name']}"}
            self.spaces.append(space)
            return space
        if method == "projects.list":
            return [x for x in self.projects if x["spaceId"] == p["spaceId"]]
        if method == "projects.create":
            proj = {"id": self.nid("proj"), "spaceId": p["spaceId"], "name": p["name"], "rootPath": p["rootPath"]}
            self.projects.append(proj)
            return proj
        if method == "sessions.create":
            sid = self.nid("s-new")
            proj = next(x for x in self.projects if x["id"] == p["projectId"])
            self.add_session(sid, space=p["spaceId"], title="New session", cwd=proj["rootPath"],
                             mode=p["permissionMode"])
            return {"session": dict(self.sessions[sid]), "itemId": "item1"}
        if method == "sessions.send":
            self.event(p["id"], "user_message", {"text": p["text"], "attachments": []})
            self.sessions[p["id"]]["status"] = "running"
            return {"ok": True}
        if method == "sessions.respondPermission":
            self.event(p["id"], "permission_response", {"requestId": p["requestId"], "decision": p["decision"]})
            self.sessions[p["id"]]["status"] = "running"
            return {"ok": True}
        if method == "sessions.interrupt":
            self.sessions[p["id"]]["status"] = "idle"
            return {"ok": True}
        if method == "sessions.fork":
            cp = next(c for c in self.checkpoints if c["id"] == p["checkpointId"])
            sid = self.nid("s-fork")
            self.add_session(sid, title="Fork", cwd="/realm/worktrees/fork")
            return {"session": dict(self.sessions[sid]), "itemId": "item2",
                    "environment": {"id": f"env-{sid}", "path": "/realm/worktrees/fork", "from": cp["id"]}}
        raise rc.RealmRpcError(method, "METHOD_NOT_FOUND", method)


class FakeConn:
    def __init__(self, engine):
        self.engine = engine

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return None

    def call(self, method, params=None, timeout=10.0, write=False, allow_exec=False):
        # realm_client.Connection.call's gate, word for word in effect.
        is_write = method not in rc.READ_METHODS and method not in rc.EXEC_METHODS
        if is_write and not write:
            raise rc.RealmWriteRefused(f"{method} changes state; pass write=True")
        if method in rc.EXEC_METHODS and not allow_exec:
            raise rc.RealmExecRefused(method)
        self.engine.calls.append((method, dict(params or {}), write))
        return self.engine.handle(method, dict(params or {}))


def world(tmp: Path, engine: FakeEngine | None, built: bool = True):
    home = tmp / "home"
    code = home / "code"
    for repo in ("chewbacca", "amber/amber-id", "refs/strange"):
        (code / repo / ".git").mkdir(parents=True, exist_ok=True)
        (code / repo / ".git" / "HEAD").write_text("ref: refs/heads/main\n")
    realm = home / "code" / "vendor" / "realm"
    if built:
        (realm / "apps" / "server" / "dist").mkdir(parents=True, exist_ok=True)
        (realm / "apps" / "server" / "dist" / "main.js").write_text("")
    ctx = Context(run=lambda argv: (127, "", "no CLI in this test"), home=home,
                  env={"KYBER_CODE_ROOT": str(code), "CHEWBACCA_REALM_HOME": str(tmp / "realm-home")},
                  now=lambda: datetime.fromtimestamp(NOW_MS / 1000 + 120).astimezone())
    a = Agents()
    if engine is None:
        def refuse(_ctx):
            raise rc.RealmUnavailable(f"engine not started ({tmp}/realm-home/engine.json missing); "
                                      "run realm-engine start")
        a.connect = refuse
    else:
        a.connect = lambda _ctx: FakeConn(engine)
    return a, ctx


def view(a, ctx, values=None):
    data = a.fetch(ctx)
    return data, a.model(data, None, values or {}, ctx)


def strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from strings(v)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            yield from strings(v)


def glass_clean(obj) -> bool:
    """No hidden character in any string, read raw: json.dumps escapes C0
    controls, so a leaked ESC would never match in its output (reviewer,
    2026-10-05). A turn's own newline is the one character allowed."""
    return not any(unseen(ch) and ch != "\n" for text in strings(obj) for ch in text)


def unseen(ch: str) -> bool:
    """The test's own idea of hidden, not the surface's, or a mutant that
    broke SA.hidden would break the checker with it and pass."""
    return unicodedata.category(ch)[0] == "C" or unicodedata.category(ch) in ("Zl", "Zp") or ch in HIDDEN


def down_state(tmp: Path) -> None:
    a, ctx = world(tmp / "down", None)
    lines = [f"@ {a.name} at=center w={a.width}"] + a.layout()
    data, model = view(a, ctx)
    lines += [surfaces.data_line(k, v) for k, v in {**a.initial(), **model}.items()]
    check("down: the drawing is valid Kyber Lines", not tks.validate(lines), tks.validate(lines))
    check("down: the note says the engine isn't running", "isn't running" in model["/agents/note"],
          model["/agents/note"])
    check("down: steps a stranger can follow, naming what the engine is",
          len(model["/agents/setup"]) >= 3 and "Carlton Aikins" in model["/agents/setup"][0]["text"],
          model["/agents/setup"])
    check("down: Start the engine is the one row offered", model["/agents/engine"][0]["id"] == "start"
          and model["/agents/engineLabel"] == "Start the engine", model["/agents/engine"])
    writes = [model[f"/agents/{k}"] for k in ("send", "allow", "deny", "interrupt", "fork", "new")]
    check("down: nothing that writes is offered", all(w == [] for w in writes), writes)
    model2 = a.model(data, None, {"/agents/folder": "~/code/chewbacca"}, ctx)
    check("down: picking a folder still offers no Start", model2["/agents/new"] == [], model2["/agents/new"])

    ran = []
    a.run_engine = lambda argv, env, timeout: ran.append((argv, env)) or (0, "started pid 1 port 2\n", "")
    r = a.start_engine(ctx, data, {"row": "start"})
    check("Start the engine runs realm-engine start on the surface's own realm home",
          r.ok and len(ran) == 1 and ran[0][0][-2:] == [str(SA.ENGINE), "start"]
          and ran[0][1]["CHEWBACCA_REALM_HOME"] == str(tmp / "down" / "realm-home"), (r, ran))
    a.run_engine = lambda argv, env, timeout: (1, "", "realm-engine: node not found (CHEWBACCA_NODE)\n")
    r = a.start_engine(ctx, data, {"row": "start"})
    check("a failed start says what realm-engine said", not r.ok and "node not found" in r.line, r)

    b, bctx = world(tmp / "unbuilt", None, built=False)
    bdata, bmodel = view(b, bctx)
    check("not built: says so and offers Build and start", "isn't built" in bmodel["/agents/note"]
          and bmodel["/agents/engineLabel"] == "Build and start", bmodel["/agents/note"])
    ran = []
    b.run_engine = lambda argv, env, timeout: ran.append(argv[-1]) or (0, "", "")
    b.start_engine(bctx, bdata, {"row": "start"})
    check("Build and start builds, then starts", ran == ["build", "start"], ran)

    e = FakeEngine()
    up, uctx = world(tmp / "up", e)
    udata, _ = view(up, uctx)
    ran = []
    up.run_engine = lambda argv, env, timeout: ran.append(argv) or (0, "", "")
    r = up.start_engine(uctx, udata, {"row": "start"})
    check("Start the engine on a running engine runs nothing", not r.ok and ran == [], (r, ran))


def listing_and_pin(tmp: Path) -> None:
    e = FakeEngine()
    e.add_session("s-idle", "idle", title="Rail glass" + BIDI + LINE_SEP, updated=NOW_MS - 60_000)
    e.add_session("s-work", "running", space="sp2", title="Amber deck", cwd="/Users/x/code/amber/amber-id")
    e.add_session("s-wait", "waiting_permission", title="Run the tests", updated=NOW_MS - 5_000)
    e.event("s-wait", "user_message", {"text": "run the tests", "attachments": []})
    e.event("s-wait", "permission_request", {"requestId": "req-1", "toolName": "Bash",
                                             "input": {"command": "npm test"}, "title": "Allow Bash?",
                                             "suggestions": []})
    a, ctx = world(tmp / "list", e)
    data, model = view(a, ctx)
    ids = [r["id"] for r in model["/agents/rows"]]
    check("what needs you first: waiting, then working, then idle", ids == ["s-wait", "s-work", "s-idle"], ids)
    check("the header counts say what to do", model["/agents/note"] == "3 sessions · 1 waiting on you · 1 working",
          model["/agents/note"])
    check("with nothing picked, the session that needs you most is pinned", a.pinned == "s-wait", a.pinned)
    check("rows name the state in words", model["/agents/rows"][0]["time"].startswith("waiting on you"),
          model["/agents/rows"][0])
    check("titles and space names reach the glass stripped", glass_clean(model), model["/agents/rows"])

    r = a.pick(ctx, data, {"row": "s-idle"})
    check("Open pins a session", r.ok and a.pinned == "s-idle", (r, a.pinned))
    e.sessions["s-idle"]["status"] = "running"
    e.sessions["s-work"]["status"] = "idle"
    data, model = view(a, ctx)
    check("a re-sort does not move the pin", a.pinned == "s-idle" and model["/agents/rows"][1]["id"] == "s-idle"
          and model["/agents/interrupt"][0]["id"] == "s-idle", (a.pinned, [r["id"] for r in model["/agents/rows"]]))
    e.sessions["s-idle"]["status"] = "idle"
    data, model = view(a, ctx)
    check("Send's row is the pinned session and says it can't be unsent",
          model["/agents/send"][0]["id"] == "s-idle" and "can't be unsent" in model["/agents/send"][0]["text"],
          model["/agents/send"])
    check("an idle session offers no Interrupt", model["/agents/interrupt"] == [], model["/agents/interrupt"])
    check("reading the panel wrote nothing", e.writes == [], e.writes)
    check("an idle pin refreshes slowly", a.refresh == SA.REFRESH_IDLE, a.refresh)
    a.pick(ctx, data, {"row": "s-work"})
    e.sessions["s-work"]["status"] = "running"
    view(a, ctx)
    check("a working pin refreshes fast", a.refresh == SA.REFRESH_BUSY, a.refresh)
    del e.sessions["s-work"]
    data, model = view(a, ctx)
    check("a pinned session that disappears is named, and the pin moves to what needs you",
          "gone from the engine" in model["/agents/note"] and a.pinned == "s-wait", (model["/agents/note"], a.pinned))


def sending(tmp: Path) -> None:
    e = FakeEngine()
    e.add_session("s1", "idle", title="Rail", cwd="/Users/x/code/chewbacca")
    e.add_session("s2", "idle", title="Other", cwd="/Users/x/code/amber/amber-id", updated=NOW_MS - 1)
    a, ctx = world(tmp / "send", e)
    data, model = view(a, ctx)
    check("s1 is pinned", a.pinned == "s1", a.pinned)
    r = a.send(ctx, data, {"row": "s2", "/agents/draft": "hello"})
    check("a Send naming another session than the pin refuses and writes nothing",
          not r.ok and e.writes == [], (r, e.writes))
    r = a.send(ctx, data, {"row": "s1", "/agents/draft": "   "})
    check("an empty draft is refused", not r.ok and e.writes == [], r)
    r = a.send(ctx, data, {"row": "s1", "/agents/draft": "say hi in one word"})
    check("Send posts sessions.send to the pinned id with write=True",
          r.ok and e.writes == [("sessions.send", {"id": "s1", "text": "say hi in one word"})]
          and all(w for m, p, w in e.calls if m == "sessions.send"), (r, e.writes))
    check("a sent draft is cleared and read back from the transcript",
          r.updates.get("/agents/draft") == "" and "in the transcript" in r.line, r)
    check("the result line names the folder, never the message", "say hi" not in r.line, r.line)
    e.event("s1", "assistant_text", {"messageId": "m1", "text": "Hi" + BIDI + "!"})
    data, model = view(a, ctx)
    texts = [i["text"] for i in model["/agents/transcript"]]
    check("the transcript shows the turn and the reply, stripped", texts[-2:] == ["say hi in one word", "Hi!"], texts)
    check("a working session offers no Send", model["/agents/send"] == [] and model["/agents/interrupt"], model)
    r = a.send(ctx, data, {"row": "s1", "/agents/draft": "and again"})
    check("Send into a session mid-turn refuses", not r.ok and "still working" in r.line
          and len(e.writes) == 1, (r, e.writes))
    e.sessions["s1"]["status"] = "idle"
    data, _ = view(a, ctx)

    gate = threading.Event()
    e.hold["sessions.send"] = gate
    first = {}
    t = threading.Thread(target=lambda: first.setdefault("r", a.send(ctx, data, {"row": "s1",
                                                                                 "/agents/draft": "one"})))
    t.start()
    for _ in range(200):
        if ("send", "s1") in a._inflight and any(m == "sessions.send" for m, _, _ in e.calls[-1:]):
            break
        threading.Event().wait(0.01)
    second = a.send(ctx, data, {"row": "s1", "/agents/draft": "one"})
    gate.set()
    t.join(5)
    del e.hold["sessions.send"]
    check("a second Send while the first is in flight refuses", not second.ok and "Still sending" in second.line,
          second)
    check("and only the first reached the engine", sum(m == "sessions.send" for m, _ in e.writes) == 2,
          e.writes)
    e.sessions["s1"]["status"] = "idle"
    data, _ = view(a, ctx)

    def applied_then_dropped():
        e.event("s1", "user_message", {"text": "maybe", "attachments": []})
        err = rc.RealmTimeout("sessions.send was sent but not answered in time")
        err.maybe_applied = True
        return err

    e.fail["sessions.send"] = applied_then_dropped
    before = len(e.writes)
    r = a.send(ctx, data, {"row": "s1", "/agents/draft": "maybe"})
    check("a maybe_applied send says it may have sent", not r.ok and "may have sent" in r.line, r)
    check("and is not retried", len(e.writes) == before + 1, e.writes[before:])
    check("and keeps the draft", "/agents/draft" not in r.updates, r.updates)
    del e.fail["sessions.send"]
    r = a.send(ctx, data, {"row": "s1", "/agents/draft": "maybe"})
    check("pressing again once it shows in the transcript refuses, and sends nothing",
          not r.ok and "already arrived" in r.line and len(e.writes) == before + 1, (r, e.writes[before:]))
    e.fail["sessions.send"] = rc.RealmRpcError("sessions.send", "SESSION_NOT_FOUND", "gone")
    r = a.send(ctx, data, {"row": "s1", "/agents/draft": "x"})
    check("an engine refusal says not sent", not r.ok and r.line.startswith("Not sent"), r)
    del e.fail["sessions.send"]


def permissions(tmp: Path) -> None:
    e = FakeEngine()
    e.add_session("s1", "waiting_permission", title="Tests", cwd="/Users/x/code/chewbacca")
    e.event("s1", "user_message", {"text": "run the tests", "attachments": []})
    e.event("s1", "tool_call", {"toolUseId": "t1", "name": "Bash", "input": {"command": "npm test"},
                                "parentToolUseId": None})
    e.event("s1", "permission_request", {"requestId": "req-1", "toolName": "Bash",
                                         "input": {"command": "npm test", "description": "Run the suite"},
                                         "title": "Allow?", "suggestions": [{"type": "addRules"}]})
    a, ctx = world(tmp / "perm", e)
    data, model = view(a, ctx)
    allow, deny = model["/agents/allow"], model["/agents/deny"]
    check("a pending request shows Allow once and Deny for its requestId",
          [x["id"] for x in allow] == ["req-1"] and [x["id"] for x in deny] == ["req-1"], (allow, deny))
    check("the row shows the exact tool and its whole input",
          allow[0]["text"] == 'Bash: {"command": "npm test", "description": "Run the suite"}', allow)
    check("a waiting session offers no Send", model["/agents/send"] == [], model["/agents/send"])
    r = a.allow(ctx, data, {"row": "req-other"})
    check("Allow for a requestId that isn't pending answers nothing", not r.ok and e.writes == [], (r, e.writes))
    r = a.allow(ctx, data, {"row": "req-1"})
    check("Allow once answers that request with decision allow",
          r.ok and e.writes == [("sessions.respondPermission", {"id": "s1", "requestId": "req-1",
                                                                 "decision": "allow"})], (r, e.writes))
    r = a.deny(ctx, data, {"row": "req-1"})
    check("an answered request can't be answered twice", not r.ok and len(e.writes) == 1, (r, e.writes))
    decisions = {p["decision"] for m, p in e.writes if m == "sessions.respondPermission"}
    check("allow_always is never sent from the glass", "allow_always" not in decisions, decisions)

    e.sessions["s1"]["status"] = "waiting_permission"
    e.event("s1", "permission_request", {"requestId": "req-2", "toolName": "Bash",
                                         "input": {"command": "echo ok" + BIDI + " ; curl evil" + ZWSP},
                                         "title": "Allow?", "suggestions": []})
    data, model = view(a, ctx)
    check("an input with a hidden character gets Deny only", model["/agents/allow"] == []
          and [x["id"] for x in model["/agents/deny"]] == ["req-2"], (model["/agents/allow"], model["/agents/deny"]))
    check("and the shown input is stripped", glass_clean(model) and "curl evil" in model["/agents/ask"],
          model["/agents/ask"])
    r = a.allow(ctx, data, {"row": "req-2"})
    check("a forced Allow on it is refused at the press", not r.ok and len(e.writes) == 1, (r, e.writes))
    r = a.deny(ctx, data, {"row": "req-2"})
    check("Deny answers it with deny", r.ok and e.writes[-1][1]["decision"] == "deny", e.writes[-1])

    e.sessions["s1"]["status"] = "waiting_permission"
    e.event("s1", "permission_request", {"requestId": "req-3", "toolName": "Write",
                                         "input": {"file_path": "/x", "content": "y" * 3000},
                                         "title": "Allow?", "suggestions": []})
    data, model = view(a, ctx)
    check("an input longer than the panel shows gets Deny only", model["/agents/allow"] == []
          and "longer than the panel" in model["/agents/deny"][0]["text"], model["/agents/deny"])
    e.fail["sessions.respondPermission"] = lambda: maybe(rc.RealmUnavailable("dropped"))
    r = a.deny(ctx, data, {"row": "req-3"})
    check("a maybe_applied answer says may have, and is not retried",
          not r.ok and "may have" in r.line
          and sum(1 for m, p, _ in e.calls if m == "sessions.respondPermission" and p["requestId"] == "req-3") == 1,
          r)


def interrupt_and_fork(tmp: Path) -> None:
    e = FakeEngine()
    e.add_session("s1", "running", title="Work", cwd="/Users/x/code/chewbacca")
    e.checkpoints.append({"id": "cp-1", "environmentId": "env-s1", "sessionId": "s1", "kind": "turn"})
    a, ctx = world(tmp / "verbs", e)
    data, model = view(a, ctx)
    check("a working session offers Interrupt, saying what it keeps",
          model["/agents/interrupt"][0]["id"] == "s1" and "stays changed" in model["/agents/interrupt"][0]["text"],
          model["/agents/interrupt"])
    check("Fork is not offered mid-turn", model["/agents/fork"] == [], model["/agents/fork"])
    r = a.interrupt(ctx, data, {"row": "s1"})
    check("Interrupt calls sessions.interrupt on the pin",
          r.ok and e.writes == [("sessions.interrupt", {"id": "s1"})], (r, e.writes))
    r = a.interrupt(ctx, data, {"row": "s1"})
    check("Interrupt on an idle session refuses", not r.ok and len(e.writes) == 1, r)
    data, model = view(a, ctx)
    check("an idle session with a checkpoint offers Fork, saying the original is untouched",
          model["/agents/fork"][0]["id"] == "s1" and "untouched" in model["/agents/fork"][0]["text"],
          model["/agents/fork"])
    r = a.fork(ctx, data, {"row": "s1"})
    check("Fork forks the newest checkpoint and opens the new session",
          r.ok and e.writes[-1] == ("sessions.fork", {"checkpointId": "cp-1"}) and a.pinned.startswith("s-fork"),
          (r, e.writes, a.pinned))
    e2 = FakeEngine()
    e2.add_session("s9", "idle")
    b, bctx = world(tmp / "nofork", e2)
    bdata, bmodel = view(b, bctx)
    check("no checkpoint, no Fork", bmodel["/agents/fork"] == [], bmodel["/agents/fork"])


def new_sessions(tmp: Path) -> None:
    e = FakeEngine()
    a, ctx = world(tmp / "new", e)
    code = Path(ctx.env["KYBER_CODE_ROOT"]).resolve()
    stranger = tmp / "elsewhere" / "proj"
    stranger.mkdir(parents=True)
    e.add_session("s-old", "idle", cwd=str(stranger), title="Old")
    data, model = view(a, ctx)
    labels = model["/agents/folders"]
    check("the Select lists git repos under the code root and recent session folders",
          "~/code/chewbacca" in labels and "~/code/amber/amber-id" in labels
          and any(x.endswith("elsewhere/proj") for x in labels), labels)
    check("recent session folders come first", labels[0].endswith("elsewhere/proj"), labels)
    check("nothing picked, no Start", model["/agents/new"] == [], model["/agents/new"])
    model = a.model(data, None, {"/agents/folder": "~/code/chewbacca"}, ctx)
    check("a picked folder offers Start, saying what it makes", model["/agents/new"][0]["id"] == "~/code/chewbacca"
          and "makes one" in model["/agents/new"][0]["text"]
          and "a folder of its own" in model["/agents/new"][0]["text"], model["/agents/new"])
    r = a.new(ctx, data, {"row": "~/code/chewbacca", "/agents/folder": "~/code/amber/amber-id"})
    check("Start for a folder that isn't the one picked refuses", not r.ok and e.writes == [], r)
    r = a.new(ctx, data, {"row": "/etc", "/agents/folder": "/etc"})
    check("a folder that isn't on the list is never used", not r.ok and e.writes == [], r)
    r = a.new(ctx, data, {"row": "~/code/chewbacca", "/agents/folder": "~/code/chewbacca"})
    made = [m for m, _ in e.writes]
    check("Start makes a space, a project at that folder, then a claude session that asks first",
          r.ok and made == ["spaces.create", "projects.create", "sessions.create"]
          and e.writes[1][1]["rootPath"] == str(code / "chewbacca")
          and e.writes[2][1]["agentKind"] == "claude" and e.writes[2][1]["permissionMode"] == "default",
          (r, e.writes))
    check("the new session is pinned", a.pinned.startswith("s-new"), a.pinned)
    data, _ = view(a, ctx)
    r = a.new(ctx, data, {"row": "~/code/chewbacca", "/agents/folder": "~/code/chewbacca"})
    check("a second session in the same folder reuses its space and project",
          r.ok and [m for m, _ in e.writes[3:]] == ["sessions.create"], e.writes[3:])

    e.fail["sessions.create"] = lambda: maybe(rc.RealmTimeout("t"))
    data, _ = view(a, ctx)
    r = a.new(ctx, data, {"row": "~/code/amber/amber-id", "/agents/folder": "~/code/amber/amber-id"})
    check("a maybe_applied create says it may have half run and names what was made",
          not r.ok and "may have half run" in r.line and "a space" in r.line and "a project" in r.line, r)
    e.profiles.clear()
    del e.fail["sessions.create"]
    (code / "kits" / "new-kit" / ".git").mkdir(parents=True)
    data, _ = view(a, ctx)
    r = a.new(ctx, data, {"row": "~/code/kits/new-kit", "/agents/folder": "~/code/kits/new-kit"})
    check("a fresh engine with no profile gets one before the space", r.ok and "profiles.create" in
          [m for m, _ in e.writes], e.writes)


def untrusted(tmp: Path) -> None:
    e = FakeEngine()
    e.add_session("s1", "idle", title="T" + BIDI + "itle" + LINE_SEP + "x" + ESC + "[31m",
                  cwd="/Users/x/code/ch" + ZWSP + "ew\u3164")
    e.event("s1", "user_message", {"text": "hi⁦there", "attachments": [],
                                   "from": {"sessionId": "s0", "title": "Boss" + BIDI}})
    e.event("s1", "assistant_text", {"messageId": "m", "text": "line one\nline two" + "\x7f" + LINE_SEP + "\ufe0f"})
    e.event("s1", "tool_call", {"toolUseId": "t", "name": "Bash" + BIDI,
                                "input": {"command": "rm -rf ~ " + ZWSP}, "parentToolUseId": None})
    e.event("s1", "tool_result", {"toolUseId": "t", "content": "denied" + BIDI + "\nmore", "isError": True})
    e.event("s1", "error", {"message": "boom" + LINE_SEP + "forged line"})
    a, ctx = world(tmp / "untrusted", e)
    data, model = view(a, ctx)
    check("no hidden character from the engine reaches any pointer", glass_clean(model), model)
    lines = [surfaces.data_line(k, v) for k, v in model.items()]
    check("every d line is one line", all("\n" not in x and "\r" not in x and LINE_SEP not in x for x in lines))
    texts = [i["text"] for i in model["/agents/transcript"]]
    check("another session's message says it came from that session", texts[0].startswith("From session Boss"),
          texts)
    check("a turn keeps its own line breaks", "line one\nline two" in texts[1], texts[1])
    check("a tool call is one line naming what it touched", texts[2] == "Bash: rm -rf ~", texts[2])


def through_the_daemon(tmp: Path) -> None:
    e = FakeEngine()
    e.add_session("s1", "idle", title="Rail" + BIDI, cwd="/Users/x/code/chewbacca")
    a, ctx = world(tmp / "daemon", e)
    kinds = surfaces.KINDS
    hud = tks.FakeHud()
    d = tks.ks.Daemon(hud, ctx=ctx, state_path=tmp / "state.json", activity_path=tmp / "activity.jsonl",
                      badges_path=tmp / "badges.json", spaces={}, clock=lambda: 0.0, spawn=lambda fn: fn(),
                      ingest=lambda c: {}, make=lambda kind, arg="": a if kind == "agents" else surfaces.make(kind, arg))
    try:
        d.open_surface("agents")
        drawn = hud.take()
        check("the daemon draws it valid", not tks.validate(drawn), tks.validate(drawn))
        check("the daemon's lines carry no hidden character", not any(h in x for x in drawn for h in HIDDEN))
        d.handle_line('v /agents/draft "say hi in one word"')
        d.handle_line('e action ks-send row="s1" surface="agents"')
        lines = hud.take()
        check("Send over the socket posts to the row's session",
              e.writes == [("sessions.send", {"id": "s1", "text": "say hi in one word"})], e.writes)
        check("and the draft clears on the glass", 'd /agents/draft ""' in lines, lines)
        activity = (tmp / "activity.jsonl").read_text()
        check("the activity log has the press and never the message or title",
              '"action": "send"' in activity and "say hi" not in activity and "Rail" not in activity, activity)
    finally:
        surfaces.KINDS = kinds


def review_fixes(tmp: Path) -> None:
    """Each check here is one finding of the 2026-10-05 review."""
    e = FakeEngine()
    e.add_session("s1", "idle", title="Rail", cwd="/Users/x/code/chewbacca")
    a, ctx = world(tmp / "review", e)
    data, model = view(a, ctx)
    stale = a.model(data, "The engine stopped answering: the engine isn't reachable", {}, ctx)
    check("a failed refresh keeps the rows but offers no verb on them",
          stale["/agents/rows"] and all(stale[f"/agents/{v}"] == [] for v in SA.VERBS)
          and model["/agents/send"], {v: stale[f"/agents/{v}"] for v in SA.VERBS})

    gate = threading.Event()
    e.after["sessions.list"] = gate
    box = {}
    t = threading.Thread(target=lambda: box.setdefault("data", a.fetch(ctx)))
    t.start()
    for _ in range(200):
        if any(m == "sessions.list" for m, _, _ in e.calls[-2:]):
            break
        threading.Event().wait(0.01)
    model = a.model(data, None, {"/agents/folder": "~/code/amber/amber-id"}, ctx)
    r = a.new(ctx, data, {"row": "~/code/amber/amber-id", "/agents/folder": "~/code/amber/amber-id"})
    fresh_pin = a.pinned
    gate.set()
    t.join(5)
    del e.after["sessions.list"]
    check("a fetch that read the list before Start pinned the new session leaves the pin alone",
          r.ok and a.pinned == fresh_pin and fresh_pin.startswith("s-new") and not box["data"]["gone"],
          (r, a.pinned, box["data"]["gone"]))
    check("and the next fetch comes soon, since the daemon drops the press's refetch",
          a.refresh == SA.REFRESH_BUSY, a.refresh)
    data, model = view(a, ctx)
    check("which then shows the new session and slows back down",
          model["/agents/head"] == "New session" and a.refresh == SA.REFRESH_IDLE, (model["/agents/head"], a.refresh))
    a.pick(ctx, data, {"row": "s1"})
    r = a.pick(ctx, data, {"row": fresh_pin})
    check("opening another session clears the draft typed for the last one",
          r.updates.get("/agents/draft") == "", r.updates)

    long = FakeEngine()
    long.add_session("s-long", "waiting_permission", title="Long")
    long.event("s-long", "user_message", {"text": "yes", "attachments": []})
    for n in range(SA.EVENTS_PAGE * SA.EVENTS_PAGES + 200):
        long.event("s-long", "tool_call", {"toolUseId": f"t{n}", "name": "Read", "input": {"file_path": "/a"},
                                           "parentToolUseId": None})
    long.event("s-long", "permission_request", {"requestId": "req-late", "toolName": "Bash",
                                                "input": {"command": "ls"}, "title": "Allow?", "suggestions": []})
    b, bctx = world(tmp / "long", long)
    bdata, bmodel = view(b, bctx)
    check("a session longer than one fetch reads says it is catching up", "catching up" in bmodel["/agents/meta"],
          bmodel["/agents/meta"])
    r = b.deny(bctx, bdata, {"row": "req-late"})
    check("a press still finds the request at the end of a long session",
          r.ok and long.writes == [("sessions.respondPermission", {"id": "s-long", "requestId": "req-late",
                                                                    "decision": "deny"})], (r, long.writes))
    long.sessions["s-long"]["status"] = "idle"
    bdata, _ = view(b, bctx)
    r = b.send(bctx, bdata, {"row": "s-long", "/agents/draft": "yes"})
    check("an identical message from long ago doesn't count as this send landing",
          r.ok and long.writes[-1] == ("sessions.send", {"id": "s-long", "text": "yes"}), (r, long.writes[-1:]))

    half = FakeEngine()
    c, cctx = world(tmp / "half", half)
    cdata, _ = view(c, cctx)
    half.fail["projects.create"] = rc.RealmRpcError("projects.create", "INTERNAL", "disk full at /secret/path")
    r = c.new(cctx, cdata, {"row": "~/code/chewbacca", "/agents/folder": "~/code/chewbacca"})
    check("a refused step names its code and never the engine's own message",
          not r.ok and "INTERNAL" in r.line and "secret" not in r.line, r.line)
    del half.fail["projects.create"]
    cdata, _ = view(c, cctx)
    r = c.new(cctx, cdata, {"row": "~/code/chewbacca", "/agents/folder": "~/code/chewbacca"})
    made = [m for m, _ in half.writes]
    check("a second press after a half-made Start finishes it in the same space",
          r.ok and made.count("spaces.create") == 1 and made[-2:] == ["projects.create", "sessions.create"], made)

    d, dctx = world(tmp / "down2", None)
    ddata, _ = view(d, dctx)
    d.run_engine = lambda argv, env, timeout: (1, "", "npm ERR! postinstall printed this\n")
    r = d.start_engine(dctx, ddata, {"row": "start"})
    check("a start failing with someone else's output quotes none of it",
          not r.ok and r.line.endswith("exit 1") and "postinstall" not in r.line, r.line)

    view_text, exact = SA.permission_view("Bash", {"command": "ls\ufe0f"})
    check("a variation selector makes an input inexact", not exact and "\ufe0f" not in view_text, view_text)
    view_text, exact = SA.permission_view("Bash", {"command": "ls" + ESC + "[2J"})
    check("an escape is visible as JSON escapes it, so that input stays exact",
          exact and "\\u001b" in view_text, view_text)


def registry() -> None:
    check("agents is a registered kind", "agents" in surfaces.KINDS and isinstance(surfaces.make("agents"), Agents))
    check("vscode, claude and sessions open agents",
          all(surfaces.resolve(w) == "agents" for w in ("vscode", "claude", "sessions")))
    from surfaces import apps  # noqa: PLC0415
    check("agents is on the rail with a symbol", "agents" in apps.kinds() and "agents" in apps.SYMBOLS)


def main() -> int:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        down_state(tmp)
        listing_and_pin(tmp)
        sending(tmp)
        permissions(tmp)
        interrupt_and_fork(tmp)
        new_sessions(tmp)
        untrusted(tmp)
        through_the_daemon(tmp)
        review_fixes(tmp)
        registry()
    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
