#!/usr/bin/env python3
"""Waiting on you (CHW-135): the classes the dev set found wrong, the label
the eval scores against, and that the eval asks the same question the
ingester does.

All fixture data; nothing real is read. Each case is a failure class from
tools/needs_you_eval.py's dev run (2026-10-10):
  his tapback after their ask            12 wrong snapshot rows
  answered in a 1:1 or by phone          9
  a megaphone announcement from a list   12
"""
import sqlite3
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import surfaces_fixture as fx  # noqa: E402

sys.path.insert(0, str(fx.ROOT / "tools"))
import ingest_whatsapp as WA  # noqa: E402
import needs_you_eval as E  # noqa: E402
import osgraph  # noqa: E402
import osgraph_ingest as ingest  # noqa: E402
from osgraph import ME  # noqa: E402

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


T0 = fx.NOW - timedelta(hours=6)


def msg(from_me, text, reaction=False, mins=0, handle="+16305550101"):
    return {"from_me": from_me, "text": text, "reaction": reaction, "handle": "" if from_me else handle,
            "at": T0 + timedelta(minutes=mins)}


def rule_cases() -> None:
    ask = msg(False, "Can you send me the terms?", mins=0)
    cases = [
        ("their ask, nothing since", [ask], True),
        ("his tapback after their ask is his move", [msg(True, "Loved", True, 5), ask], False),
        ("their tapback after his reply does not reopen it",
         [msg(False, "Loved", True, 9), msg(True, "sent", mins=5), ask], False),
        ("their tapback after their ask is skipped", [msg(False, "Liked", True, 5), ask], True),
        ("their ask after his tapback waits", [msg(False, "Can you call me?", mins=9), msg(True, "Loved", True, 5)],
         True),
        ("a megaphone announcement is a list, not a person",
         [msg(False, "\U0001F4E2 Are you coming to the retreat? RSVP below")], False),
    ]
    for name, view, want in cases:
        got = ingest.thread_awaits_me(view, "+16305550101", False, True)
        check(f"thread_awaits_me: {name}", got == want, got)
    got = ingest.thread_awaits_me([ask], "+16305550101", False, True, reached_after=lambda at, who: True)
    check("thread_awaits_me: answered somewhere else after their ask", got is False, got)
    seen = []
    ingest.thread_awaits_me([msg(False, "Caleb can you add sagar?", handle="+14085550102"),
                             msg(False, "anyone?", handle="+16265550104")], "chat1", True, True,
                            reached_after=lambda at, who: seen.append(set(who)) or False)
    check("reached_after is asked about every sender in the burst",
          seen == [{"+14085550102", "+16265550104"}], seen)


def chat_db(path: Path) -> Path:
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
    handles = {1: "+16305550101", 2: "+14085550102", 4: "+16265550104", 5: "+13105550105", 6: "+15625550199"}
    db.executemany("INSERT INTO handle VALUES (?, ?)", list(handles.items()))
    chats = [(1, "+16305550101", "", 45, [1]),   # Sagar asks, he Loves it
             (2, "+14085550102", "", 45, [2]),   # Karthik asks: the one row
             (3, "chat777", "TTS", 43, [4, 2]),  # Tyler names him in a group ...
             (4, "+16265550104", "", 45, [4]),   # ... and he answers Tyler 1:1
             (5, "+13105550105", "", 45, [5]),   # Mom asks, he calls her
             (6, "+15625550199", "", 45, [6])]   # a megaphone list text
    for rowid, ident, display, style, members in chats:
        db.execute("INSERT INTO chat VALUES (?, ?, ?, ?)", (rowid, ident, display, style))
        for h in members:
            db.execute("INSERT INTO chat_handle_join VALUES (?, ?)", (rowid, h))
    msgs = [  # (chat, from_me, handle, minutes after T0, text, associated type)
        (1, 0, 1, 0, "Can you send me the terms?", 0),
        (1, 1, 0, 20, "Loved “Can you send me the terms?”", 2000),
        (2, 0, 2, 5, "can you review the deck tonight?", 0),
        (3, 0, 4, 10, "Caleb can you post the RSO form?", 0),
        (4, 1, 0, 40, "posting it now", 0),
        (5, 0, 5, 15, "Are you coming home this weekend?", 0),
        (6, 0, 6, 15, "\U0001F4E2 Are you coming to the retreat?", 0),
    ]
    for i, (chat, me, h, mins, text, assoc) in enumerate(msgs, 1):
        db.execute("INSERT INTO message (ROWID, guid, text, is_from_me, date, is_read, handle_id, "
                   "associated_message_type) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
                   (i, f"G{i}", text, me, fx.apple(T0 + timedelta(minutes=mins)), h, assoc))
        db.execute("INSERT INTO chat_message_join VALUES (?, ?)", (chat, i))
    db.commit()
    db.close()
    return path


def call_history(home: Path) -> None:
    path = home / ingest.CALL_HISTORY
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.execute("CREATE TABLE ZCALLRECORD (ZADDRESS TEXT, ZDATE REAL, ZANSWERED INTEGER, ZORIGINATED INTEGER, "
               "ZDURATION REAL)")
    at = (T0 + timedelta(minutes=50) - fx.APPLE_EPOCH).total_seconds()
    db.execute("INSERT INTO ZCALLRECORD VALUES ('+13105550105', ?, 1, 1, 240.0)", (at,))
    # A missed call from someone who never asked anything: not an answer to anyone.
    db.execute("INSERT INTO ZCALLRECORD VALUES ('+14085550102', ?, 0, 0, 0)", (at,))
    db.commit()
    db.close()


def ingested(tmp: Path) -> None:
    from surfaces import Context  # noqa: PLC0415

    home = tmp / "home"
    home.mkdir()
    call_history(home)
    env = {"KYBER_SURFACES_CHAT_DB": str(chat_db(tmp / "chat.db"))}
    ctx = Context(run=fx.FakeRun(), now=lambda: fx.NOW, home=home, sleep=lambda s: None, env=env)
    g = osgraph.Graph(tmp / "graph.sqlite")
    ids = osgraph.Identities(fx.people_db(tmp / "people.db"))
    report = ingest.imessage(g, ctx, ids, days=7)
    check("the fixture chat.db ingests", "error" not in report, report)
    waiting = {e["src"] for e in g.edges(verb="AWAITS_REPLY_FROM", dst=ME)}
    check("only Karthik's unanswered ask waits on him (tapback, 1:1, call and megaphone all close theirs)",
          waiting == {"thread:imessage:+14085550102"}, waiting)
    tasks = [n for n in g.nodes("Task") if n["props"].get("kind") == "request"]
    check("his tapback never becomes a Message node",
          not any("Loved" in n["label"] for n in g.nodes("Message")), [n["label"] for n in g.nodes("Message")])
    check("request tasks are still read from the asks", len(tasks) >= 2, [t["label"] for t in tasks])

    # The eval scores the same decision the ingester made, from the same rows.
    db = sqlite3.connect(f"file:{tmp / 'chat.db'}?mode=ro", uri=True)
    try:
        reach = ingest.my_reach(db, fx.apple(fx.NOW - timedelta(days=7)), ids, home)
    finally:
        db.close()
    old = E.chat_db
    E.chat_db = lambda: tmp / "chat.db"
    try:
        threads = E.read_threads(fx.NOW, ingest)
    finally:
        E.chat_db = old
    by_eval = {f"thread:imessage:{i}" for i, t in threads.items()
               if E.rule(ingest, t, fx.NOW, E.known_of(t, ids), reach, ids)}
    check("the eval's rule agrees with the ingester on every fixture thread", by_eval == waiting, by_eval)


def labels() -> None:
    """Test the test: the label must read what happened, not what the rule said."""
    def thread(group, *events):
        return {"ident": "x", "group": group, "msgs": [
            {"guid": f"g{i}", "text": "", "from_me": me, "at": T0 + timedelta(hours=h), "handle": who,
             "item_type": 0, "assoc": assoc} for i, (me, h, who, assoc) in enumerate(events)]}

    T = T0 + timedelta(hours=1)
    them = (False, 0, "+16305550101", 0)
    cases = [
        ("their message, he wrote within 72 h", thread(False, them, (True, 30, "", 0)), {}, True),
        ("their message, he wrote after 72 h", thread(False, them, (True, 80, "", 0)), {}, False),
        ("their message, he only reacted", thread(False, them, (True, 3, "", 2000)), {}, False),
        ("he reacted before the snapshot", thread(False, them, (True, 0.5, "", 2001), (True, 5, "", 0)), {}, False),
        ("group, someone else answered and he did not", thread(True, them, (False, 2, "+14085550102", 0)), {}, False),
        ("he called them within 72 h", thread(False, them), {"phone:+16305550101": [T0 + timedelta(hours=4)]},
         True),
        ("he called them before the snapshot", thread(False, them, (True, 4, "", 0)),
         {"phone:+16305550101": [T0 + timedelta(minutes=30)]}, False),
        ("his own message was last", thread(False, them, (True, 0.5, "", 0), (True, 4, "", 0)), {}, False),
    ]
    for name, t, other, want in cases:
        got, why = E.truth(t, T, {}, other)
        check(f"label: {name} -> {want}", got == want, (got, why))


def whatsapp_reactions() -> None:
    stamp = lambda mins: (T0 + timedelta(minutes=mins)).astimezone(timezone.utc).isoformat()  # noqa: E731
    rows = [
        {"ChatJID": "1@s.whatsapp.net", "FromMe": False, "Text": "can you send it tonight?", "Timestamp": stamp(0),
         "MsgID": "a"},
        {"ChatJID": "1@s.whatsapp.net", "FromMe": True, "ReactionToID": "a", "Text": "", "Timestamp": stamp(5),
         "MsgID": "b"},
        {"ChatJID": "2@s.whatsapp.net", "FromMe": False, "ReactionToID": "z", "Text": "", "Timestamp": stamp(9),
         "MsgID": "c"},
        {"ChatJID": "2@s.whatsapp.net", "FromMe": False, "Text": "can you send it tonight?", "Timestamp": stamp(0),
         "MsgID": "d"},
    ]
    grouped, reacted = WA.by_chat(rows), WA.my_reactions(rows)
    chat = {"jid": "1@s.whatsapp.net", "kind": "dm"}
    check("whatsapp: his reaction closes their ask",
          not WA.waiting(grouped["1@s.whatsapp.net"], chat, True, reacted.get("1@s.whatsapp.net")))
    check("whatsapp: only his reactions are recorded", set(reacted) == {"1@s.whatsapp.net"}, reacted)
    check("whatsapp: their reaction does not close their own ask",
          WA.waiting(grouped["2@s.whatsapp.net"], {"jid": "2@s.whatsapp.net", "kind": "dm"}, True,
                     reacted.get("2@s.whatsapp.net")))


def split_is_by_thread() -> None:
    check("the split is a pure function of the thread id",
          E.is_sealed("+16305550101") == E.is_sealed("+16305550101") and E.hashed("a") != E.hashed("b"))
    manifest = (fx.ROOT / "tests" / "fixtures" / "needs_you_split.json").read_text()
    check("the committed manifest holds no phone number or address",
          not any(c in manifest for c in ("+1", "@")), manifest[:80])


def main() -> int:
    rule_cases()
    labels()
    whatsapp_reactions()
    split_is_by_thread()
    with tempfile.TemporaryDirectory() as d:
        ingested(Path(d))
    print(f"{'FAIL' if failed else 'ok'}: needs-you, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
