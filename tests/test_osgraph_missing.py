#!/usr/bin/env python3
"""What am I missing (CHW-204): the text rules, the walk's six findings and
the ones it must not make, every finding a valid typed edge with provenance,
the panel's nine-row cap and glance line, and the one action per row, which
drafts and never sends.

Made-up data in temp directories (tests/surfaces_fixture.py for the people
store and the fake CLIs). Nothing real is read: the hand-labeled replay of
real days is tools/missing_eval.py, and its results stay out of the repo.
"""
import json
import sqlite3
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import surfaces_fixture as fx  # noqa: E402

import osgraph  # noqa: E402
import osgraph_ingest as ingest  # noqa: E402
import osgraph_missing as M  # noqa: E402
import surface_intent  # noqa: E402
import surfaces  # noqa: E402
from osgraph import ME, Edge, Graph, Node  # noqa: E402
from surfaces import Context  # noqa: E402
from surfaces import walks as SW  # noqa: E402

failed = 0
NOW = fx.NOW  # Sun 2026-10-04 11:00 local in the fixture's zone


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


def iso(delta_h: float) -> str:
    return (NOW + timedelta(hours=delta_h)).isoformat()


# ── the text rules ───────────────────────────────────────────────────────


def rules() -> None:
    fri = datetime(2026, 10, 2, 15, 0, tzinfo=NOW.tzinfo)
    due = M.promise_due("I’ll send it tonight", fri)
    check("a curly-apostrophe promise for tonight is due 11:59pm that day",
          due is not None and due.date() == fri.date() and due.hour == 23, due)
    due = M.promise_due("ill text everyone individually tmr", fri)
    check("'tmr' is the next day", due is not None and due.date() == fri.date() + timedelta(days=1), due)
    check("a resolution to himself is not a promise",
          M.promise_due("Moving forwards I'm going to make it a goal to finish most work before friday", fri) is None)
    check("no day word, no promise", M.promise_due("I'll send it", fri) is None)
    check("a long paste with a verb and a day is not a promise", M.promise_due("I'll send " + "x " * 100 + "today", fri)
          is None)
    when = M.announced_at("Practice tmr at 6", fri)
    check("'practice tmr at 6' is 6pm the next day",
          when is not None and when.date() == fri.date() + timedelta(days=1) and when.hour == 18, when)
    check("an open invitation is not an announcement",
          M.announced_at("Anyone down for breakfast tomorrow at 8 am?", fri) is None)
    check("a time already past is not an announcement", M.announced_at("meeting today at 9am", fri) is None)
    check("a second-person question asks", M.asks("u free tmr"))
    check("'I'm free tmrw' answers, it doesn't ask", not M.asks("Yeah I’m free tmrw"))
    check("a link's ?si= is not a question", not M.asks("https://open.spotify.com/track/1?si=abc"))
    check("a tapback never asks", not M.asks("Loved “what time?”"))


# ── the walk ─────────────────────────────────────────────────────────────


class G:
    """A graph built by hand, one fact per call."""

    def __init__(self):
        self.g = Graph(":memory:")
        self.nodes = {ME: osgraph.me_node()}
        self.edges = []

    def node(self, nid, type_, label, props=None, unresolved=False, confidence=1.0):
        self.nodes[nid] = Node(nid, type_, label, props or {}, confidence, unresolved)
        return nid

    def edge(self, src, verb, dst, confidence=1.0, **props):
        self.edges.append(Edge(src, verb, dst, props=props, confidence=confidence))

    def thread(self, key, person, label, waited_h, newest, asks=True, unresolved=False):
        pid = self.node(f"person:{key}", "Person", label, unresolved=unresolved)
        tid = self.node(f"thread:imessage:+1555{key}", "Thread", label,
                        {"app": "Messages", "group": False, "reply_to": f"+1555{key}"})
        self.edge(tid, "PARTICIPANT", pid)
        mid = self.node(f"message:imessage:{key}", "Message", newest,
                        {"from_me": False, "at": iso(-waited_h), "asks": asks})
        self.edge(mid, "IN_THREAD", tid)
        self.edge(mid, "SENT_BY", pid)
        self.edge(tid, "AWAITS_REPLY_FROM", ME, confidence=0.9, since=iso(-waited_h))
        return tid, pid

    def event(self, key, label, start_h, end_h, others=1, attendee=None):
        eid = self.node(f"event:{key}", "Event", label, {"start": iso(start_h), "end": iso(end_h), "others": others})
        day = self.node(f"day:{(NOW + timedelta(hours=start_h)).date().isoformat()}", "Day", "d")
        self.edge(eid, "DUE_ON", day)
        self.edge(ME, "ATTENDS", eid)
        if attendee:
            self.edge(attendee, "ATTENDS", eid)
        return eid

    def assignment(self, key, course, name, type_, days):
        aid = self.node(f"assignment:{key}", "Assignment", f"{course} {name}",
                        {"course": course, "name": name, "type": type_, "status": "todo"})
        day = (NOW + timedelta(days=days)).date().isoformat()
        self.node(f"day:{day}", "Day", day)
        self.edge(aid, "OWED_BY", ME)
        self.edge(aid, "DUE_ON", f"day:{day}")
        return aid

    def build(self):
        self.g.apply("seed", list(self.nodes.values()), self.edges)
        return self.g


def world():
    w = G()
    late, _ = w.thread("ann", "Annie", "Annie Long", 30, "Have u experienced that?")
    w.thread("brae", "Braeden", "Braeden Ko", 30, "Yeah I'm free tmrw", asks=False)
    w.thread("unk", "x", "+15625550199", 30, "u free tmr?", unresolved=True)
    w.thread("fresh", "Fresh", "Fresh Person", 3, "u free tmr?")
    meet_thread, tommy = w.thread("tom", "Tommy", "Tommy Endashaw", 10, "Village?")
    w.event("breakfast", "Breakfast w Tommy", 5, 6, attendee=tommy)
    a = w.event("call-a", "Call with Sagar", 26, 27)
    b = w.event("call-b", "Interview", 26.5, 27.5)
    w.event("block", "Lock in", 26, 28, others=0)
    w.assignment("draft", "WRIT 150", "WP2 Rough Draft", "ancillary", 2)
    w.assignment("read", "WRIT 150", "Read Stedman", "reading", 1)
    w.assignment("other-read", "ACAD 185", "Read Ries", "reading", 1)
    t1 = w.node("task:imessage:promise:p1", "Task", "I'll send it tonight",
                {"kind": "commitment", "due_at": iso(-20), "followed_at": "", "provenance": "your text to Annie"},
                confidence=0.6)
    w.node("task:imessage:promise:p2", "Task", "I'll call him today",
           {"kind": "commitment", "due_at": iso(-20), "followed_at": iso(-15), "provenance": "kept"}, confidence=0.6)
    pm = w.node("message:imessage:pm", "Message", "I'll send it tonight", {"from_me": True, "at": iso(-40)})
    w.edge(pm, "IN_THREAD", late)
    w.edge(t1, "EXTRACTED_FROM", pm)
    gid = w.node("thread:imessage:chat9", "Thread", "Amber core", {"group": True})
    ann = w.node("message:imessage:an1", "Message", "Practice tmr at 6", {"from_me": False, "at": iso(-2),
                                                                         "announces": iso(30)})
    w.edge(ann, "IN_THREAD", gid)
    covered = w.node("message:imessage:an2", "Message", "Call tmr at 2", {"from_me": False, "at": iso(-2),
                                                                         "announces": iso(26.2)})
    w.edge(covered, "IN_THREAD", gid)
    return w.build(), {"late": late, "meet_thread": meet_thread, "a": a, "b": b, "t1": t1, "ann": ann}


def walk() -> None:
    g, ids = world()
    out = M.missing(g, NOW)
    found = [(r["kind"], r["id"], r["target"]) for r in out["rows"]]
    kinds = {r["kind"] for r in out["rows"]}
    check("an ask from a saved contact waiting a day is a late reply",
          ("late", ids["late"], f"day:{(NOW - timedelta(hours=30)).date().isoformat()}") in found, found)
    check("a newest message that doesn't ask is never late",
          not any(r["id"] == "thread:imessage:+1555brae" for r in out["rows"]))
    check("an unsaved number is never a late reply", not any(r["id"] == "thread:imessage:+1555unk" for r in out["rows"]))
    check("three hours is not late", not any(r["id"] == "thread:imessage:+1555fresh" for r in out["rows"]))
    check("a meeting with someone whose ask is unanswered is BLOCKED_BY their thread",
          ("blocked", "event:breakfast", ids["meet_thread"]) in found, found)
    check("that thread is not listed again as a late reply",
          sum(1 for r in out["rows"] if ids["meet_thread"] in (r["id"], r["target"])) == 1)
    check("two invites with other people that overlap conflict, once",
          sum(1 for k, s, t in found if k == "conflict") == 1
          and any(k == "conflict" and {s, t} == {ids["a"], ids["b"]} for k, s, t in found), found)
    check("a block he set for himself never conflicts",
          not any("event:block" in (s, t) for k, s, t in found if k == "conflict"))
    check("an assignment due soon is BLOCKED_BY its course's open reading",
          ("blocked", "assignment:draft", "assignment:read") in found, found)
    check("another course's reading is not its prerequisite",
          ("blocked", "assignment:draft", "assignment:other-read") not in found)
    check("his promise past due with nothing since has LAPSED",
          any(k == "lapsed" and s == ids["t1"] for k, s, t in found), found)
    check("a promise he followed up on has not lapsed",
          not any(s == "task:imessage:promise:p2" for k, s, t in found))
    check("a group meeting with nothing near it on the calendar is ANNOUNCED",
          any(k == "announced" and s == ids["ann"] for k, s, t in found), found)
    check("one with a calendar event within two hours is not",
          not any(s == "message:imessage:an2" for k, s, t in found))
    check("every kind the fixture sets up is found", kinds == {"late", "blocked", "conflict", "lapsed", "announced"},
          kinds)
    blocked = [r for r in out["rows"] if r["kind"] == "blocked"]
    order = [r["kind"] for r in out["rows"]]
    check("worst first: blocked before conflict before lapsed before late before announced",
          order == sorted(order, key=lambda k: M.KIND_ORDER[k]), order)
    stored = g.edges(verb="BLOCKED_BY") + g.edges(verb="CONFLICTS_WITH") + g.edges(verb="LAPSED_ON") + \
        g.edges(verb="ANNOUNCES") + g.edges(verb="OVERDUE_SINCE")
    check("each finding is written as one typed edge", len(stored) == out["count"], (len(stored), out["count"]))
    check("every finding edge carries provenance and a confidence",
          all(e["props"].get("provenance") and 0 < e["confidence"] <= 1 and e["source"] == "missing" for e in stored))
    check("the graph still validates against the ontology", g.validate() == [], g.validate())
    M.missing(g, NOW)
    check("a second pass replaces the first, it doesn't pile up",
          len(g.edges(verb="BLOCKED_BY")) == len([r for r in out["rows"] if r["kind"] == "blocked"]))
    guesses = [SW.row_text(r) for r in out["rows"] if r["confidence"] < M.GUESS_BELOW]
    check("a guess says it is a guess", guesses and all(t.endswith("(guess)") for t in guesses), guesses)
    check("a blocked meeting's row acts on the thread it waits on",
          any(r["act_on"] == ids["meet_thread"] and r["act_type"] == "Thread" for r in blocked))
    check("refuses a finding edge between the wrong types",
          raises(lambda: g.apply("bad", [], [Edge("event:call-a", "CONFLICTS_WITH", "assignment:read")])))


def raises(fn) -> bool:
    try:
        fn()
    except osgraph.OntologyError:
        return True
    return False


def cap() -> None:
    w = G()
    for i in range(12):
        w.thread(f"p{i}", f"P{i}", f"Person {i}", 30 + i, "when are you free?")
    g = w.build()
    out = M.missing(g, NOW)
    check("twelve findings, nine rows", out["count"] == 12 and len(out["rows"]) == 9, (out["count"], len(out["rows"])))
    check("the longest wait is first", out["rows"][0]["id"] == "thread:imessage:+1555p11", out["rows"][0]["id"])


# ── the ingester: promises, announcements, and nothing after `now` ──────


def chat(path: Path) -> Path:
    db = sqlite3.connect(path)
    db.executescript("""
    CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, chat_identifier TEXT, display_name TEXT, style INTEGER);
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
    CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);
    CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
    CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, attributedBody BLOB,
      is_from_me INTEGER, date INTEGER, is_read INTEGER, handle_id INTEGER, item_type INTEGER DEFAULT 0,
      associated_message_type INTEGER DEFAULT 0);
    """)
    db.executemany("INSERT INTO handle VALUES (?, ?)", [(1, "+16305550101"), (2, "+14085550102")])
    db.executemany("INSERT INTO chat VALUES (?, ?, ?, ?)", [(1, "+16305550101", "", 45), (2, "chat9", "Amber core", 43)])
    db.executemany("INSERT INTO chat_handle_join VALUES (?, ?)", [(1, 1), (2, 1), (2, 2)])
    msgs = [
        (1, 0, 1, -50, "Can you send me the terms?"),
        (1, 1, 0, -49.99, "I’ll send it tonight"),
        (1, 1, 0, -49.98, "gotta run"),  # the same burst: not a follow-up
        (2, 0, 2, -3, "Standup tmr at 9am"),
        (1, 0, 1, +5, "this arrives after now and must not be read"),
    ]
    for i, (c, me, h, hours, text) in enumerate(msgs, 1):
        db.execute("INSERT INTO message (ROWID, guid, text, is_from_me, date, is_read, handle_id) VALUES "
                   "(?, ?, ?, ?, ?, 1, ?)", (i, f"M{i}", text, me, fx.apple(NOW + timedelta(hours=hours)), h))
        db.execute("INSERT INTO chat_message_join VALUES (?, ?)", (c, i))
    db.commit()
    db.close()
    return path


def ingester(tmp: Path) -> None:
    ctx = Context(run=fx.FakeRun(), now=lambda: NOW, home=tmp, sleep=lambda s: None,
                  env={"KYBER_SURFACES_CHAT_DB": str(chat(tmp / "chat.db"))})
    g = Graph(tmp / "g.sqlite")
    ids = osgraph.Identities(fx.people_db(tmp / "people.db"))
    ingest.imessage(g, ctx, ids, days=7)
    labels = [n["label"] for n in g.nodes("Message")]
    check("a message after `now` is never read", not any("after now" in x for x in labels), labels)
    tasks = [t for t in g.nodes("Task") if t["props"].get("kind") == "commitment"]
    check("his promise becomes a commitment Task, a guess", len(tasks) == 1 and tasks[0]["confidence"] < M.GUESS_BELOW,
          tasks)
    check("the line he sent the same minute is not a follow-up", tasks and tasks[0]["props"]["followed_at"] == "",
          tasks[0]["props"] if tasks else None)
    check("the commitment is owed to the person in the thread",
          tasks and any(p["id"] == f"person:{fx.SAGAR}" for p in g.out(tasks[0]["id"], "OWED_TO")))
    ann = [m for m in g.nodes("Message") if m["props"].get("announces")]
    check("a group text naming a meeting and a time is an announcement", len(ann) == 1, ann)
    check("an inbound message records whether it asks",
          any(m["props"].get("asks") is True for m in g.nodes("Message")))
    check("the ingest still validates", g.validate() == [], g.validate())
    out = M.missing(g, NOW)
    check("on the real ingest, the promise lapsed and the standup is not on the calendar",
          {r["kind"] for r in out["rows"]} >= {"lapsed", "announced"}, [r["kind"] for r in out["rows"]])


# ── the panel ────────────────────────────────────────────────────────────


class Run(fx.FakeRun):
    def __init__(self):
        super().__init__()
        self.added = []

    def __call__(self, argv):
        argv = [str(a) for a in argv]
        if Path(argv[0]).name == "people" and argv[1:4] == ["texts", "drafts", "add"]:
            self.calls.append(argv)
            return 0, f"drafted #7 to {argv[4]}\n", ""
        if argv[:3] == ["mac", "calendar", "add"]:
            self.calls.append(argv)
            self.added.append(argv[3])
            return 0, "{}", ""
        if argv[:3] == ["mac", "calendar", "list"]:
            self.calls.append(argv)
            return 0, json.dumps([{"title": t} for t in self.added]), ""
        if Path(argv[0]).name == "chewbacca" and argv[1:3] in (["google", "find"], ["docs", "find"]):
            self.calls.append(argv)
            if argv[1] == "google":
                return 0, json.dumps([{"id": "1" * 30, "kind": "doc", "name": "Read Stedman",
                                       "modified": "2026-10-03T10:00:00Z"}]), ""
            return 0, "[]", ""
        return super().__call__(argv)


def panel(tmp: Path) -> None:
    g, ids = world()
    run = Run()
    chatdb = tmp / "panel-chat.db"
    db = sqlite3.connect(chatdb)
    db.executescript("""
    CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, chat_identifier TEXT, display_name TEXT, style INTEGER);
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
    CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);""")
    for i, key in enumerate(("ann", "tom"), 1):
        db.execute("INSERT INTO handle VALUES (?, ?)", (i, f"+1555{key}"))
        db.execute("INSERT INTO chat VALUES (?, ?, '', 45)", (i, f"+1555{key}"))
        db.execute("INSERT INTO chat_handle_join VALUES (?, ?)", (i, i))
    db.commit()
    db.close()
    ctx = Context(run=run, now=lambda: NOW, home=tmp, sleep=lambda s: None, env={"KYBER_SURFACES_CHAT_DB": str(chatdb)})
    ctx.graph = g
    p = surfaces.make("missing")
    check("'missing' is a surface kind and 'what-am-i-missing' finds it",
          surfaces.resolve("what-am-i-missing") == "missing" and isinstance(p, SW.Missing))
    lines = p.layout()
    check("the panel is a glance: a click off it closes it", lines[0] == "glance missing", lines[:1])
    data = p.fetch(ctx)
    model = p.model(data, None, {}, ctx)
    check("nine rows at most", len(model["/missing/rows"]) <= 9)
    check("the caption counts each kind", "not ready" in model["/missing/caption"], model["/missing/caption"])
    rows = data["rows"]
    by = {r["kind"]: r for r in rows}
    check("a reply row's one action is a draft", p.go_for(by["late"]) == "Draft reply")
    check("an assignment row's one action opens the doc", p.go_for(by["blocked"] if by["blocked"]["act_type"] ==
                                                                   "Assignment" else next(
        r for r in rows if r["act_type"] == "Assignment")) == "Open the doc")
    check("an announcement's one action is a calendar draft", p.go_for(by["announced"]) == "Add to calendar as a draft")
    pick = {p.p("pick"): by["late"]["pick"], p.p("draft"): ""}
    res = p.act(ctx, data, pick)
    check("no typed words, no draft and no call", not res.ok and not run.calls, res.line)
    pick[p.p("draft")] = "Yeah, a while back. Call this week?"
    res = p.act(ctx, data, pick)
    drafted = [c for c in run.calls if Path(c[0]).name == "people"]
    check("a typed reply goes to people texts drafts, to the thread's own handle",
          res.ok and drafted and drafted[-1][4] == "Annie Long" and "--to" in drafted[-1]
          and drafted[-1][drafted[-1].index("--to") + 1] == "+1555ann", (res.line, drafted))
    check("and nothing was sent", not run.sent, run.sent)
    res = p.act(ctx, data, {p.p("pick"): by["announced"]["pick"]})
    check("an announced meeting lands on the calendar as a Draft and is read back",
          res.ok and run.added and run.added[0].startswith("Draft: "), (res.line, run.added))
    assignment = next(r for r in rows if r["act_type"] == "Assignment")
    res = p.act(ctx, data, {p.p("pick"): assignment["pick"]})
    check("an assignment row opens its doc on the doc surface",
          res.ok and res.opens == "doc" and res.preset.get("/doc/want") == "g:" + "1" * 30, (res.line, res.preset))
    res = p.pivot(ctx, data, {"row": "event:breakfast"})
    check("a press on the meeting row opens the person", res.opens == "person", (res.opens, res.line))
    res = p.act(ctx, data, {p.p("pick"): "a row that is not there"})
    check("a pick that no longer matches does nothing", not res.ok)
    check("'what am I missing' opens it and 'close the missing' closes it",
          surface_intent.parse("What am I missing?") == surface_intent.Command("open", "missing")
          and surface_intent.parse("close the missing") == surface_intent.Command("close", "missing"))


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        rules()
        walk()
        cap()
        (tmp / "i").mkdir()
        ingester(tmp / "i")
        (tmp / "p").mkdir()
        panel(tmp / "p")
    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
