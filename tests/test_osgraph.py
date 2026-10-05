#!/usr/bin/env python3
"""The OS graph: the ontology refuses bad edges, fusion only merges through the
people store, the reply rule holds on the pilot's misses, and the three
competency questions are answered by walks.

All fixture data (tests/surfaces_fixture.py); nothing real is read.

PILOT NOTES (2026-10-04, Caleb's real chat.db, hand-judged, kept out of the
fixtures). AWAITS_REPLY_FROM(Thread -> me):
  rule 1, newest message theirs and not a closer: 6/30 on a 7-day sample (20%)
  rule 2, the inbound burst must ask something:   12/14 in-sample
  rule 2, held-out 30-day sample:                 3/12 (group threads 0/5)
  rule 3, groups need his name, automated texts:  8/12 on a held-out 90-day sample
  rule 4, unsaved number + 140+ chars is a blast: fixes the 3 automated misses
          on that sample after the fact; not yet measured on unseen threads.
The cases below are the misses each rule was written against.
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import surfaces_fixture as fx  # noqa: E402

import osgraph  # noqa: E402
import osgraph_ingest as ingest  # noqa: E402
import osgraph_walks as W  # noqa: E402
from osgraph import ME, Edge, Graph, Node, OntologyError  # noqa: E402

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


def raises(fn, kind=Exception) -> bool:
    try:
        fn()
    except kind:
        return True
    return False


def ontology() -> None:
    g = Graph(":memory:")
    nodes = [Node("person:a", "Person", "A"), Node("thread:t", "Thread", "T"), Node("day:2026-10-05", "Day", "d"),
             Node("task:x", "Task", "X"), Node("space:s", "Space", "S")]
    g.apply("seed", nodes, [Edge("thread:t", "PARTICIPANT", "person:a")])
    check("a valid edge is stored", len(g.edges(verb="PARTICIPANT")) == 1)
    bad = [
        ("an edge whose range is wrong", Edge("task:x", "DUE_ON", "person:a")),
        ("an edge whose domain is wrong", Edge("person:a", "AWAITS_REPLY_FROM", "person:a")),
        ("SENT_BY from a Thread", Edge("thread:t", "SENT_BY", "person:a")),
        ("BELONGS_TO a Person", Edge("task:x", "BELONGS_TO", "person:a")),
        ("a verb not in the ontology", Edge("task:x", "RELATED_TO", "space:s")),
        ("an edge to a node that doesn't exist", Edge("task:x", "OWED_BY", "person:ghost")),
    ]
    for name, edge in bad:
        check(f"refuses {name}", raises(lambda e=edge: g.apply("bad", [], [e]), OntologyError))
    check("a refused snapshot writes nothing, not half",
          not g.edges(src="task:x") and raises(lambda: g.apply("seed", nodes, [
              Edge("task:x", "OWED_BY", "person:a"), Edge("task:x", "DUE_ON", "person:a")]), OntologyError)
          and not g.edges(src="task:x"))
    check("the seed edge survived the refused snapshot", len(g.edges(verb="PARTICIPANT")) == 1)
    check("an unknown node type is refused", raises(lambda: g.apply("x", [Node("q:1", "Widget", "w")], []),
                                                    OntologyError))
    check("a node id needs its kind prefix", raises(lambda: g.apply("x", [Node("nokind", "Person", "w")], []),
                                                     OntologyError))
    check("validate() is clean on a clean graph", g.validate() == [], g.validate())
    g.db.execute("INSERT INTO edges VALUES ('task:x', 'DUE_ON', 'person:a', '{}', 'sneak', 'now', 1.0)")
    check("validate() finds an edge written around the checks", len(g.validate()) == 1, g.validate())


def fusion(tmp: Path) -> None:
    ids = osgraph.Identities(fx.people_db(tmp / "people.db"))
    a = osgraph.person_node(ids, "+16305550101")
    b = osgraph.person_node(ids, "(630) 555-0101")
    c = osgraph.person_node(ids, "sagar@amber.example")
    check("a phone in two formats and an email are ONE person, via the people store",
          a.id == b.id == c.id == f"person:{fx.SAGAR}" and not a.unresolved, (a.id, b.id, c.id))
    law, larsen = osgraph.person_node(ids, "+16265550103"), osgraph.person_node(ids, "+16265550104")
    check("Tyler Law and Tyler Larsen stay two people", law.id != larsen.id and "Law" in law.label
          and "Larsen" in larsen.label, (law.id, larsen.id))
    stranger = osgraph.person_node(ids, "+15625550199", label="+15625550199")
    check("an unsaved number is its own node, flagged unresolved",
          stranger.unresolved and stranger.id == "person:handle:5625550199", stranger)
    owners = ingest.owner_people("Caleb + Tyler", ids, "Caleb")
    check("a backlog first name never resolves to one of two Tylers",
          owners[0].id == ME and owners[1].unresolved and owners[1].id == "person:name:tyler", owners)
    shared = tmp / "shared.db"
    fx.people_db(shared)
    import sqlite3
    db = sqlite3.connect(shared)
    db.execute("INSERT INTO identities VALUES (?, 'phone', '+1 (626) 555-0103 ')", (fx.TYLER_LARSEN,))
    db.commit()
    db.close()
    both = osgraph.Identities(shared)
    check("a number two people both claim resolves to nobody", both.resolve("6265550103") is None)


def reply_rule() -> None:
    cases = [
        ("a statement", ["Sounds like you have a cold"], "+13105550105", False, True, False),
        ("a sign-off", ["Fs bro"], "+13105550105", False, True, False),
        ("a closer with an emoji", ["Yessir 🫡"], "+13105550105", False, True, False),
        ("a question", ["U doing ship fund?"], "+15625550199", False, False, True),
        ("an ask with no question mark", ["call me when you got a second"], "+16265550104", False, True, True),
        ("an invitation", ["You me and your dad should go see a game"], "+13105550000", False, True, True),
        ("a bank short code", ["Enter code 123?"], "93557", False, False, False),
        ("a relay handle", ["Have you heard about this plan?"], "+12095820205(smsfp)", False, False, False),
        ("a link's query string", ["https://facebook.com/share/v/1B?mibextid=x"], "+13105550000", False, True, False),
        ("a group asking the room", ["Guys can we go to the game"], "chat900123", True, True, False),
        ("a group naming him", ["Caleb can you add sagar to the call?"], "chat900123", True, True, True),
        ("a long text from an unsaved number", ["Hi Caleb, I'm running for the board and wanted to reach out "
                                                "about the election next month because your vote matters and "
                                                "I would love to hear what you think about it?"], "+1626", False,
         False, False),
        ("a tapback", ["Loved “see you then”"], "+13105550000", False, True, False),
        ("nothing since my own message", [], "+13105550000", False, True, False),
    ]
    for name, burst, handle, group, known, want in cases:
        got = ingest.awaits_me(burst, handle, group, known)
        check(f"awaits me: {name} -> {want}", got == want, got)


def ingested(tmp: Path) -> None:
    g, ctx, run, report = fx.world(tmp)
    check("every fixture source ingests (calendar's error is reported, not raised)",
          all("error" not in v for k, v in report.items() if k != "calendar") and "error" in report["calendar"],
          report)
    check("the ingested graph passes the ontology", g.validate() == [], g.validate()[:3])
    sagar = f"person:{fx.SAGAR}"
    sources = {n["type"] for n in g.into(sagar, "SENT_BY")}
    check("Sagar's text and Sagar's email hang off ONE node", sources == {"Message", "MailItem"}, sources)
    check("the iMessage and SMS rows of one conversation are one Thread",
          len([t for t in g.nodes("Thread") if t["props"]["handle"] == "+16305550101"]) == 1)
    waiting = {e["src"] for e in g.edges(verb="AWAITS_REPLY_FROM", dst=ME)}
    want = {"thread:imessage:+16305550101", "thread:imessage:+16265550104", "thread:imessage:+15625550199",
            "mail:m1"}
    check("AWAITS_REPLY_FROM me is exactly the asks", waiting == want, sorted(waiting))
    check("the injection text waits on no one and became no task",
          "thread:imessage:+13105550105" not in waiting
          and not any("ignore previous" in t["label"].lower() for t in g.nodes("Task")))
    check("the automated mail is not waiting on him", "mail:m2" not in waiting)
    check("a link is stored as text, rendered later", any("github.com" in n["label"] for n in g.nodes("MailItem")))
    asks = [t for t in g.nodes("Task") if t["props"].get("kind") == "request"]
    check("a request in a text becomes a guessed Task with provenance",
          any(t["props"]["guess"] and t["props"]["provenance"].startswith("from Sagar Tiwari's text") for t in asks),
          [t["props"] for t in asks])
    check("nothing was sent while ingesting", run.sent == [], run.sent)

    owe = W.owed_to(g, ctx.ids, "Sagar Tiwari")
    labels = sorted(n["label"] for n in owe)
    check("CQ1 what do I owe Sagar: the promise, the extracted ask, and his thread",
          "Send Sagar the terms one-pager" in labels and any("terms by Monday" in x for x in labels)
          and any(n["type"] == "Thread" for n in owe), labels)
    longest = W.waiting_longest(g)
    check("CQ2 who's waiting on me longest: oldest first",
          [n["id"] for n, _ in longest][:1] == ["thread:imessage:+15625550199"], [n["id"] for n, _ in longest])
    before = [n["label"] for n in W.due_before(g, "ACAD 324 Midterm")]
    check("CQ3 what's due before the ACAD 324 midterm, soonest first",
          before == ["BISC 101 Lab 2 post-lab", "Pick up the package", "Send Sagar the terms one-pager",
                     "WRIT 150 WP2 draft", "Prep before midterm"], before)
    check("CQ3 refuses an anchor it can't name exactly", raises(lambda: W.due_before(g, "midterm"), LookupError))

    check("person: a full name finds the people-store person",
          W.find_person(g, ctx.ids, "Karthik Devarakonda")[0] == f"person:{fx.KARTHIK}")
    check("person: a nickname from the people store works", W.find_person(g, ctx.ids, "Mom")[0] == f"person:{fx.MOM}")
    check("person: a unique first name works, and says so",
          W.find_person(g, ctx.ids, "Karthik") == (f"person:{fx.KARTHIK}",
                                                    "first name, the only one you're in touch with"))
    check("person: two Tylers is a question, never a guess", raises(lambda: W.find_person(g, ctx.ids, "Tyler"),
                                                                    W.Ambiguous))
    p = W.person(g, ctx.ids, "Sagar Tiwari", fx.NOW)
    kinds = {r["type"] for r in p["rows"]}
    check("person Sagar spans texts, mail and tasks", {"Thread", "MailItem", "Task"} <= kinds, kinds)
    check("the backlog's bare 'Sagar' rides along marked unconfirmed",
          any("unconfirmed" in r["why"] for r in p["rows"]), [r["why"] for r in p["rows"]])

    n = W.needs_you(g, fx.NOW)
    tiers = [r["tier"] for r in n["rows"]]
    check("needs-you ranks blocked, then due, then FYI", tiers == sorted(tiers), tiers)
    check("needs-you leads with the oldest blocked thing, the overdue lab",
          n["rows"][0]["id"] == "assignment:bisc-101:lab-2-post-lab", n["rows"][0]["id"])
    threads = [r["id"] for r in n["rows"] if r["type"] == "Thread"]
    check("among threads, the longest-waiting leads", threads[:1] == ["thread:imessage:+15625550199"], threads)
    check("needs-you counts what is blocked or due for the badge", n["count"] >= 6, n["count"])
    t = W.today(g, fx.NOW)
    check("today holds what is due today and what is overdue",
          any("Lab 2" in r["label"] for r in t["rows"]), [r["label"] for r in t["rows"]])
    labels_today = [r["label"] for r in t["rows"]]
    check("a reminder due today is on today, a two-year-old one is not",
          "Pick up the package" in labels_today and "lock from high school" not in labels_today, labels_today)
    sp = W.space(g, "amber", fx.NOW)
    check("the amber space holds the backlog's decision", any(r["label"] == "Set written terms" for r in sp["rows"]),
          [r["label"] for r in sp["rows"]])
    lanes = W.tasks(g, {}, fx.NOW)
    check("tasks: asks and promises are Ready, nothing Cooking without a run",
          lanes["counts"]["ready"] >= 2 and lanes["counts"]["cooking"] == 0, lanes["counts"])
    first = lanes["lanes"]["ready"][0]
    lanes = W.tasks(g, {first["id"]: {"status": "cooking"}}, fx.NOW)
    check("tasks: a live run moves its task to Cooking", lanes["counts"]["cooking"] == 1, lanes["counts"])
    lanes = W.tasks(g, {first["id"]: {"status": "stuck", "why": "exited 1"}}, fx.NOW)
    check("tasks: a failed run is Stuck, with why", lanes["lanes"]["stuck"][0]["run"]["why"] == "exited 1")
    pp = W.people(g, ctx.ids)
    check("people ranks resolved people by score before unresolved ones",
          pp["rows"][0]["label"] in ("Cathy Newton", "Sagar Tiwari") and pp["rows"][-1]["unresolved"],
          [(r["label"], r["unresolved"]) for r in pp["rows"]])
    cv = W.conversations(g, fx.NOW)
    check("conversations: N to act on counts the waiting threads and mail", cv["to_act"] == 4, cv["to_act"])

    # Snapshot replace: a reply clears the edge on the next pass.
    db = __import__("sqlite3").connect(ctx.env["KYBER_SURFACES_CHAT_DB"])
    db.execute("INSERT INTO message (ROWID, guid, text, is_from_me, date, is_read, handle_id) VALUES "
               "(99, 'G99', 'yes, Monday', 1, ?, 1, 0)", (fx.apple(fx.NOW),))
    db.execute("INSERT INTO chat_message_join VALUES (1, 99)")
    db.commit()
    db.close()
    ingest.imessage(g, ctx, ctx.ids, days=7)
    check("after a reply, the next ingest drops AWAITS_REPLY_FROM",
          not any(e["src"] == "thread:imessage:+16305550101" for e in g.edges(verb="AWAITS_REPLY_FROM", dst=ME)))


def main() -> int:
    ontology()
    reply_rule()
    with tempfile.TemporaryDirectory() as d:
        fusion(Path(d))
    with tempfile.TemporaryDirectory() as d:
        ingested(Path(d))
    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
