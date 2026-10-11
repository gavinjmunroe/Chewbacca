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
# Avatar is in hud/CLAUDE.md "Lanes, avatars and the launcher rail" and
# Launcher.swift, outside the generated vocabulary list the checker reads.
tks.COMPONENTS.add("Avatar")
# Tiles and Chips: hud/CLAUDE.md "Agents as tiles", AgentTiles.swift.
tks.COMPONENTS.update({"Tiles", "Chips", "Diff"})
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
        self.imported_keys: set = set()
        self.diff = None
        # agents.probe's answer, shaped as on this Mac on 2026-10-10: Claude
        # and Gemini installed with sign-in unknown, Codex installed but not
        # runnable by the engine, Cursor absent.
        self.probe = [
            {"kind": "claude", "available": True, "version": "2.1.289", "loggedIn": None,
             "reason": "unknown (keychain)"},
            {"kind": "codex", "available": False, "version": None, "loggedIn": None,
             "reason": "Command failed: codex --version\n"},
            {"kind": "acp:cursor", "available": False, "version": None, "loggedIn": None,
             "reason": "spawn cursor-agent ENOENT"},
            {"kind": "acp:gemini", "available": True, "version": "0.46.0", "loggedIn": None,
             "reason": "unknown until a session starts"},
            {"kind": "fake", "available": True, "version": None, "loggedIn": True, "reason": None},
            {"kind": "BAD KIND" + BIDI, "available": True, "version": None, "loggedIn": True, "reason": None},
        ]

    def nid(self, prefix):
        self.n += 1
        return f"{prefix}{self.n}"

    def add_session(self, sid, status="idle", space="sp1", title="Fix the rail", cwd="/Users/x/code/chewbacca",
                    updated=NOW_MS, mode="default", kind="claude"):
        self.sessions[sid] = {"id": sid, "spaceId": space, "projectId": None, "agentKind": kind,
                              "permissionMode": mode, "environmentId": f"env-{sid}", "cwd": cwd, "status": status,
                              "title": title, "updatedAt": updated, "createdAt": updated}

    def event(self, sid, kind, payload):
        self.seq += 1
        self.events.append({"seq": self.seq, "sessionId": sid, "event": {"type": kind, "ts": NOW_MS,
                                                                          "payload": payload}})
        return self.seq

    @property
    def writes(self):
        # The probe runs CLIs (EXEC_METHODS) but changes no state.
        return [(m, p) for m, p, w in self.calls if m not in rc.READ_METHODS and m not in rc.EXEC_METHODS]

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
        if method == "workspace.diff":
            return self.diff
        if method == "workspace.fileDiff":
            return {"path": p["path"], "oldPath": None, "staged": False, "binary": False, "truncated": False,
                    "truncatedReason": None, "additions": 1, "deletions": 1, "hunks": [
                        {"header": "def rail():", "oldStart": 1, "oldLines": 2, "newStart": 1, "newLines": 2,
                         "lines": [{"kind": "context", "text": "    keep = 1", "oldLine": 1, "newLine": 1},
                                   {"kind": "del", "text": "    old" + BIDI, "oldLine": 2, "newLine": None},
                                   {"kind": "add", "text": "    new", "oldLine": None, "newLine": 2}]}]}
        if method == "agents.probe":
            return [dict(x) for x in self.probe]
        if method == "import.apply":
            out = []
            for sel in p["sessions"]:
                if sel["key"] in self.imported_keys:
                    out.append({"key": sel["key"], "state": "skipped", "refId": None, "detail": "already imported"})
                    continue
                if not sel["key"].startswith("/scanned/"):
                    out.append({"key": sel["key"], "state": "skipped", "refId": None, "detail": "no longer on disk"})
                    continue
                self.imported_keys.add(sel["key"])
                sid = self.nid("s-imp")
                self.add_session(sid, title="Imported " + sel["key"].rsplit("/", 1)[-1])
                out.append({"key": sel["key"], "state": "imported", "refId": sid, "detail": "imported"})
            return {"sessions": out, "memories": [], "skills": [], "spacesCreated": []}
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
                             mode=p["permissionMode"], kind=p["agentKind"])
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
    # The probe's thread runs inline, so a fetch's answer already holds it.
    a.spawn = lambda fn: fn()
    a.tabs = lambda now: []
    a.wall = lambda: NOW_MS / 1000 + 120
    if engine is None:
        def refuse(_ctx):
            raise rc.RealmUnavailable(f"engine not started ({tmp}/realm-home/engine.json missing); "
                                      "run realm-engine start")
        a.connect = refuse
    else:
        a.connect = lambda _ctx: FakeConn(engine)
    return a, ctx


def view(a, ctx, values=None, open=None):
    data = a.fetch(ctx)
    if open and a.pinned != open:
        # Nothing is opened until a tile is pressed: press it, as Caleb would.
        a.pick(ctx, data, {"row": open})
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



def tile_ids(model) -> list[str]:
    return [t["id"] for t in model["/agents/tiles"]]


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
    ids = tile_ids(model)
    check("what needs you first: waiting, then working, then done", ids == ["s-wait", "s-work", "s-idle"], ids)
    check("the counts say what to do", model["/agents/counts"] == {"needs": 1, "running": 1, "done": 1}
          and model["/agents/note"] == "", (model["/agents/counts"], model["/agents/note"]))
    check("each tile says its state as a word the renderer reads",
          [t["state"] for t in model["/agents/tiles"]] == ["needs", "running", "done"])
    check("nothing is opened until a tile is pressed, so the glass shows agents, not a form",
          a.pinned == "" and model["/agents/head"] == "" and "agents-draft" not in " ".join(a.layout()), a.pinned)
    check("titles reach the glass stripped", glass_clean(model), model["/agents/tiles"])

    r = a.pick(ctx, data, {"row": "s-idle"})
    check("Open pins a session", r.ok and a.pinned == "s-idle", (r, a.pinned))
    e.sessions["s-idle"]["status"] = "running"
    e.sessions["s-work"]["status"] = "idle"
    data, model = view(a, ctx)
    check("a re-sort does not move the pin", a.pinned == "s-idle"
          and model["/agents/interrupt"][0]["id"] == "s-idle"
          and next(t for t in model["/agents/tiles"] if t["id"] == "s-idle")["selected"], a.pinned)
    check("and the open agent's conversation is drawn under the tiles",
          "agents-transcript" in a.layout()[-2] and a.layout()[-2].index("agents-tiles")
          < a.layout()[-2].index("agents-transcript"), a.layout()[-2])
    e.sessions["s-idle"]["status"] = "idle"
    data, model = view(a, ctx)
    check("Send's row is the pinned session and says it can't be unsent",
          model["/agents/send"][0]["id"] == "s-idle" and "can't be unsent" in model["/agents/send"][0]["text"],
          model["/agents/send"])
    check("an idle session offers no Stop", model["/agents/interrupt"] == [], model["/agents/interrupt"])
    check("reading the panel wrote nothing", e.writes == [], e.writes)
    del e.sessions["s-idle"]
    data, model = view(a, ctx)
    check("a pinned session that disappears is named, and nothing is opened in its place",
          "gone from the engine" in model["/agents/note"] and a.pinned == "", (model["/agents/note"], a.pinned))


def sending(tmp: Path) -> None:
    e = FakeEngine()
    e.add_session("s1", "idle", title="Rail", cwd="/Users/x/code/chewbacca")
    e.add_session("s2", "idle", title="Other", cwd="/Users/x/code/amber/amber-id", updated=NOW_MS - 1)
    a, ctx = world(tmp / "send", e)
    data, model = view(a, ctx, open="s1")
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
    data, model = view(a, ctx, open="s1")
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
    data, model = view(a, ctx, open="s1")
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
    bdata, bmodel = view(b, bctx, open="s9")
    check("no checkpoint, no Fork", bmodel["/agents/fork"] == [], bmodel["/agents/fork"])



def start(a, data, ctx, task="", agent="claude", want=""):
    """What a Start press carries: the row drawn for that task, and the values."""
    values = {"/agents/task": task, "/agents/agent": agent, "/agents/want": want}
    model = a.model(data, None, values, ctx)
    row = model["/agents/new"][0]["id"] if model["/agents/new"] else ""
    return a.new(ctx, data, {"row": row, **values}), model


def new_sessions(tmp: Path) -> None:
    e = FakeEngine()
    a, ctx = world(tmp / "new", e)
    code = Path(ctx.env["KYBER_CODE_ROOT"]).resolve()
    stranger = tmp / "elsewhere" / "proj"
    stranger.mkdir(parents=True)
    e.add_session("s-old", "idle", cwd=str(stranger), title="Old")
    data, model = view(a, ctx)
    check("starting is chips, one field and one press", "agents-kinds Chips" in " ".join(a.layout())
          and "agents-task Field" in " ".join(a.layout()) and "Select" not in " ".join(a.layout()))
    row = model["/agents/new"][0]
    check("with nothing typed, Start names the agent and the folder worked in last",
          row["text"] == "Claude in proj" and row["id"].startswith("claude|") and e.writes == [], row)
    model = a.model(data, None, {"/agents/task": "in chewbacca: fix the rail"}, ctx)
    check("a task that starts in <folder>: runs there", model["/agents/new"][0]["text"] == "Claude in chewbacca",
          model["/agents/new"])
    r = a.new(ctx, data, {"row": model["/agents/new"][0]["id"], "/agents/task": "in chewbacca: fix the nav",
                          "/agents/agent": "claude"})
    check("a press whose message changed since it was drawn runs nothing", not r.ok and e.writes == [], r)
    r = a.new(ctx, data, {"row": "claude|/etc|0000000000", "/agents/task": "", "/agents/agent": "claude"})
    check("a folder that isn't on the list is never used", not r.ok and e.writes == [], r)
    r, _ = start(a, data, ctx, "x", agent="codex")
    check("an agent the engine can't run is never started", not r.ok and e.writes == [], r)
    r, _ = start(a, data, ctx, "in chewbacca: fix the rail")
    made = [m for m, _ in e.writes]
    check("Start makes a space, a project at that folder, a claude session that asks first, and sends the task",
          r.ok and made == ["spaces.create", "projects.create", "sessions.create", "sessions.send"]
          and e.writes[1][1]["rootPath"] == str(code / "chewbacca")
          and e.writes[2][1]["agentKind"] == "claude" and e.writes[2][1]["permissionMode"] == "default"
          and e.writes[3][1]["text"] == "fix the rail", (r, e.writes))
    check("the new agent is opened and the box cleared", a.pinned.startswith("s-new")
          and r.updates.get("/agents/task") == "", (a.pinned, r.updates))
    data, _ = view(a, ctx)
    r, _ = start(a, data, ctx, "in chewbacca:")
    check("a second agent in the same folder reuses its space and project, and an empty task sends nothing",
          r.ok and [m for m, _ in e.writes[4:]] == ["sessions.create"], e.writes[4:])
    r, _ = start(a, data, ctx, "summarize the week", want="amber-id")
    check("a folder a sentence asked for is used", r.ok and e.writes[-3][0] == "projects.create"
          and e.writes[-3][1]["rootPath"].endswith("amber/amber-id"), e.writes[-3:])

    e.fail["sessions.create"] = lambda: maybe(rc.RealmTimeout("t"))
    (code / "kits" / "new-kit" / ".git").mkdir(parents=True)
    data, _ = view(a, ctx)
    r, _ = start(a, data, ctx, "in new-kit: go")
    check("a maybe_applied create says it may have half run and names what was made",
          not r.ok and "may have half run" in r.line and "a space" in r.line and "a project" in r.line, r)
    e.profiles.clear()
    del e.fail["sessions.create"]
    (code / "kits" / "other-kit" / ".git").mkdir(parents=True)
    data, _ = view(a, ctx)
    r, _ = start(a, data, ctx, "in other-kit: go")
    check("a fresh engine with no profile gets one before the space", r.ok and "profiles.create" in
          [m for m, _ in e.writes], e.writes)



def any_agent(tmp: Path) -> None:
    """Start offers what the engine reports as installed, never a hardcoded Claude."""
    e = FakeEngine()
    a, ctx = world(tmp / "any", e)
    clock = [1000.0]
    a.clock = lambda: clock[0]
    data, model = view(a, ctx)
    check("the chips are the ready agents, in the engine's order",
          model["/agents/kinds"] == [{"id": "claude", "label": "Claude"}, {"id": "acp:gemini", "label": "Gemini"}],
          model["/agents/kinds"])
    check("with nothing picked, the first ready agent is picked", model.get("/agents/agent") == "claude")
    check("an agent that isn't installed, or won't run, is never listed",
          "Cursor" not in json.dumps(model) and "Codex" not in json.dumps(model)
          and "Fake" not in json.dumps(model) and "BAD" not in json.dumps(model) and glass_clean(model))
    probes = [w for m, _, w in e.calls if m == "agents.probe"]
    check("the probe is a read, never sent as a write", probes == [False], probes)
    view(a, ctx)
    check("a second fetch inside PROBE_EVERY does not probe again",
          sum(m == "agents.probe" for m, _, _ in e.calls) == 1, e.calls)
    clock[0] += SA.PROBE_EVERY
    view(a, ctx)
    check("and one after it does", sum(m == "agents.probe" for m, _, _ in e.calls) == 2)

    r = a.choose(ctx, data, {"row": "acp:gemini"})
    check("a chip press picks the agent", r.ok and r.updates == {"/agents/agent": "acp:gemini"}, r)
    check("a chip for an agent that isn't there picks nothing", not a.choose(ctx, data, {"row": "acp:cursor"}).ok)
    r, model = start(a, data, ctx, "in chewbacca: tidy the docs", agent="acp:gemini")
    created = [p for m, p in e.writes if m == "sessions.create"]
    check("Start makes a session of the picked agent", r.ok and created and created[-1]["agentKind"] == "acp:gemini"
          and "Gemini" in r.line and model["/agents/new"][0]["text"] == "Gemini in chewbacca", (r, created))
    data, model = view(a, ctx)
    check("the open agent's header names its agent and claims no asking it can't promise",
          model["/agents/meta"].startswith("Gemini · ") and model["/agents/meta"].endswith("decides when it asks"),
          model["/agents/meta"])
    tile = next(t for t in model["/agents/tiles"] if t["id"] == a.pinned)
    check("its tile carries the provider, so the renderer draws Gemini's mark",
          tile["provider"] == "acp:gemini" and tile["name"] == "Gemini" and tile["selected"], tile)

    e.probe[0]["loggedIn"] = False
    clock[0] += SA.PROBE_EVERY
    data, model = view(a, ctx)
    check("an agent the engine reports signed out is not offered",
          [k["id"] for k in model["/agents/kinds"]] == ["acp:gemini"], model["/agents/kinds"])
    model = a.model(data, None, {"/agents/agent": "claude"}, ctx)
    check("a pick that stopped being ready moves to one that is", model["/agents/agent"] == "acp:gemini")
    e.probe = []
    clock[0] += SA.PROBE_EVERY
    data, model = view(a, ctx)
    check("no ready agent: no chips and no Start", model["/agents/new"] == [] and model["/agents/kinds"] == []
          and "agents-task" not in " ".join(a.layout()))


def live_tabs_and_import(tmp: Path) -> None:
    """Open Claude Code and Codex tabs are tiles at once, come into the engine
    with no press, and keep their live state once they're in."""
    e = FakeEngine()
    a, ctx = world(tmp / "tabs", e)
    now = NOW_MS / 1000 + 120
    tabs = [
        {"id": "tab-wait", "agent": "claude", "transcript": "/scanned/tab-wait.jsonl", "title": "Fix the HUD rail glass",
         "state": "needs", "ask": "Bash: npm test", "detail": "", "project": "chewbacca", "last": now - 30,
         "open_in": "VS Code"},
        {"id": "tab-run", "agent": "codex", "transcript": "/scanned/tab-run.jsonl", "title": "Port the importer",
         "state": "working", "ask": "", "detail": "Edit: realm.py", "project": "realm", "last": now - 5},
        {"id": "tab-old", "agent": "claude", "transcript": "/scanned/tab-old.jsonl", "title": "Yesterday",
         "state": "finished", "ask": "", "detail": "", "project": "x", "last": now - 6 * 3600},
    ]
    a.tabs = lambda t: [dict(x) for x in tabs]
    clock = [5000.0]
    a.clock = lambda: clock[0]
    data, model = view(a, ctx)
    check("live tabs are tiles before they're in the engine, needs-you first",
          tile_ids(model)[:2] == ["tab:tab-wait", "tab:tab-run"], tile_ids(model))
    first = model["/agents/tiles"][0]
    check("a tab's tile says what it's waiting on, where, and where it's open",
          first["detail"] == "Bash: npm test" and first["meta"] == "chewbacca · now · VS Code"
          and first["provider"] == "claude" and model["/agents/tiles"][1]["provider"] == "codex", first)
    applied = [p for m, p in e.writes if m == "import.apply"]
    check("recent tabs come in silently, in one batch, to the profile's catch-all space, never asking",
          len(applied) == 1 and [x["key"] for x in applied[0]["sessions"]] ==
          ["/scanned/tab-wait.jsonl", "/scanned/tab-run.jsonl"]
          and all(x["profileId"] == "prof1" and x["spaceId"] is None for x in applied[0]["sessions"]), applied)
    check("a tab older than the import window stays out", "tab-old" not in json.dumps(applied))
    for sid, (_, tab) in zip(("s-imp1", "s-imp2"), [(0, tabs[0]), (1, tabs[1])]):
        pass
    for s in e.sessions.values():
        s["providerSessionId"] = "tab-wait" if "tab-wait" in s["title"] else "tab-run"
    data, model = view(a, ctx)
    check("once in, a tile is the engine's session with the tab's live state",
          model["/agents/tiles"][0]["id"].startswith("s-imp") and model["/agents/tiles"][0]["state"] == "needs"
          and model["/agents/tiles"][0]["detail"] == "Bash: npm test" and len(model["/agents/tiles"]) == 2,
          model["/agents/tiles"])
    clock[0] += SA.IMPORT_EVERY
    view(a, ctx)
    check("nothing comes in twice", sum(m == "import.apply" for m, _ in e.writes) == 1, e.writes)
    r = a.pick(ctx, data, {"row": "tab:tab-old"})
    check("a tab tile not in the engine yet says so on Open and writes nothing", not r.ok and
          sum(m == "import.apply" for m, _ in e.writes) == 1, r)

    b, bctx = world(tmp / "tabsfail", FakeEngine())
    b.tabs = lambda t: [dict(tabs[0])]
    b.engine = None
    eng = FakeEngine()
    eng.fail["import.apply"] = rc.RealmRpcError("import.apply", "INTERNAL", "x")
    b.connect = lambda _c: FakeConn(eng)
    tclock = [100.0]
    b.clock = lambda: tclock[0]
    view(b, bctx)
    tclock[0] += SA.IMPORT_EVERY
    view(b, bctx)
    check("an import the engine refused is tried again on the next pass",
          sum(m == "import.apply" for m, _, _ in eng.calls) == 2, eng.calls)
    c, cctx = world(tmp / "tabsbroken", FakeEngine())
    c.tabs = lambda t: (_ for _ in ()).throw(OSError("unreadable"))
    cdata, cmodel = view(c, cctx)
    check("tabs that can't be read draw no tiles and break nothing", cmodel["/agents/note"] == "No agents running.",
          cmodel["/agents/note"])
    check("an empty glass is one short line", cmodel["/agents/tiles"] == [] and "agents-tiles" not in
          " ".join(c.layout()))


def agent_card(tmp: Path) -> None:
    """Open on a tile draws its card: conversation, reply, and what it changed, with one file's diff."""
    e = FakeEngine()
    e.add_session("s1", "idle", title="Fix the rail", cwd=str(tmp / "card" / "repo"))
    e.event("s1", "user_message", {"text": "fix the rail", "attachments": []})
    e.event("s1", "assistant_text", {"messageId": "m", "text": "Done."})
    e.diff = {"root": "/r", "branch": "main", "totalFiles": 2, "truncated": False, "files": [
        {"path": "hud/Glass.swift", "oldPath": None, "status": "modified", "staged": False, "unstaged": True,
         "binary": False, "additions": 3, "deletions": 1},
        {"path": "evil" + BIDI + ".txt", "oldPath": None, "status": "added", "staged": False, "unstaged": True,
         "binary": False, "additions": 1, "deletions": 0}]}
    a, ctx = world(tmp / "card", e)
    data, model = view(a, ctx)
    check("a closed card reads no diff", not any(m == "workspace.diff" for m, _, _ in e.calls))
    data, model = view(a, ctx, open="s1")
    check("an open card lists what the agent changed, as a read",
          [x["id"] for x in model["/agents/changed"]] == ["hud/Glass.swift"]
          and model["/agents/changed"][0]["time"] == "modified · +3 -1"
          and model["/agents/changedCap"] == "Changed, 2 files on main"
          and all(not w for m, _, w in e.calls if m == "workspace.diff"), model["/agents/changed"])
    order = a.layout()[-2]
    check("the card is conversation, reply, then changes, all under the tiles",
          order.index("agents-tiles") < order.index("agents-transcript") < order.index("agents-draft")
          < order.index("agents-changed"), order)
    r = a.show_file(ctx, data, {"row": "hud/Glass.swift"})
    data, model = view(a, ctx)
    check("Diff on a file draws its patch on the card, indentation kept and hidden characters gone",
          r.ok and model["/agents/patch"].splitlines() == ["@@ -1,2 +1,2 @@ def rail():", "     keep = 1",
                                                          "-    old", "+    new"]
          and model["/agents/patchPath"] == "hud/Glass.swift" and "agents-patch Diff" in " ".join(a.layout()),
          model["/agents/patch"])
    r = a.show_file(ctx, data, {"row": "/etc/passwd"})
    check("a file not in its changes is never read", not r.ok and sum(m == "workspace.fileDiff" for m, _, _ in e.calls)
          == 1, r)
    check("reading the card wrote nothing", e.writes == [], e.writes)


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
    data, model = view(a, ctx, open="s1")
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
        a.pick(ctx, a.fetch(ctx), {"row": "s1"})
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
    data, model = view(a, ctx, open="s1")
    stale = a.model(data, "The engine stopped answering: the engine isn't reachable", {}, ctx)
    check("a failed refresh keeps the rows but offers no verb on them",
          stale["/agents/tiles"] and all(stale[f"/agents/{v}"] == [] for v in SA.VERBS)
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
    r, _ = start(a, data, ctx, "in amber-id:")
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
    bdata, bmodel = view(b, bctx, open="s-long")
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
    r, _ = start(c, cdata, cctx, "in chewbacca:")
    check("a refused step names its code and never the engine's own message",
          not r.ok and "INTERNAL" in r.line and "secret" not in r.line, r.line)
    del half.fail["projects.create"]
    cdata, _ = view(c, cctx)
    r, _ = start(c, cdata, cctx, "in chewbacca:")
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
        any_agent(tmp)
        live_tabs_and_import(tmp)
        agent_card(tmp)
        untrusted(tmp)
        through_the_daemon(tmp)
        review_fixes(tmp)
        registry()
    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
