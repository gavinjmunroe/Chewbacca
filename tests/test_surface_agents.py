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
import os
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
tks.COMPONENTS.update({"Tiles", "Chips", "Diff", "Web", "Hits", "File"})
BIDI = "‮"
LINE_SEP = " "
ZWSP = "​"
ESC = "\x1b"
HIDDEN = (BIDI, LINE_SEP, ZWSP, "\u2066", "\x7f", ESC, "\ufe0f", "\u3164")
NOW_MS = 1_790_000_000_000

failed = 0



def drawn_order(a) -> str:
    """The root's children in drawing order, with the card's own children
    standing where the card is (the card is a `from=` Stack since 2026-10-11)."""
    lines = a.layout()
    root = lines[-2]
    card = next((ln for ln in lines if ln.startswith("> agents-card ")), "")
    return root.replace(" agents-card", " " + card.removeprefix("> agents-card ")) if card else root

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
        self.upstream = True
        # Transcript keys import.scan finds on disk.
        self.disk: list = []
        self.items: list = []
        self.browsers: dict = {}
        # terminal id -> {run, out, programs}: realm's scrollback ring, as one string.
        self.term: dict = {}
        # project.files answers from these repo paths; project.grep from
        # (path, line, the line's text).
        self.files: list = []
        self.code: list = []
        self.ships: list = []
        # The space's other records (review, runs, schedules, MCP, memory),
        # absent until a test sets them.
        self.review = None
        self.runs: list = []
        self.schedules: list = []
        self.mcp: list = []
        self.memory_path = ""
        # checkpoint id -> what checkpoints.preview answers; restored ids.
        self.previews: dict = {}
        self.restored: list = []
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
        self.sessions[sid] = {"id": sid, "spaceId": space, "projectId": None, "agentKind": kind, "terminalItemId": None,
                              "permissionMode": mode, "environmentId": f"env-{sid}", "cwd": cwd, "status": status,
                              "title": title, "updatedAt": updated, "createdAt": updated}

    def event(self, sid, kind, payload):
        self.seq += 1
        self.events.append({"seq": self.seq, "sessionId": sid, "event": {"type": kind, "ts": NOW_MS,
                                                                          "payload": payload}})
        return self.seq

    def ship_result(self, p):
        """workspace.ship as realm's git-write.ts answers: commit what is
        staged, then push, with no-upstream until setUpstream is passed."""
        staged = [f for f in self.diff["files"] if f["staged"]]
        commit = {"state": "skipped", "sha": None, "subject": None, "reason": None}
        if p["commit"]:
            commit = {"state": "committed", "sha": "3f2a1b9c0d", "subject": p["message"], "reason": None} if staged \
                else {"state": "nothing-to-commit", "sha": None, "subject": None, "reason": "nothing is staged"}
            if staged:
                self.diff["files"] = [f for f in self.diff["files"] if not f["staged"] or f["unstaged"]]
        tracked = p["setUpstream"] or self.upstream
        self.upstream = tracked
        push = {"state": "pushed" if tracked else "no-upstream", "remote": "origin", "branch": self.diff["branch"],
                "reason": None}
        pr = {"state": "skipped", "url": None, "reason": None}
        if p.get("openPr") and push["state"] == "pushed":
            pr = {"state": "created", "url": "https://github.com/x/y/pull/7", "reason": None}
        if push["state"] == "pushed" or commit["state"] == "committed":
            self.ships.insert(0, {"id": self.nid("ship"), "environmentId": p.get("environmentId") or "env-none",
                                  "spaceId": "sp1", "branch": self.diff["branch"], "sha": "3f2a1b9c0d",
                                  "subject": p["message"] or "last commit", "prUrl": pr["url"],
                                  "pushState": push["state"], "createdAt": NOW_MS + self.n})
        return {"commit": commit, "push": push, "pr": pr}

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
        if method in ("workspace.stage", "workspace.unstage"):
            for f in self.diff["files"]:
                if f["path"] in p["paths"]:
                    f["staged"], f["unstaged"] = method == "workspace.stage", method == "workspace.unstage"
            return {"ok": True}
        if method == "workspace.ship":
            return self.ship_result(p)
        if method == "environments.get":
            sid = p["id"].removeprefix("env-")
            return {"id": p["id"], "path": self.sessions[sid]["cwd"] if sid in self.sessions else "/nowhere"}
        if method == "workspace.fileDiff":
            return {"path": p["path"], "oldPath": None, "staged": False, "binary": False, "truncated": False,
                    "truncatedReason": None, "additions": 1, "deletions": 1, "hunks": [
                        {"header": "def rail():", "oldStart": 1, "oldLines": 2, "newStart": 1, "newLines": 2,
                         "lines": [{"kind": "context", "text": "    keep = 1", "oldLine": 1, "newLine": 1},
                                   {"kind": "del", "text": "    old" + BIDI, "oldLine": 2, "newLine": None},
                                   {"kind": "add", "text": "    new", "oldLine": None, "newLine": 2}]}]}
        if method == "review.get":
            return {"review": self.review}
        if method == "review.request":
            return {"sessionId": "s-rev", "itemId": "it"}
        if method == "runs.list":
            return {"runs": [dict(r) for r in self.runs if not p["states"] or r["state"] in p["states"]],
                    "nextCursor": None}
        if method == "runs.get":
            r = next((r for r in self.runs if r["id"] == p["id"]), None)
            return {"run": dict(r), "attempts": []} if r else None
        if method == "runs.approve":
            r = next(r for r in self.runs if r["id"] == p["id"])
            r["state"] = "running"
            return dict(r)
        if method == "schedules.list":
            return [dict(x) for x in self.schedules]
        if method == "schedules.runNow":
            return dict(next(x for x in self.schedules if x["id"] == p["id"]))
        if method == "mcp.list":
            return {"servers": [dict(m) for m in self.mcp], "secretNote": ""}
        if method == "mcp.setEnabled":
            next(m for m in self.mcp if m["id"] == p["id"])["enabled"] = p["enabled"]
            return {"ok": True}
        if method == "memory.get":
            return {"path": self.memory_path, "doc": "", "agentsFile": {}, "profile": None}
        if method == "ships.list":
            return {"ships": [dict(x) for x in self.ships if x["spaceId"] == p["spaceId"]][: p["limit"]],
                    "nextCursor": None}
        if method == "checkpoints.preview":
            return dict(self.previews[p["id"]])
        if method == "checkpoints.restore":
            prev = self.previews[p["id"]]
            if p["acknowledge"] != {"filesChanged": prev["filesChanged"], "commitsRolledBack": prev["commitsRolledBack"]}:
                raise rc.RealmRpcError(method, "RESTORE_UNSAFE", "the checkout changed")
            self.restored.append(p["id"])
            return {"environmentId": prev["environmentId"], "path": prev["path"], "undoCheckpointId": "cp-undo",
                    "headMoved": True, "filesChanged": prev["filesChanged"], "commitsRolledBack": 0,
                    "filesRemoved": 1, "conversationRewound": prev["rewindsConversation"]}
        if method == "project.files":
            q = p["query"].lower()
            hits = [{"path": f, "score": 10, "segments": [{"text": f, "match": False}] if not q else [
                {"text": f[:f.lower().find(q)], "match": False}, {"text": f[f.lower().find(q):][:len(q)], "match": True},
                {"text": f[f.lower().find(q) + len(q):], "match": False}]}
                for f in self.files if not q or q in f.lower()]
            return {"hits": hits[: p["limit"]], "truncated": False, "source": "git"}
        if method == "mentions.files":
            q = p["query"].lower()
            hits = [{"path": f, "score": 1, "segments": [{"text": f, "match": False}]}
                    for f in self.files if q in f.lower()]
            return {"hits": hits[: p["limit"]], "truncated": False, "source": "git"}
        if method == "project.grep":
            q = p["query"]
            hits = [{"path": f, "line": n, "segments": [{"text": text[:text.find(q)], "match": False},
                                                         {"text": q, "match": True},
                                                         {"text": text[text.find(q) + len(q):], "match": False}]}
                    for f, n, text in self.code if q in text]
            return {"hits": hits[: p["limit"]], "truncated": len(hits) > p["limit"], "source": "git"}
        if method == "agents.probe":
            return [dict(x) for x in self.probe]
        if method == "models.catalog":
            return {"rows": [{"key": "5.5-claude-opus", "label": "Claude Opus 5.5", "vendor": "Anthropic",
                              "priceIn": 4, "priceOut": 20, "context": 1000000, "efforts": ["low", "high", "max"],
                              "blurb": None}]}
        if method == "sessions.setOptions":
            s = self.sessions[p["id"]]
            for key in ("model", "effort", "permissionMode"):
                if key in p:
                    s[key] = p[key]
            return dict(s)
        if method == "browsers.get":
            if p["browserId"] not in self.browsers:
                raise rc.RealmRpcError(method, "NOT_FOUND", "no browser")
            return dict(self.browsers[p["browserId"]])
        if method == "browsers.update":
            self.browsers[p["browserId"]]["url"] = p["url"]
            return {"ok": True}
        if method == "browsers.create":
            bid, iid = self.nid("br"), self.nid("item")
            self.browsers[bid] = {"id": bid, "spaceId": p["spaceId"], "url": p["url"], "title": "", "favicon": "",
                                  "createdAt": NOW_MS, "updatedAt": NOW_MS + self.n}
            self.items.append({"id": iid, "spaceId": p["spaceId"], "kind": "browser", "title": "Browser",
                               "refId": bid})
            return {"browserId": bid, "itemId": iid, "url": p["url"]}
        if method == "items.list":
            # A session's own terminal item is hidden from the list, as in
            # realm's store/items.ts (list vs listIncludingHidden).
            return [dict(i) for i in self.items if i["spaceId"] == p["spaceId"] and not i.get("hidden")]
        if method == "sessions.openTerminal":
            s = self.sessions[p["id"]]
            if not s.get("terminalItemId"):
                tid, iid = self.nid("term"), self.nid("item")
                self.items.append({"id": iid, "spaceId": s["spaceId"], "kind": "terminal", "title": "Terminal",
                                   "refId": tid, "hidden": True})
                self.term[tid] = {"run": "run1", "out": "", "programs": None}
                s["terminalItemId"] = iid
            item = next(i for i in self.items if i["id"] == s["terminalItemId"])
            return {"terminalId": item["refId"], "itemId": item["id"]}
        if method == "terminals.read":
            t = self.term.get(p["terminalId"])
            if t is None:
                return {"runId": "", "seq": 0, "live": "", "truncated": False, "running": False, "history": None}
            cur = p["cursor"]
            seq = len(t["out"])
            if cur and cur["runId"] == t["run"]:
                return {"runId": t["run"], "seq": seq, "live": t["out"][cur["seq"]:], "truncated": False,
                        "running": True, "history": None}
            return {"runId": t["run"], "seq": seq, "live": t["out"], "truncated": False, "running": True,
                    "history": None}
        if method == "terminals.programs":
            return {tid: {"id": t["programs"], "label": t["programs"]} for tid, t in self.term.items() if t["programs"]}
        if method == "terminals.write":
            self.term[p["terminalId"]]["out"] += p["data"].replace("\r", "\r\n")
            return {"ok": True}
        if method == "import.scan":
            return {"sessions": [{"key": k, "agentKind": "claude"} for k in self.disk], "memories": [], "skills": []}
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

    def close(self):
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
          "agents-transcript" in drawn_order(a) and drawn_order(a).index("agents-tiles")
          < drawn_order(a).index("agents-transcript"), drawn_order(a))
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
          model["/agents/fork"][0]["id"] == "s1@cp-1" and "untouched" in model["/agents/fork"][0]["text"],
          model["/agents/fork"])
    r = a.fork(ctx, data, {"row": "s1"})
    check("a Fork row that names no checkpoint is refused", not r.ok and len(e.writes) == 1, r)
    e.checkpoints.insert(0, {"id": "cp-2", "environmentId": "env-s1", "sessionId": "s1", "kind": "turn"})
    r = a.fork(ctx, data, {"row": "s1@cp-1"})
    check("a turn that landed after Fork was drawn moves the checkpoint, so the press refuses",
          not r.ok and "newer turn" in r.line and len(e.writes) == 1, (r, e.writes))
    e.checkpoints.pop(0)
    e.sessions["s1"]["status"] = "running"
    r = a.fork(ctx, data, {"row": "s1@cp-1"})
    check("Fork on a session working again is refused", not r.ok and len(e.writes) == 1, r)
    e.sessions["s1"]["status"] = "idle"
    r = a.fork(ctx, data, {"row": "s1@cp-1"})
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
    e.add_session("s-home", "idle", cwd=str(Path(ctx.home)), title="Home tab", updated=NOW_MS + 1)
    data, model = view(a, ctx)
    check("starting is chips, one field and one press", "agents-kinds Chips" in " ".join(a.layout())
          and "agents-task Field" in " ".join(a.layout()) and "Select" not in " ".join(a.layout()))
    row = model["/agents/new"][0]
    check("the home folder is never offered as where a new agent runs",
          all(f["path"] != os.path.realpath(ctx.home) for f in data["folders"]), [f["label"] for f in data["folders"]][:3])
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
    e.disk = [t["transcript"] for t in tabs] + ["/scanned/tab-lim.jsonl"]
    tabs.append({"id": "tab-ghost", "agent": "claude", "transcript": "/scanned/../../etc/ghost.jsonl",
                 "title": "Not a transcript realm found", "state": "working", "ask": "", "detail": "",
                 "project": "x", "last": now - 10})
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
    check("the press-less import scans first and applies only keys that same scan found",
          [m for m, _ in e.writes][:2] == ["import.scan", "import.apply"] and "ghost" not in json.dumps(applied),
          e.writes)
    refused = []
    for method in ("sessions.send", "workspace.ship", "import.undo"):
        try:
            SA.import_call(FakeConn(e), method, {"id": "s1", "text": "x"}, 1.0)
        except rc.RealmWriteRefused:
            refused.append(method)
    check("the press-less path refuses every write but import.scan and import.apply",
          refused == ["sessions.send", "workspace.ship", "import.undo"]
          and not any(m in refused for m, _ in e.writes), (refused, e.writes))
    check("a working tile says what it is doing, not the raw call", model["/agents/tiles"][1]["detail"] == "Editing realm.py",
          model["/agents/tiles"][1])
    check("tool calls read as phrases", [SA.doing(x) for x in (
        "sed -n 1,2p bin/x; grep y", "Bash: git status --short", "for i in 1 2; do curl x; done", "Skill",
        "Edit: /a/b/Glass.swift", "swift test --filter X", "")] == [
        "Reading files", "Running git status", "Waiting on a loop", "Using a skill", "Editing Glass.swift",
        "Running swift", ""])
    for sid, (_, tab) in zip(("s-imp1", "s-imp2"), [(0, tabs[0]), (1, tabs[1])]):
        pass
    for s in e.sessions.values():
        s["providerSessionId"] = "tab-wait" if "tab-wait" in s["title"] else "tab-run"
    data, model = view(a, ctx)
    check("once in, a tile is the engine's session with the tab's live state",
          model["/agents/tiles"][0]["id"].startswith("s-imp") and model["/agents/tiles"][0]["state"] == "needs"
          and model["/agents/tiles"][0]["detail"] == "Bash: npm test" and len(model["/agents/tiles"]) == 3,
          model["/agents/tiles"])
    clock[0] += SA.IMPORT_EVERY
    view(a, ctx)
    check("nothing comes in twice", sum(m == "import.apply" for m, _ in e.writes) == 1, e.writes)
    data, model = view(a, ctx)
    r = a.pick(ctx, data, {"row": "tab:tab-old"})
    applied = [p for m, p in e.writes if m == "import.apply"]
    check("tapping a tab not in the engine yet brings that one in and opens it",
          r.ok and len(applied) == 2 and [x["key"] for x in applied[-1]["sessions"]] == ["/scanned/tab-old.jsonl"]
          and a.pinned.startswith("s-imp"), (r, applied[-1:], a.pinned))
    opened = a.pinned
    data, model = view(a, ctx)
    check("an open tile is the only tile, so the card reads as that tile opened",
          tile_ids(model) == [opened] and model["/agents/tiles"][0]["selected"] and model["/agents/head"], tile_ids(model))
    r = a.pick(ctx, data, {"row": opened})
    data, model = view(a, ctx)
    check("tapping the open tile closes it and the others come back", r.ok and a.pinned == ""
          and len(tile_ids(model)) == 4 and model["/agents/head"] == "", tile_ids(model))

    s_wait = next(sid for sid, x in e.sessions.items() if x["providerSessionId"] == "tab-wait")
    data, model = view(a, ctx, open=s_wait)
    r = a.send(ctx, data, {"row": s_wait, "/agents/draft": "hi"})
    check("Send into a session whose tab is still open in VS Code refuses, so one conversation has one writer",
          not r.ok and "open in VS Code" in r.line and not any(m == "sessions.send" for m, _ in e.writes), r)

    limit = dict(tabs[0], id="tab-lim", transcript="/scanned/tab-lim.jsonl", state="failed", ask="",
                 detail="You've hit your weekly limit \u00b7 resets Oct 16 at 7am (America/Los_Angeles)")
    a.tabs = lambda t: [limit]
    a.pinned = ""
    data, model = view(a, ctx)
    tile = next(x for x in model["/agents/tiles"] if x["id"] == "tab:tab-lim")
    check("a tab out of its plan's usage is one calm line, not an error, and doesn't count as needing you",
          tile["state"] == "out" and tile["detail"] == "Out of Claude until Oct 16, 7am"
          and model["/agents/counts"]["needs"] == 0, (tile, model["/agents/counts"]))

    se = FakeEngine()
    sa, sctx = world(tmp / "tabscan", se)
    one = dict(tabs[0], id="tab-a", transcript="/scanned/tab-a.jsonl")
    shown = [one]
    sa.tabs = lambda t: [dict(x) for x in shown]
    sclock = [100.0]
    sa.clock = lambda: sclock[0]
    se.disk = ["/scanned/tab-a.jsonl"]
    view(sa, sctx)
    shown.append(dict(tabs[0], id="tab-b", transcript="/scanned/tab-b.jsonl"))
    se.disk.append("/scanned/tab-b.jsonl")
    sclock[0] += SA.IMPORT_EVERY
    view(sa, sctx)
    applied = json.dumps([p for m, p in se.writes if m == "import.apply"])
    check("a scan is reused for half an hour: a newer tab waits for the next one, the engine isn't rescanned",
          sum(m == "import.scan" for m, _ in se.writes) == 1 and "tab-b" not in applied, se.writes)
    sclock[0] += SA.SCAN_EVERY
    view(sa, sctx)
    applied = json.dumps([p for m, p in se.writes if m == "import.apply"])
    check("after it, a fresh scan brings the newer tab in",
          sum(m == "import.scan" for m, _ in se.writes) == 2 and "tab-b" in applied, se.writes)

    b, bctx = world(tmp / "tabsfail", FakeEngine())
    b.tabs = lambda t: [dict(tabs[0])]
    b.engine = None
    eng = FakeEngine()
    eng.fail["import.apply"] = rc.RealmRpcError("import.apply", "INTERNAL", "x")
    eng.disk = [tabs[0]["transcript"]]
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
    order = drawn_order(a)
    import surface_lint  # noqa: PLC0415  bin/lib, on the path above
    from surfaces import data_line  # noqa: PLC0415
    walls = surface_lint.lint(a.layout() + [data_line(k, v) for k, v in model.items()])
    check("the open card reads at a glance, no wall of text", walls == [], walls)
    check("the card grows out of the tile it opened from", model["/agents/pinnedRow"] == "s1"
          and 'agents-card Stack gap=3 from=@/agents/pinnedRow' in " ".join(a.layout()), model["/agents/pinnedRow"])
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


def finder(tmp: Path) -> None:
    """Find on the open card: file names at once, code from GREP_MIN letters,
    each row opening that file in the card, at its line, through the engine's
    own search, and nothing a press names outside the drawn answer."""
    e = FakeEngine()
    repo = tmp / "find" / "repo"
    (repo / "hud").mkdir(parents=True)
    (repo / "hud" / "Glass.swift").write_text("let a = 1\nlet glass = 2\n")
    (repo / "README.md").write_text("# readme\n")
    (repo / ".git").mkdir()
    e.files = ["hud/Glass.swift", "README.md", "../outside.txt", "gone.py"]
    e.code = [("hud/Glass.swift", 2, "let glass = 2")]
    e.add_session("s1", "idle", cwd=str(repo))
    a, ctx = world(tmp / "find", e)
    poked = []
    a.poke = lambda: poked.append(1)
    data, model = view(a, ctx, open="s1")
    check("an empty Find field searches nothing and draws no results",
          model["/agents/findOn"] and model["/agents/findFiles"] == [] and model["/agents/findLines"] == []
          and not any(m.startswith("project.") for m, _, _ in e.calls), [m for m, _, _ in e.calls])
    check("the Find field sits under the card's name, before the conversation",
          drawn_order(a).index("agents-find ") < drawn_order(a).index("agents-transcript"), drawn_order(a))
    values = {"/agents/find": "gl"}
    model = a.model(data, None, values, ctx)
    check("a short word asks for file names only, as an exec read, and pokes the panel when it lands",
          [m for m, _, _ in e.calls if m.startswith("project.")] == ["project.files"] and poked
          and all(not w for m, _, w in e.calls if m.startswith("project.")), e.calls[-1])
    model = a.model(data, None, values, ctx)
    rows = model["/agents/findFiles"]
    check("a file row is its name with the match lit, and its folder under it",
          rows and rows[0]["segments"] == [{"text": "Gl", "match": True}, {"text": "ass.swift", "match": False}]
          and rows[0]["where"] == "hud" and rows[0]["kind"] == "file" and model["/agents/findFilesCap"] == "Files",
          rows)
    check("the same word is not searched twice", sum(m == "project.files" for m, _, _ in e.calls) == 1)
    a.layout()
    check("results are drawn as Hits rows whose press opens", "agents-findfiles Hits" in " ".join(a.layout())
          and "action=\"ks-open\"" in " ".join(a.layout()), [x for x in a.layout() if "Hits" in x])
    r = a.open_hit(ctx, data, {"row": rows[0]["id"]})
    model = a.model(data, None, values, ctx)
    check("a file row opens that file in the card, editable, and marks its row",
          r.ok and model["/agents/filePath"] == str((repo / "hud" / "Glass.swift").resolve())
          and model["/agents/fileEdit"] is True and model["/agents/fileLine"] == 0
          and model["/agents/findFiles"][0]["selected"], (r, model["/agents/filePath"]))
    a.model(data, None, values, ctx)
    check("the open file is a File component in the card", "agents-file File path=@/agents/filePath" in
          " ".join(a.layout()) and "editable=true" in " ".join(a.layout()), [x for x in a.layout() if "File" in x])
    values = {"/agents/find": "glass"}
    a.model(data, None, values, ctx)
    model = a.model(data, None, values, ctx)
    check("from three letters it also searches the code, and a line row names its path and line",
          [m for m, _, _ in e.calls if m == "project.grep"] and model["/agents/findLines"]
          and model["/agents/findLines"][0]["where"] == "hud/Glass.swift · 2"
          and model["/agents/findLinesCap"] == "In the code", model["/agents/findLines"])
    r = a.open_hit(ctx, data, {"row": model["/agents/findLines"][0]["id"]})
    model = a.model(data, None, values, ctx)
    check("a line row opens its file at that line", r.ok and model["/agents/fileLine"] == 2
          and r.line == "Glass.swift, line 2.", r.line)
    stale = rows[0]["id"]
    check("a row from an older answer refuses rather than open its neighbour",
          not a.open_hit(ctx, data, {"row": stale}).ok)
    values = {"/agents/find": "outside"}
    a.model(data, None, values, ctx)
    model = a.model(data, None, values, ctx)
    out_row = next((x for x in model["/agents/findFiles"] if "outside" in "".join(t["text"] for t in x["segments"])),
                   None)
    r = a.open_hit(ctx, data, {"row": out_row["id"]}) if out_row else None
    check("a path the engine gave that leaves the project is never opened",
          r is not None and not r.ok and "outside" in r.line, r)
    values = {"/agents/find": "gone"}
    a.model(data, None, values, ctx)
    model = a.model(data, None, values, ctx)
    r = a.open_hit(ctx, data, {"row": model["/agents/findFiles"][0]["id"]})
    check("a file no longer on disk says so", not r.ok and "isn't on disk" in r.line, r)
    for bad in ("", "x", "f:0", "fz:0", "/etc/passwd", "f999:0"):
        check(f"a forged row {bad!r} opens nothing", not a.open_hit(ctx, data, {"row": bad}).ok)
    values = {"/agents/find": "zzzz"}
    a.model(data, None, values, ctx)
    model = a.model(data, None, values, ctx)
    check("a word with no match says so in one line", model["/agents/findNote"] == "Nothing in repo matches that."
          and model["/agents/findFiles"] == [], model["/agents/findNote"])
    model = a.model(data, None, {"/agents/find": "gl"}, ctx)
    close = model["/agents/fileClose"]
    check("an open file has one Close row naming it", close and close[0]["text"].startswith("Glass.swift"), close)
    r = a.close_file(ctx, data, {"row": "close:/etc/passwd"})
    check("Close only closes the file it named", not r.ok)
    r = a.close_file(ctx, data, {"row": close[0]["id"]})
    model = a.model(data, None, {"/agents/find": "gl"}, ctx)
    check("Close takes the file off the card", r.ok and model["/agents/filePath"] == "")
    e.fail["project.files"] = rc.RealmUnavailable("down")
    a.model(data, None, {"/agents/find": "readme"}, ctx)
    model = a.model(data, None, {"/agents/find": "readme"}, ctx)
    check("a search the engine can't answer says so, and draws no rows",
          "Couldn't search repo" in model["/agents/findNote"] and model["/agents/findFiles"] == [],
          model["/agents/findNote"])
    del e.fail["project.files"]
    a.pick(ctx, data, {"row": "s1"})
    check("searching wrote nothing", e.writes == [], e.writes)


def mention_picker(tmp: Path) -> None:
    """The @ list under the reply: realm's own list for the session's files,
    a pick puts @[name] in the text, and Send carries only the files whose
    token is still there, never a secret."""
    e = FakeEngine()
    repo = tmp / "mention" / "repo"
    (repo / "hud").mkdir(parents=True)
    for rel in ("hud/Glass.swift", "README.md", ".env", "docs/Glass.swift"):
        (repo / rel).parent.mkdir(parents=True, exist_ok=True)
        (repo / rel).write_text("x\n")
    e.files = ["hud/Glass.swift", "README.md", ".env", "docs/Glass.swift"]
    e.add_session("s1", "idle", cwd=str(repo))
    a, ctx = world(tmp / "mention", e)
    data, model = view(a, ctx, open="s1")
    check("a reply with no trailing @ asks for no list", model["/agents/mentions"] == []
          and not any(m == "mentions.files" for m, _, _ in e.calls))
    values = {"/agents/draft": "look at @gla"}
    a.model(data, None, values, ctx)
    model = a.model(data, None, values, ctx)
    rows = model["/agents/mentions"]
    check("a trailing @word lists the session's files through realm's own @ list, as a read",
          [m for m, _, _ in e.calls if m == "mentions.files"] == ["mentions.files"]
          and [r["where"] for r in rows] == ["hud", "docs"] and model["/agents/mentionsCap"] == "Attach a file"
          and "agents-mentions Hits" in " ".join(a.layout()), rows)
    check("the @ list sits between the reply and Send",
          drawn_order(a).index("agents-draft") < drawn_order(a).index("agents-mentions")
          < drawn_order(a).index("agents-send"), drawn_order(a))
    r = a.pick_mention(ctx, data, {"row": rows[0]["id"], **values})
    check("a pick puts @[name] where the @word was", r.ok and r.updates["/agents/draft"] == "look at @[Glass.swift] ",
          r.updates)
    values = {"/agents/draft": r.updates["/agents/draft"] + "and @gla"}
    a.model(data, None, values, ctx)
    model = a.model(data, None, values, ctx)
    r2 = a.pick_mention(ctx, data, {"row": model["/agents/mentions"][1]["id"], **values})
    check("a second file with the same name gets its folder in its chip",
          r2.ok and r2.updates["/agents/draft"].endswith("and @[docs/Glass.swift] "), r2.updates)
    text = r2.updates["/agents/draft"] + "please"
    model = a.model(data, None, {"/agents/draft": text}, ctx)
    check("the Send row says which files go with it", "with Glass.swift, docs/Glass.swift" in
          model["/agents/send"][0]["text"], model["/agents/send"])
    r = a.pick_mention(ctx, data, {"row": rows[0]["id"], "/agents/draft": "no at here"})
    check("a pick whose @word is gone does nothing", not r.ok)
    for bad in ("", "m1", "m999:0", "f1:0"):
        check(f"a forged pick {bad!r} does nothing",
              not a.pick_mention(ctx, data, {"row": bad, "/agents/draft": "x @gla"}).ok)
    dropped = text.replace("@[docs/Glass.swift] ", "")
    a.send(ctx, data, {"row": "s1", "/agents/draft": dropped})
    sent = [p for m, p in e.writes if m == "sessions.send"]
    check("Send carries the files whose token is still in the text, and no other",
          sent and sent[-1].get("mentionRefs") == [{"kind": "file", "label": "Glass.swift",
                                                     "path": str((repo / "hud" / "Glass.swift").resolve())}], sent)
    a.forget_mentions("s1")
    import surfaces.agent_ide as ide  # noqa: PLC0415
    check("a secret file is never listed", all(ide.secret_path(x) for x in
          (".env", ".env.local", "a/.ssh/config", "k.pem", "id_ed25519", "client_secret_1.json"))
          and not any(ide.secret_path(x) for x in (".env.example", "README.md", "keys.py")))
    values = {"/agents/draft": "@en"}
    a.model(data, None, values, ctx)
    model = a.model(data, None, values, ctx)
    check("and the @ list leaves it out even when the engine names it",
          not any(".env" in r["segments"][0]["text"] for r in model["/agents/mentions"]), model["/agents/mentions"])
    check("live refs drop a token whose file was a secret",
          ide.live_refs("@[k] @[ok]", {"k": "/r/k.pem", "ok": "/r/ok.py"}) == [{"kind": "file", "label": "ok",
                                                                                 "path": "/r/ok.py"}])


def real_repo(tmp: Path) -> None:
    """A tab opened in the home folder and imported with that as its cwd
    points at the repo its tool calls worked in: the card's meta, its
    changes, its finder and its tile all name that repo, never ~."""
    e = FakeEngine()
    a, ctx = world(tmp / "repo", e)
    home = Path(ctx.home)
    repo = home / "code" / "chewbacca"
    (repo / "hud").mkdir(parents=True, exist_ok=True)
    other = home / "code" / "amber" / "amber-id"
    e.add_session("s1", "idle", title="HUD", cwd=str(home))
    e.event("s1", "tool_call", {"name": "Read", "input": {"file_path": str(other / "README.md")}})
    e.event("s1", "tool_call", {"name": "Read", "input": {"file_path": str(other / "src" / "a.ts")}})
    e.event("s1", "tool_call", {"name": "Edit", "input": {"file_path": str(repo / "hud" / "Glass.swift")}})
    e.event("s1", "tool_call", {"name": "Read", "input": {"file_path": "relative/not/counted.py"}})
    e.diff = {"root": str(repo), "branch": "main", "totalFiles": 0, "truncated": False, "files": []}
    data, model = view(a, ctx, open="s1")
    data = a.fetch(ctx)
    model = a.model(data, None, {}, ctx)
    check("an edit outweighs two reads: the card works in the repo it changed",
          "~/code/chewbacca" in model["/agents/meta"] and "joelnewton" not in model["/agents/meta"],
          model["/agents/meta"])
    diffs = [p["cwd"] for m, p, _ in e.calls if m == "workspace.diff"]
    check("its changes are read from that repo, not the home folder",
          diffs and diffs[-1] == str(repo.resolve()), diffs)
    check("its tile names that repo", model["/agents/tiles"][0]["meta"].startswith("chewbacca"),
          model["/agents/tiles"])
    e.files = ["hud/Glass.swift"]
    a.model(data, None, {"/agents/find": "glass"}, ctx)
    cwds = [p["cwd"] for m, p, _ in e.calls if m == "project.files"]
    check("the finder searches that repo", cwds and cwds[-1] == str(repo.resolve()), cwds)
    a.model(data, None, {"/agents/draft": "@gl"}, ctx)
    check("the @ list asks that repo, since realm's own list would walk the home folder",
          [p["cwd"] for m, p, _ in e.calls if m == "project.files"][-1] == str(repo.resolve())
          and not any(m == "mentions.files" for m, _, _ in e.calls), e.calls[-1])
    e.add_session("s2", "idle", title="Native", cwd=str(other))
    data = a.fetch(ctx)
    row = next(r for r in data["rows"] if r["id"] == "s2")
    check("a session already in a repo keeps it", not row.get("repo") and row["cwd_raw"] == str(other), row)
    entries = [{"message": {"content": [{"type": "tool_use", "name": "Edit",
                                         "input": {"file_path": str(other / "src" / "x.ts")}}]}}]
    t = {"cwd": str(home), "transcript": str(tmp / "repo" / "t.jsonl")}
    (tmp / "repo" / "t.jsonl").write_text("{}\n")
    check("a live tab opened in the home folder is named for the repo it edited",
          SA.tab_repo(t, home, entries) == str(other.resolve()), SA.tab_repo(t, home, entries))
    check("a tab already in a repo is left alone", SA.tab_repo({"cwd": str(repo), "transcript": t["transcript"]},
                                                               home, entries) == "")
    e.add_session("s3", "idle", title="Bash only", cwd=str(home))
    e.event("s3", "tool_call", {"name": "Bash", "input": {"command": f"cd {other}/src && cat a.ts; git -C {other} log -1"}})
    e.event("s3", "tool_call", {"name": "Bash", "input": {"command": "cd $HOME/x && ls"}})
    a.pick(ctx, a.fetch(ctx), {"row": "s3"})
    data = a.fetch(ctx)
    row = next(r for r in data["rows"] if r["id"] == "s3")
    check("a session that only ran Bash is placed by the folders it cd'd into",
          row.get("repo") == str(other.resolve()), row.get("repo"))
    check("placing a session wrote nothing", e.writes == [], e.writes)


def history(tmp: Path) -> None:
    """History on the open card: checkpoints and ships together, newest
    first; a checkpoint previews before Restore is offered, Restore sends the
    counts shown and refuses when they moved; Open PR is realm's ship with
    the commit leg off, and its page opens in the card."""
    e = FakeEngine()
    cwd = str(tmp / "hist" / "repo")
    e.add_session("s1", "idle", cwd=cwd)
    e.checkpoints += [{"id": "cp-2", "environmentId": "env-s1", "sessionId": "s1", "kind": "turn",
                       "label": "make the rail glass", "createdAt": NOW_MS - 600_000},
                      {"id": "cp-1", "environmentId": "env-s1", "sessionId": "s1", "kind": "turn",
                       "label": "first ask", "createdAt": NOW_MS - 7_200_000}]
    e.ships.append({"id": "ship-old", "environmentId": "env-s1", "spaceId": "sp1", "branch": "feat/rail",
                    "sha": "abcdef1234", "subject": "feat: rail", "prUrl": "https://github.com/x/y/pull/3",
                    "pushState": "pushed", "createdAt": NOW_MS - 3_600_000})
    e.ships.append({"id": "ship-other", "environmentId": "env-elsewhere", "spaceId": "sp1", "branch": "main",
                    "sha": "999", "subject": "someone else's", "prUrl": None, "pushState": "pushed", "createdAt": NOW_MS})
    e.previews["cp-2"] = {"checkpointId": "cp-2", "environmentId": "env-s1", "path": cwd, "label": "make the rail glass",
                          "createdAt": NOW_MS - 600_000, "filesChanged": 3, "commitsRolledBack": 0, "headMovable": True,
                          "headReason": None, "intact": True, "rewindsConversation": True}
    e.diff = {"root": cwd, "branch": "feat/rail", "totalFiles": 0, "truncated": False, "files": []}
    a, ctx = world(tmp / "hist", e)
    data, model = view(a, ctx, open="s1")
    rows = model["/agents/history"]
    check("History lists the session's checkpoints and its own ships together, newest first",
          [r["id"] for r in rows] == ["c:cp-2", "s:ship-old", "c:cp-1"]
          and rows[0]["where"] == "before a turn · 12m ago" and rows[1]["kind"] == "pr"
          and rows[1]["where"] == "abcdef1 on feat/rail · pushed · pull request · 1h ago"
          and model["/agents/historyCap"] == "History", rows)
    check("nothing restores until a checkpoint is previewed", model["/agents/restore"] == [])
    r = a.pick_history(ctx, data, {"row": "c:cp-2"})
    model = a.model(data, None, {}, ctx)
    check("a checkpoint row previews what restoring costs, as an exec read",
          r.ok and model["/agents/restoreNote"].startswith("Rewrites 3 files to match it.")
          and "conversation rewinds" in model["/agents/restoreNote"]
          and model["/agents/restore"][0]["id"] == "restore:cp-2:3:0"
          and model["/agents/history"][0]["selected"], (r, model["/agents/restoreNote"]))
    e.previews["cp-2"] = dict(e.previews["cp-2"], filesChanged=4)
    r = a.restore(ctx, data, {"row": "restore:cp-2:3:0"})
    model = a.model(data, None, {}, ctx)
    check("a restore whose cost moved since it was shown refuses, and the card shows the new cost",
          not r.ok and not e.restored and model["/agents/restore"][0]["id"] == "restore:cp-2:4:0", r)
    e.sessions["s1"]["status"] = "running"
    r = a.restore(ctx, data, {"row": "restore:cp-2:4:0"})
    check("nothing restores while the agent is working", not r.ok and not e.restored, r)
    e.sessions["s1"]["status"] = "idle"
    for bad in ("", "restore:cp-1:4:0", "restore:cp-2:x:0", "cp-2"):
        check(f"a forged restore {bad!r} does nothing", not a.restore(ctx, data, {"row": bad}).ok and not e.restored)
    r = a.restore(ctx, data, {"row": "restore:cp-2:4:0"})
    check("Restore sends exactly the counts it showed, and says the undo point is in History",
          r.ok and e.restored == ["cp-2"] and ("checkpoints.restore", {"id": "cp-2", "acknowledge": {
              "filesChanged": 4, "commitsRolledBack": 0}}) in e.writes and "undo point" in r.line, (r, e.writes))
    data = a.fetch(ctx)
    model = a.model(data, None, {}, ctx)
    check("after a restore the preview is gone", model["/agents/restore"] == [] and model["/agents/restoreNote"] == "")
    r = a.pick_history(ctx, data, {"row": "s:ship-old"})
    model = a.model(data, None, {}, ctx)
    check("a ship row with a pull request opens its page in the card",
          r.ok and model["/agents/prWeb"] == "https://github.com/x/y/pull/3" and "agents-prweb Web" in
          " ".join(a.layout()), model["/agents/prWeb"])
    check("Open PR is offered for a feature branch with nothing staged",
          model["/agents/pr"] and model["/agents/pr"][0]["id"] == "pr:feat/rail", model["/agents/pr"])
    r = a.open_pr(ctx, data, {"row": "pr:main"})
    check("Open PR for a branch that isn't checked out does nothing", not r.ok)
    r = a.open_pr(ctx, data, {"row": "pr:feat/rail"})
    ships = [p for m, p in e.writes if m == "workspace.ship"]
    model = a.model(a.fetch(ctx), None, {}, ctx)
    check("Open PR is realm's ship with the commit leg off and the PR leg on, and its page opens",
          r.ok and ships[-1]["commit"] is False and ships[-1]["openPr"] is True and ships[-1]["message"] == ""
          and model["/agents/prWeb"] == "https://github.com/x/y/pull/7", (r, ships))
    e.diff = {"root": cwd, "branch": "main", "totalFiles": 0, "truncated": False, "files": []}
    a._changes = None
    model = a.model(a.fetch(ctx), None, {}, ctx)
    check("no pull request is offered from main", model["/agents/pr"] == [], model["/agents/pr"])
    e.ships.insert(0, {"id": "ship-evil", "environmentId": "env-s1", "spaceId": "sp1", "branch": "x",
                       "sha": "1", "subject": "x", "prUrl": "javascript:alert(1)", "pushState": "pushed",
                       "createdAt": NOW_MS + 999})
    a._history = None
    data = a.fetch(ctx)
    r = a.pick_history(ctx, data, {"row": "s:ship-evil"})
    check("a pull request link that isn't http or https never opens", not r.ok, r)


def this_space(tmp: Path) -> None:
    """The space's other records on the card: one list, a press selects, and
    the one verb for the selected row writes only from its own press."""
    e = FakeEngine()
    cwd = str(tmp / "space" / "repo")
    e.add_session("s1", "idle", cwd=cwd)
    e.diff = {"root": cwd, "branch": "feat/x", "totalFiles": 1, "truncated": False, "files": [
        {"path": "a.py", "oldPath": None, "status": "modified", "staged": False, "unstaged": True, "binary": False,
         "additions": 1, "deletions": 0}]}
    e.runs = [{"id": "run1", "title": "Nightly deps bump", "state": "blocked", "attempt": 2, "spaceId": "sp1"}]
    e.schedules = [{"id": "sch1", "title": "Morning triage", "cron": "0 9 * * *", "enabled": True,
                    "nextRunAt": NOW_MS + 3_600_000, "lastRunAt": NOW_MS - 86_400_000}]
    e.mcp = [{"id": "m1", "name": "linear", "enabled": True, "status": "connected", "tools": [{}, {}]}]
    a, ctx = world(tmp / "space", e)
    realm_home = Path(ctx.env["CHEWBACCA_REALM_HOME"])
    (realm_home / "memory").mkdir(parents=True)
    (realm_home / "memory" / "sp1.md").write_text("Use pnpm.\n")
    e.memory_path = str(realm_home / "memory" / "sp1.md")
    data, model = view(a, ctx, open="s1")
    rows = model["/agents/space"]
    check("This space lists a review to ask for, the blocked run, the schedule, the connection and memory",
          [r["id"] for r in rows] == ["review", "run:run1", "sch:sch1", "mcp:m1", "memory"]
          and rows[2]["where"] == "0 9 * * * · on · last ran 1d ago" and rows[3]["where"] == "connected · 2 tools"
          and model["/agents/spaceCap"] == "This space", rows)
    check("no verb is drawn until a row is picked", model["/agents/spaceDo"] == [])
    a.pick_space(ctx, data, {"row": "run:run1"})
    model = a.model(data, None, {}, ctx)
    check("picking the blocked run offers Approve, naming it",
          model["/agents/spaceDo"][0]["id"] == "run:run1:2" and model["/agents/spaceDoLabel"] == "Approve"
          and "Nightly deps bump" in model["/agents/spaceDo"][0]["text"], model["/agents/spaceDo"])
    r = a.space_do(ctx, data, {"row": "run:run1:1"})
    check("an approval for an older attempt refuses", not r.ok and not any(m == "runs.approve" for m, _ in e.writes))
    data = a.fetch(ctx)
    a.pick_space(ctx, data, {"row": "run:run1"})
    r = a.space_do(ctx, data, {"row": "run:run1:2"})
    check("Approve approves that run only", r.ok and ("runs.approve", {"id": "run1", "approved": True, "note": None})
          in e.writes, (r, e.writes))
    data = a.fetch(ctx)
    a.pick_space(ctx, data, {"row": "mcp:m1"})
    model = a.model(data, None, {}, ctx)
    check("picking a connection offers to turn it off, by name", model["/agents/spaceDo"][0]["id"] == "mcp:m1:off"
          and model["/agents/spaceDo"][0]["text"].startswith("Turns off linear"), model["/agents/spaceDo"])
    r = a.space_do(ctx, data, {"row": "mcp:m1:off"})
    check("and the press turns it off in this space", r.ok and ("mcp.setEnabled", {"spaceId": "sp1", "id": "m1",
                                                                                 "enabled": False}) in e.writes, r)
    data = a.fetch(ctx)
    a.pick_space(ctx, data, {"row": "sch:sch1"})
    r = a.space_do(ctx, data, {"row": "sch:sch1"})
    check("Run now runs the task once", r.ok and ("schedules.runNow", {"id": "sch1"}) in e.writes, r)
    data = a.fetch(ctx)
    a.pick_space(ctx, data, {"row": "review"})
    model = a.model(data, None, {}, ctx)
    check("with changes and no review, Review asks a read-only reviewer", model["/agents/spaceDo"][0]["id"] ==
          "review:env-s1" and "can't edit or ship" in model["/agents/spaceDo"][0]["text"], model["/agents/spaceDo"])
    r = a.space_do(ctx, data, {"row": "review:env-s1"})
    check("and the press asks realm for one", r.ok and ("review.request", {"environmentId": "env-s1"}) in e.writes, r)
    e.review = {"environmentId": "env-s1", "sessionId": "s-rev", "sessionTitle": "Review", "outcome": "done",
                "text": "Two findings.\n1. a.py misses a test.", "createdAt": NOW_MS - 60_000}
    data = a.fetch(ctx)
    model = a.model(data, None, {}, ctx)
    check("a finished review shows its first line", model["/agents/space"][0]["segments"][0]["text"] ==
          "Two findings." and model["/agents/space"][0]["where"].startswith("reviewed"), model["/agents/space"][0])
    r = a.pick_space(ctx, data, {"row": "review"})
    check("pressing it shows the whole verdict in the card", r.ok and "misses a test" in r.updates["/agents/patch"])
    r = a.pick_space(ctx, data, {"row": "memory"})
    model = a.model(data, None, {}, ctx)
    check("Memory opens the space's memory file in the editor", r.ok and model["/agents/filePath"] ==
          str((realm_home / "memory" / "sp1.md").resolve()) and model["/agents/fileEdit"] is True, model["/agents/filePath"])
    e.memory_path = "/etc/passwd"
    a._space = None
    data = a.fetch(ctx)
    model = a.model(data, None, {}, ctx)
    check("a memory path outside realm's home is never offered",
          not any(r["id"] == "memory" for r in model["/agents/space"]), model["/agents/space"])
    for bad in ("", "nope", "sch:other"):
        check(f"a forged space press {bad!r} changes nothing", not a.space_do(ctx, data, {"row": bad}).ok)


def ship_values(a, data, ctx, message):
    """The model a Commit and push press is drawn from, and its row id."""
    model = a.model(data, None, {"/agents/message": message}, ctx)
    return model, (model["/agents/ship"][0]["id"] if model["/agents/ship"] else "")


def shipping(tmp: Path) -> None:
    """Stage, Unstage, and Commit and push from the opened card, each a press on a
    row that says what it touches, each going through realm's workspace.*."""
    e = FakeEngine()
    cwd = str(tmp / "ship" / "repo")
    e.add_session("s1", "idle", title="Fix the rail", cwd=cwd)
    e.diff = {"root": cwd, "branch": "feat/rail", "totalFiles": 3, "truncated": False, "files": [
        {"path": "hud/Glass.swift", "oldPath": None, "status": "modified", "staged": False, "unstaged": True,
         "binary": False, "additions": 3, "deletions": 1},
        {"path": "README.md", "oldPath": None, "status": "modified", "staged": False, "unstaged": True,
         "binary": False, "additions": 1, "deletions": 0},
        {"path": "evil" + BIDI + ".txt", "oldPath": None, "status": "added", "staged": False, "unstaged": True,
         "binary": False, "additions": 1, "deletions": 0}]}
    a, ctx = world(tmp / "ship", e)
    data, model = view(a, ctx, open="s1")
    check("an open card with unstaged files offers Stage all, naming how many and how to undo it",
          [r["text"] for r in model["/agents/stage"]] == ["All 2 unstaged files · Unstage takes them back"]
          and model["/agents/unstage"] == [] and model["/agents/ship"] == [], model["/agents/stage"])
    check("nothing staged draws no commit box", "agents-message" not in " ".join(a.layout()))
    a.show_file(ctx, data, {"row": "hud/Glass.swift"})
    data, model = view(a, ctx)
    check("a file whose diff is open can be staged on its own",
          [r["id"] for r in model["/agents/stage"]] == ["file:hud/Glass.swift", model["/agents/stage"][1]["id"]]
          and model["/agents/stage"][0]["text"] == "Glass.swift · Unstage takes it back", model["/agents/stage"])
    check("reading the card wrote nothing", e.writes == [], e.writes)

    r = a.stage(ctx, data, {"row": "file:hud/Glass.swift"})
    check("Stage stages exactly that file through realm",
          r.ok and e.writes == [("workspace.stage", {"cwd": cwd, "paths": ["hud/Glass.swift"]})], (r, e.writes))
    r = a.stage(ctx, data, {"row": "file:evil" + BIDI + ".txt"})
    check("a path with a hidden character is never staged", not r.ok and len(e.writes) == 1, (r, e.writes))
    r = a.stage(ctx, data, {"row": "file:/etc/passwd"})
    check("a file not in its changes is never staged", not r.ok and len(e.writes) == 1, r)
    stale_all = model["/agents/stage"][1]["id"]
    r = a.stage(ctx, data, {"row": stale_all})
    check("Stage all drawn before a file was staged is refused, since the set it named changed",
          not r.ok and "changed since" in r.line and len(e.writes) == 1, r.line)

    data, model = view(a, ctx)
    check("a staged file says so in the list, and can be unstaged",
          "staged" in model["/agents/changed"][0]["time"]
          and [x["id"] for x in model["/agents/unstage"]] == ["file:hud/Glass.swift"], model["/agents/changed"])
    check("something staged draws the commit box", "agents-message Field" in " ".join(a.layout()))
    check("but no Commit and push row until there is a message", model["/agents/ship"] == [], model["/agents/ship"])
    model, row = ship_values(a, data, ctx, "fix the rail glass")
    check("a typed message offers Commit and push, naming the files, the branch and that a push stays",
          model["/agents/ship"][0]["text"] == "1 staged file on feat/rail, then pushed · a push can't be taken back here"
          and row.startswith("ship:"), model["/agents/ship"])
    r = a.ship(ctx, data, {"row": row, "/agents/message": "a different message"})
    check("Commit with a message other than the one drawn is refused", not r.ok
          and not any(m == "workspace.ship" for m, _ in e.writes), r.line)
    e.sessions["s1"]["status"] = "running"
    r = a.ship(ctx, data, {"row": row, "/agents/message": "fix the rail glass"})
    check("Commit while the agent is working is refused", not r.ok and "still working" in r.line, r.line)
    e.sessions["s1"]["status"] = "idle"
    e.upstream = False
    r = a.ship(ctx, data, {"row": row, "/agents/message": "fix the rail glass"})
    ships = [p for m, p in e.writes if m == "workspace.ship"]
    check("Commit and push commits the staged file with the message, pushes, never opens a PR or sets upstream",
          ships == [{"cwd": cwd, "commit": True, "message": "fix the rail glass", "push": True, "setUpstream": False,
                     "openPr": False, "environmentId": "env-s1"}], ships)
    check("a commit whose push had no upstream says so, and clears the message",
          r.ok and "push didn't go" in r.line and r.updates.get("/agents/message") == "", r)
    check("the result line names the folder and never the message", "fix the rail" not in r.line, r.line)
    data, model = view(a, ctx)
    check("the card says what happened in realm's words",
          model["/agents/shipped"] == "Committed 3f2a1b9 \u201cfix the rail glass\u201d. Not pushed: this branch has "
                                      "never been pushed.", model["/agents/shipped"])
    check("and offers the first push of that branch, naming it",
          [x["id"] for x in model["/agents/upstream"]] == ["upstream:feat/rail"]
          and "feat/rail to origin" in model["/agents/upstream"][0]["text"], model["/agents/upstream"])
    r = a.upstream(ctx, data, {"row": "upstream:main"})
    check("a push for another branch is refused", not r.ok, r)
    r = a.upstream(ctx, data, {"row": "upstream:feat/rail"})
    ships = [p for m, p in e.writes if m == "workspace.ship"]
    check("the first push sets the upstream and commits nothing",
          r.ok and ships[-1]["commit"] is False and ships[-1]["setUpstream"] is True and len(ships) == 2, ships[-1])
    data, model = view(a, ctx)
    check("then the card says it pushed, and the offer is gone",
          model["/agents/shipped"] == "Pushed to origin/feat/rail." and model["/agents/upstream"] == [],
          model["/agents/shipped"])

    e.fail["workspace.ship"] = maybe(rc.RealmTimeout("no answer"))
    data, model = view(a, ctx)
    loose = model["/agents/stage"]
    a.stage(ctx, data, {"row": loose[-1]["id"]})
    data, model = view(a, ctx)
    model, row = ship_values(a, data, ctx, "docs")
    before = len(e.writes)
    r = a.ship(ctx, data, {"row": row, "/agents/message": "docs"})
    check("a ship the engine may have run says may have, and is not retried",
          not r.ok and "may have" in r.line and len(e.writes) == before + 1, (r.line, e.writes[before:]))
    del e.fail["workspace.ship"]
    lines = [f"@ {a.name} at=center w={a.width}"] + a.layout() + [surfaces.data_line(k, v) for k, v in
                                                                   {**a.initial(), **model}.items()]
    check("the card with its git rows is valid Kyber Lines", not tks.validate(lines), tks.validate(lines))
    check("no hidden character reaches the glass", glass_clean(model), model)


def terminal(tmp: Path) -> None:
    """The agent's terminal inside its opened card: opened by a press, read live
    from a cursor, typed into only from Run, never a stacked panel of its own."""
    e = FakeEngine()
    e.add_session("s1", "idle", title="Fix the rail", cwd="/Users/x/code/chewbacca")
    a, ctx = world(tmp / "term", e)
    data, model = view(a, ctx, open="s1")
    check("an agent with no terminal offers to open one, saying nothing runs yet",
          [x["id"] for x in model["/agents/termopen"]] == ["open:s1"] and "nothing runs" in
          model["/agents/termopen"][0]["text"] and not model["/agents/termOn"], model["/agents/termopen"])
    check("reading the card opened no terminal", not any(m == "sessions.openTerminal" for m, _, _ in e.calls))
    r = a.term_open(ctx, data, {"row": "open:s2"})
    check("opening another agent's terminal is refused", not r.ok and e.writes == [], r)
    r = a.term_open(ctx, data, {"row": "open:s1"})
    check("Open makes the session's own terminal through realm",
          r.ok and e.writes == [("sessions.openTerminal", {"id": "s1"})] and a.refresh == SA.REFRESH_BUSY, r)
    tid = next(iter(e.term))
    b, bctx = world(tmp / "term-restart", e)
    _, bmodel = view(b, bctx, open="s1")
    check("a panel that didn't open the terminal (a restarted daemon) offers Open again, never guessing it",
          bmodel["/agents/termopen"] and not bmodel["/agents/termOn"], bmodel["/agents/termopen"])
    before = len(e.writes)
    r = b.term_open(bctx, b.fetch(bctx), {"row": "open:s1"})
    check("and its Open hands back the same terminal, no second shell",
          r.ok and len(e.term) == 1 and b.terminal_of(None, b.row(e.sessions["s1"], {}, bctx)) == tid
          and len(e.writes) == before + 1, (r, list(e.term)))
    base = len(e.writes)
    e.term[tid]["out"] = "\x1b]0;title\x07\x1b[1;32mjoel@mac\x1b[0m chewbacca % "
    data, model = view(a, ctx)
    layout = " ".join(a.layout())
    check("the terminal draws inside the card, as plain text, after the rest of the card",
          model["/agents/termOn"] and "agents-terminal Diff" in layout and "plain=true" in layout
          and drawn_order(a).index("agents-transcript") < drawn_order(a).index("agents-terminal"), layout)
    check("escapes are dropped and the prompt reads as text", model["/agents/terminal"] == "joel@mac chewbacca %",
          model["/agents/terminal"])
    check("it says where the shell is and that it's idle", model["/agents/termHead"] ==
          "Terminal in chewbacca · shell idle", model["/agents/termHead"])
    check("no Run until a command is typed, no Ctrl-C with nothing running",
          model["/agents/run"] == [] and model["/agents/ctrlc"] == [], (model["/agents/run"], model["/agents/ctrlc"]))
    values = {"/agents/command": "git status"}
    model = a.model(data, None, values, ctx)
    row = model["/agents/run"][0]["id"]
    check("a typed command offers Run, naming the shell and that it can't be taken back",
          "chewbacca" in model["/agents/run"][0]["text"] and "can't be taken back" in model["/agents/run"][0]["text"],
          model["/agents/run"])
    r = a.run(ctx, data, {"row": row, "/agents/command": "rm -rf ~"})
    check("Run with a command other than the one drawn is refused", not r.ok and len(e.writes) == base, r)
    bad = "ls\u202e"
    model = a.model(data, None, {"/agents/command": bad}, ctx)
    check("a command with a hidden character gets no Run row", model["/agents/run"] == [], model["/agents/run"])
    r = a.run(ctx, data, {"row": SA.command_id(tid, bad), "/agents/command": bad})
    check("and its press is refused", not r.ok and len(e.writes) == base, r)
    r = a.run(ctx, data, {"row": "run:term-other:" + row.rsplit(":", 1)[1], "/agents/command": "git status"})
    check("a Run naming a terminal that isn't this agent's is refused", not r.ok and len(e.writes) == base, r)
    r = a.run(ctx, data, {"row": row, **values})
    check("Run types exactly the command and Return into that terminal, then clears the field",
          r.ok and e.writes[-1] == ("terminals.write", {"terminalId": tid, "data": "git status\r"})
          and r.updates.get("/agents/command") == "" and "git status" not in r.line, (r, e.writes[-1]))
    e.term[tid]["out"] += "On branch main\r\nnothing to commit, working tree clean\r\n"
    e.term[tid]["programs"] = "npm"
    data, model = view(a, ctx)
    reads = [p for m, p, _ in e.calls if m == "terminals.read"]
    check("the next read carries on from the cursor, not from the top",
          reads[-1]["cursor"] is not None and reads[-1]["cursor"]["runId"] == "run1", reads[-1])
    check("its output shows live in the card", model["/agents/terminal"].splitlines()[-2:] ==
          ["On branch main", "nothing to commit, working tree clean"], model["/agents/terminal"])
    check("a running program offers Ctrl-C and keeps the reads fast",
          model["/agents/ctrlc"][0]["id"] == f"ctrlc:{tid}" and model["/agents/termHead"].endswith("running npm")
          and a.refresh == SA.REFRESH_BUSY, (model["/agents/ctrlc"], a.refresh))
    r = a.ctrl_c(ctx, data, {"row": f"ctrlc:{tid}"})
    check("Ctrl-C sends one interrupt byte to that terminal",
          r.ok and e.writes[-1] == ("terminals.write", {"terminalId": tid, "data": "\x03"}), e.writes[-1])
    e.term[tid]["out"] += "\x1b[2Jfresh screen\r\nprogress 10%\rprogress 99%\r\nab\bc\u202e\r\n"
    data, model = view(a, ctx)
    check("a clear screen, a carriage return and a backspace read as the screen would, hidden characters gone",
          model["/agents/terminal"].splitlines() == ["fresh screen", "progress 99%", "ac"], model["/agents/terminal"])
    check("no hidden character reaches the glass", glass_clean(model), model)
    lines = [f"@ {a.name} at=center w={a.width}"] + a.layout() + [surfaces.data_line(k, v) for k, v in
                                                                   {**a.initial(), **model}.items()]
    check("the card with its terminal is valid Kyber Lines", not tks.validate(lines), tks.validate(lines))
    check("the terminal never opens a surface of its own", sum(x.startswith("@ ") for x in lines) == 1)


def options(tmp: Path) -> None:
    """Model, effort and permission chips on the opened card, set through
    realm's sessions.setOptions; a permission switch only from a row naming it."""
    e = FakeEngine()
    e.add_session("s1", "idle", title="Fix the rail", cwd="/Users/x/code/chewbacca")
    e.add_session("s2", "idle", title="Port it", kind="codex")
    e.probe = [x for x in e.probe if x["kind"] != "codex"]
    e.probe.append({"kind": "codex", "available": True, "version": "1", "loggedIn": True, "reason": None,
                    "models": [{"id": "gpt-6-sol", "label": "GPT-6-Sol", "efforts": ["low", "high"]},
                               {"id": "gpt-6-astra", "label": "GPT-6-Astra", "isDefault": True,
                                "efforts": ["low"]},
                               {"id": "bad" + BIDI, "label": "Bad"}]})
    a, ctx = world(tmp / "opts", e)
    data, model = view(a, ctx, open="s1")
    check("Claude's models are chips, the first the one an unpinned session runs, Claude dropped from labels",
          [c["label"] for c in model["/agents/models"]][:3] == ["Fable 5.1", "Fable 5", "Opus 5.5"]
          and model["/agents/modelValue"] == "s1|claude-fable-5-1", model["/agents/models"])
    check("the chips carry no provider dot", "agents-models Chips" in " ".join(a.layout())
          and "dots=false" in next(x for x in a.layout() if "agents-models" in x))
    check("a model with no efforts known shows no effort chips", model["/agents/efforts"] == [])
    check("permission chips show the level it runs at, and nothing to switch yet",
          [c["label"] for c in model["/agents/modes"]] == ["Ask each time", "Accept edits", "Full access"]
          and model["/agents/modeValue"] == "s1|default" and model["/agents/mode"] == [], model["/agents/modes"])
    r = a.pick_model(ctx, data, {"row": "s1|claude-opus-5-5"})
    check("a model chip sets that model through realm",
          r.ok and e.writes == [("sessions.setOptions", {"id": "s1", "model": "claude-opus-5-5"})], (r, e.writes))
    r = a.pick_model(ctx, data, {"row": "s1|gpt-6-sol"})
    check("a model another agent offers is refused", not r.ok and len(e.writes) == 1, r)
    r = a.pick_model(ctx, data, {"row": "s2|claude-opus-5-5"})
    check("a chip for an agent that isn't open is refused", not r.ok and len(e.writes) == 1, r)
    data, model = view(a, ctx)
    check("its efforts come from realm's model catalog, with the model's own default first",
          [c["label"] for c in model["/agents/efforts"]] == ["Default effort", "Low", "High", "Max"]
          and model["/agents/effortValue"] == "s1|", model["/agents/efforts"])
    r = a.pick_effort(ctx, data, {"row": "s1|max"})
    check("an effort chip sets it", r.ok and e.writes[-1] == ("sessions.setOptions", {"id": "s1", "effort": "max"}),
          e.writes[-1])
    r = a.pick_effort(ctx, data, {"row": "s1|ultra"})
    check("an effort the model doesn't take is refused", not r.ok and len(e.writes) == 2, r)
    e.sessions["s1"]["model"] = "claude-sonnet-5"
    r = a.pick_effort(ctx, data, {"row": "s1|low"})
    check("an effort drawn for a model it's no longer on is refused", not r.ok and len(e.writes) == 2, r)
    e.sessions["s1"]["model"] = "claude-opus-5-5"
    data, model = view(a, ctx)
    r = a.pick_effort(ctx, data, {"row": "s1|"})
    check("Default effort clears it to the model's own", r.ok and e.writes[-1][1] == {"id": "s1", "effort": None},
          e.writes[-1])

    r = a.pick_mode(ctx, data, {"row": "s1|bypassPermissions"})
    check("a permission chip writes nothing on its own", r.ok and len(e.writes) == 3, e.writes)
    model = a.model(data, None, r.updates, ctx)
    check("it draws a Switch row saying what the agent may then do",
          model["/agents/mode"] == [{"id": "s1|default>bypassPermissions", "accent": True,
                                     "text": "Full access for Fix the rail: it runs every tool without asking you"}]
          and model["/agents/modeValue"] == "s1|bypassPermissions", model["/agents/mode"])
    e.sessions["s1"]["permissionMode"] = "acceptEdits"
    r = a.set_mode(ctx, data, {"row": "s1|default>bypassPermissions"})
    check("a switch drawn from a level it's no longer at is refused", not r.ok and len(e.writes) == 3, r)
    e.sessions["s1"]["permissionMode"] = "default"
    r = a.set_mode(ctx, data, {"row": "s1|default>bypassPermissions"})
    check("Switch sets that level through realm",
          r.ok and e.writes[-1] == ("sessions.setOptions", {"id": "s1", "permissionMode": "bypassPermissions"}),
          e.writes[-1])
    r = a.set_mode(ctx, data, {"row": "s1|default>plan"})
    check("a level realm doesn't offer is refused", not r.ok and len(e.writes) == 4, r)

    data, model = view(a, ctx, open="s2")
    check("Codex's models come from the probe, its default selected, a hidden-character id dropped",
          [c["label"] for c in model["/agents/models"]] == ["GPT-6-Sol", "GPT-6-Astra"]
          and model["/agents/modelValue"] == "s2|gpt-6-astra", model["/agents/models"])
    lines = [f"@ {a.name} at=center w={a.width}"] + a.layout() + [surfaces.data_line(k, v) for k, v in
                                                                   {**a.initial(), **model}.items()]
    check("the card with its chips is valid Kyber Lines", not tks.validate(lines), tks.validate(lines))
    check("no hidden character reaches the glass", glass_clean(model), model)
    g = FakeEngine()
    g.add_session("s9", "idle", kind="acp:gemini")
    b, bctx = world(tmp / "opts-acp", g)
    _, bmodel = view(b, bctx, open="s9")
    check("an agent realm can't set a permission level on gets no permission chips",
          bmodel["/agents/modes"] == [] and bmodel["/agents/models"] == [], bmodel["/agents/modes"])


def browser(tmp: Path) -> None:
    """The agent's browser pane as a live page inside its card, pointed only
    from a Go row that says where it loads."""
    e = FakeEngine()
    e.add_session("s1", "idle", title="Fix the rail", cwd="/Users/x/code/chewbacca")
    a, ctx = world(tmp / "web", e)
    data, model = view(a, ctx, open="s1")
    check("no pane in its space draws no page, only the address field",
          model["/agents/webUrl"] == "" and model["/agents/addressOn"] and "agents-web Web" not in " ".join(a.layout()),
          model["/agents/webUrl"])
    model = a.model(data, None, {"/agents/address": "file:///etc/passwd"}, ctx)
    check("an address that isn't http(s) offers no Go", model["/agents/go"] == [], model["/agents/go"])
    url = "http://localhost:3000/rail"
    model = a.model(data, None, {"/agents/address": url}, ctx)
    row = model["/agents/go"][0]["id"]
    check("a typed web address offers to open a pane in its space, saying so",
          row.startswith("new:sp1|") and "new browser pane" in model["/agents/go"][0]["text"], model["/agents/go"])
    r = a.go(ctx, data, {"row": row, "/agents/address": "https://evil.example"})
    check("Go with an address other than the one drawn is refused", not r.ok and e.writes == [], r)
    r = a.go(ctx, data, {"row": row, "/agents/address": url})
    check("Go opens a browser pane in the agent's space at that address",
          r.ok and e.writes == [("browsers.create", {"spaceId": "sp1", "url": url})]
          and r.updates.get("/agents/address") == "" and "localhost" not in r.line, (r, e.writes))
    bid = next(iter(e.browsers))
    e.browsers[bid]["title"] = "Rail" + BIDI
    data, model = view(a, ctx)
    layout = " ".join(a.layout())
    check("the pane draws as a live page inside the card, saying what it shows",
          model["/agents/webUrl"] == url and "agents-web Web" in layout
          and model["/agents/webHead"] == "Browser · Rail · localhost:3000", (model["/agents/webUrl"],
                                                                          model["/agents/webHead"]))
    e.browsers[bid]["title"] = "Browser"
    a._browser = None
    data, model = view(a, ctx)
    check("an untitled pane names its host once", model["/agents/webHead"] == "Browser · localhost:3000",
          model["/agents/webHead"])
    e.browsers[bid]["url"] = "javascript:alert(1)"
    a._browser = None
    data, model = view(a, ctx)
    check("an address the engine holds that isn't http(s) is never drawn", model["/agents/webUrl"] == "",
          model["/agents/webUrl"])
    url2 = "https://example.com/docs"
    model = a.model(data, None, {"/agents/address": url2}, ctx)
    row = model["/agents/go"][0]["id"]
    check("with a pane, Go points that pane", row.startswith(f"go:{bid}|") and "its browser pane" in
          model["/agents/go"][0]["text"], model["/agents/go"])
    e.browsers[bid]["spaceId"] = "sp2"
    r = a.go(ctx, data, {"row": row, "/agents/address": url2})
    check("a pane that moved to another space is refused", not r.ok and len(e.writes) == 1, r)
    e.browsers[bid]["spaceId"] = "sp1"
    r = a.go(ctx, data, {"row": row, "/agents/address": url2})
    check("Go points it there through realm",
          r.ok and e.writes[-1] == ("browsers.update", {"browserId": bid, "url": url2}), e.writes[-1])
    data, model = view(a, ctx)
    lines = [f"@ {a.name} at=center w={a.width}"] + a.layout() + [surfaces.data_line(k, v) for k, v in
                                                                   {**a.initial(), **model}.items()]
    check("the card with its page is valid Kyber Lines", not tks.validate(lines), tks.validate(lines))
    check("no hidden character reaches the glass", glass_clean(model), model)
    check("the page never opens a surface of its own", sum(x.startswith("@ ") for x in lines) == 1)


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
        e.files = ["hud/Glass.swift"]
        e.sessions["s1"]["status"] = "idle"
        a.spawn = lambda fn: None  # the search waits, as it would on its thread
        d.handle_line('v /agents/find "glass"')
        hud.take()
        a._found = {"sid": "s1", "root": "/Users/x/code/chewbacca", "query": "glass", "gen": 9,
                    "files": [{"path": "hud/Glass.swift", "segments": [{"text": "hud/Glass.swift", "match": False}]}],
                    "lines": [], "truncated": False, "source": "git", "why": ""}
        a.poke()
        lines = hud.take()
        check("a search landing on its own thread draws at once, with no fetch",
              any(x.startswith("d /agents/findFiles ") and "Glass.swift" in x for x in lines), lines)
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
        finder(tmp)
        mention_picker(tmp)
        real_repo(tmp)
        history(tmp)
        this_space(tmp)
        shipping(tmp)
        terminal(tmp)
        options(tmp)
        browser(tmp)
        untrusted(tmp)
        through_the_daemon(tmp)
        review_fixes(tmp)
        registry()
    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
