#!/usr/bin/env python3
"""whatsapp: the surface draws valid Kyber Lines for loading, not linked,
data and empty; every read is `--read-only`; a send happens only on a press,
only to a 1:1 chat opened on the glass, only to its exact JID, and is read
back; nothing a message says reaches an action or the socket raw; and the
ingester writes Thread, Message and Person facts the ontology accepts, fused
only through the people store.

A fake wacli whose JSON shapes were read off wacli 0.19.0 on 2026-10-05
(see bin/lib/ingest_whatsapp.py). No network, no real store, no real HUD.
"""
import json
import sqlite3
import sys
import tempfile
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import surfaces_fixture as fx  # noqa: E402
import test_kyber_surfaces as tks  # noqa: E402  validate(), FakeHud and the daemon

import ingest_whatsapp as WA  # noqa: E402
import osgraph  # noqa: E402
import surfaces  # noqa: E402
from surfaces import Context, SurfaceError  # noqa: E402
from surfaces.whatsapp import WhatsApp  # noqa: E402

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


SAGAR_JID = "16305550101@s.whatsapp.net"     # in the people store by phone
STRANGER_JID = "15625550199@s.whatsapp.net"  # nobody; calls himself "Karthik Devarakonda"
GROUP_JID = "120363000000000001@g.us"
NEWS_JID = "120363999999999999@newsletter"
BIDI = "‮"  # right-to-left override: makes a line read backwards


def stamp(minutes_ago: int) -> str:
    return (fx.NOW - timedelta(minutes=minutes_ago)).astimezone(tz=None).strftime("%Y-%m-%dT%H:%M:%S%z")


def msg(chat, mid, minutes_ago, text, from_me=False, sender="", **extra):
    base = {"ChatJID": chat, "ChatName": "", "MsgID": mid, "SenderJID": sender or ("" if from_me else chat),
            "SenderName": "", "Timestamp": stamp(minutes_ago), "FromMe": from_me, "Text": text,
            "DisplayText": "", "MediaType": "", "MediaCaption": "", "ReactionToID": "", "ReactionEmoji": "",
            "Revoked": False, "DeletedForMe": False}
    base.update(extra)
    return base


class FakeWacli:
    """Stands in for wacli and for nothing else. Answers in wacli's envelope,
    refuses a send under --read-only the way the real one does, and stores
    its own sends so a read-back can find them (unless told not to)."""

    def __init__(self, linked=True):
        self.linked = linked
        self.store_sends = True
        # Answer a send with its id, or with no id (the key is unmeasured).
        self.send_id = True
        # Store the message, then answer the way run_cli does when it kills a
        # command at its timeout.
        self.killed = False
        # Store the message, then answer the way wacli does when its own
        # --timeout runs out: exit 1, {"success": false, "error": "context
        # deadline exceeded"}.
        self.deadline = False
        # Answer a send with this id instead of the stored message's id.
        self.answer_id = ""
        # A chat whose `messages list --chat` read fails.
        self.broken_chat = ""
        self.calls: list[list[str]] = []
        self.sent: list[dict] = []
        self.chats = [
            {"jid": SAGAR_JID, "kind": "dm", "name": "Sagar (push name)", "last_message_ts": stamp(10),
             "unread": True, "unread_count": 2},
            {"jid": STRANGER_JID, "kind": "dm", "name": "Karthik Devarakonda", "last_message_ts": stamp(20),
             "unread": True, "unread_count": 1},
            {"jid": GROUP_JID, "kind": "group", "name": "Amber " + BIDI + "core", "last_message_ts": stamp(30),
             "unread": False, "unread_count": 0},
            {"jid": NEWS_JID, "kind": "unknown", "name": "Some channel", "last_message_ts": stamp(5),
             "unread": True, "unread_count": 9},
        ]
        self.messages = [
            msg(SAGAR_JID, "S1", 60, "here's the deck", from_me=True),
            msg(SAGAR_JID, "S2", 10, "can you send the terms by monday?"),
            msg(SAGAR_JID, "S3", 9, "", ReactionToID="S1", ReactionEmoji="+1"),
            msg(STRANGER_JID, "X1", 20, fx.INJECTION),
            msg(GROUP_JID, "G1", 30, "guys can we move standup?", sender="14085550102@s.whatsapp.net"),
            msg(GROUP_JID, "G2", 31, "", sender="14085550102@s.whatsapp.net", MediaType="image"),
            msg(NEWS_JID, "N1", 5, "channel post"),
        ]

    def __call__(self, argv):
        argv = [str(a) for a in argv]
        self.calls.append(argv)
        args = argv[1:]
        read_only = "--read-only" in args
        words = [a for a in args if not a.startswith("--")]

        def ok(data):
            return 0, json.dumps({"success": True, "data": data, "error": None}), ""

        def opt(name):
            for i, a in enumerate(args):
                if a == name and i + 1 < len(args):
                    return args[i + 1]
                if a.startswith(name + "="):
                    return a.split("=", 1)[1]
            return None

        if words[:2] == ["auth", "status"]:
            return ok({"authenticated": self.linked})
        if words[:2] == ["chats", "list"]:
            return ok(self.chats or None)
        if words[:2] == ["messages", "list"]:
            if self.broken_chat and opt("--chat") == self.broken_chat:
                return 1, json.dumps({"success": False, "data": None, "error": "database is locked"}), ""
            rows = [m for m in self.messages if opt("--chat") in (None, m["ChatJID"])]
            if "--from-me" in args:
                rows = [m for m in rows if m["FromMe"]]
            rows.sort(key=lambda m: m["Timestamp"], reverse=True)
            return ok({"fts": True, "messages": rows[: int(opt("--limit") or 50)] or None})
        if words[:2] == ["send", "text"]:
            if read_only:
                return 1, json.dumps({"success": False, "data": None, "error":
                                      "read-only mode: command would intentionally modify WhatsApp"}), ""
            if not self.linked:
                return 1, json.dumps({"success": False, "data": None, "error": "not authenticated"}), ""
            to, text = opt("--to"), opt("--message")
            self.sent.append({"to": to, "text": text, "argv": argv})
            mid = f"SENT{len(self.sent)}"
            if self.store_sends:
                self.messages.append(msg(to, mid, 0, text, from_me=True))
            if self.killed:
                return 124, "", "wacli took longer than 20s"
            if self.deadline:
                return 1, json.dumps({"success": False, "data": None, "error": "context deadline exceeded"}), ""
            return ok({"to": to, "id": self.answer_id or mid} if self.send_id else {"to": to})
        return 1, "", f"fake wacli: unknown {words}"


def world(tmp: Path, wacli: FakeWacli):
    people = tmp / "people.db"
    ctx = Context(run=wacli, now=lambda: fx.NOW, home=tmp, sleep=lambda s: None,
                  env={"KYBER_WACLI": "/opt/fake/wacli", "PATH": "/usr/bin", "PEOPLE_DB": str(people)})
    ctx.ids = osgraph.Identities(people if people.exists() else fx.people_db(people))
    return ctx


def draw(p: WhatsApp, data, error, values, ctx) -> list[str]:
    model = p.model(data, error, values, ctx)
    return [f"@ {p.name} at={p.region} w={p.width}"] + p.layout() + [
        surfaces.data_line(k, v) for k, v in {**p.initial(), **model}.items()]


def reading(tmp: Path) -> None:
    wacli = FakeWacli()
    ctx = world(tmp, wacli)
    p = WhatsApp()
    for state, data, error in (("loading", None, None), ("error", None, "wacli failed: x")):
        problems = tks.validate(draw(p, data, error, {}, ctx))
        check(f"{state} draws valid Kyber Lines", not problems, problems)
    data = p.fetch(ctx)
    lines = draw(p, data, None, {}, ctx)
    check("data draws valid Kyber Lines", not tks.validate(lines), tks.validate(lines))
    check("every wacli call is a read, with --read-only and --json",
          all(c[1:3] == ["--read-only", "--json"] for c in wacli.calls), wacli.calls)
    labels = [r["label"] for r in data["rows"]]
    check("a known number is labelled by the people store", "Sagar Tiwari" in labels, labels)
    check("an unknown number is its raw number, never the name it gave",
          "+15625550199" in labels and not any("Karthik" in x for x in labels), labels)
    check("a newsletter is not a chat", not any(r["jid"] == NEWS_JID for r in data["rows"]))
    group = next(r for r in data["rows"] if r["group"])
    check("a group is its subject, marked, with format characters stripped",
          group["label"] == "Amber core (group)", group["label"])
    sagar = next(r for r in data["rows"] if r["jid"] == SAGAR_JID)
    check("a reaction is not the last line", sagar["last"] == "can you send the terms by monday?", sagar["last"])
    check("an ask from a known person waits on you, and comes first",
          sagar["waiting"] and data["rows"][0]["jid"] == SAGAR_JID, [(r["jid"], r["waiting"]) for r in data["rows"]])
    check("a group question to the room does not wait on you", not group["waiting"])
    check("the unread count comes from wacli", sagar["unread"] == 2, sagar["unread"])
    model = p.model(data, None, {}, ctx)
    check("the caption says who is waiting and what is unread",
          "1 waiting on you" in model["/whatsapp/caption"] and "3 unread" in model["/whatsapp/caption"],
          model["/whatsapp/caption"])
    check("there is no Reply-to control the glass can pick or type into",
          not any(" Select " in x for x in lines) and not any("/whatsapp/pick" in x for x in lines), lines)
    check("nothing is targeted until a row is opened",
          model["/whatsapp/go"] == "Send" and model["/whatsapp/to"].startswith("Open a one-to-one chat"),
          (model["/whatsapp/go"], model["/whatsapp/to"]))
    joined = "\n".join(lines)
    check("the injection stays inside one d line", all(
        not line.startswith(("e ", "kyber-surfaces", "Ignore")) for line in joined.split("\n")))
    check("no control or bidi character reaches the socket", BIDI not in joined and "\x1b" not in joined)

    # Drill in.
    res = p.open(ctx, data, {"row": f"wa:{GROUP_JID}"})
    check("Open on a group shows it and says it can't be answered here",
          res.ok and "aren't sent" in res.line and not res.updates, res)
    data = p.fetch(ctx)
    model = p.model(data, None, {}, ctx)
    check("an opened group is not a send target", model["/whatsapp/go"] == "Send" and
          "Group replies" in model["/whatsapp/to"], (model["/whatsapp/go"], model["/whatsapp/to"]))
    texts = [t["text"] for t in model["/whatsapp/thread"]]
    check("the opened chat's last lines show, oldest first, media named",
          texts[0].endswith("[image]") and texts[-1].endswith("guys can we move standup?"), texts)
    check("a group sender is named by the people store, not by wacli",
          texts[-1].startswith("Karthik Devarakonda:"), texts)
    res = p.open(ctx, data, {"row": "wa:999@s.whatsapp.net"})
    check("Open on a row that isn't listed does nothing", not res.ok and p.opened == GROUP_JID)

    # Not linked, empty store.
    empty = FakeWacli(linked=False)
    empty.chats, empty.messages = [], []
    try:
        WhatsApp().fetch(world(tmp, empty))
        check("an unlinked, empty store says how to link", False)
    except SurfaceError as err:
        check("an unlinked, empty store says how to link, by QR", "qr" in str(err).lower(), str(err))
    stale = FakeWacli(linked=False)
    sp = WhatsApp()
    sdata = sp.fetch(world(tmp, stale))
    cap = sp.model(sdata, None, {}, ctx)["/whatsapp/caption"]
    check("an unlinked store with chats shows them and says nothing can be sent", "nothing can be sent" in cap, cap)
    sp.open(ctx, sdata, {"row": f"wa:{SAGAR_JID}"})
    go = sp.model(sp.fetch(world(tmp, stale)), None, {}, ctx)["/whatsapp/go"]
    check("unlinked, the button never offers to send, even after Open", "can't send" in go and "Send to" not in go, go)

    # Archived chats are filed away, not waiting and not unread.
    filed = FakeWacli()
    filed.chats[0]["archived"] = True
    fdata = WhatsApp().fetch(world(tmp, filed))
    check("an archived chat is not a row", not any(r["jid"] == SAGAR_JID for r in fdata["rows"]),
          [r["jid"] for r in fdata["rows"]])

    # A thread read that fails leaves the list on the glass.
    broken = FakeWacli()
    broken.broken_chat = SAGAR_JID
    bp = WhatsApp()
    bctx = world(tmp, broken)
    bdata = bp.fetch(bctx)
    bp.open(bctx, bdata, {"row": f"wa:{SAGAR_JID}"})
    bdata = bp.fetch(bctx)
    bmodel = bp.model(bdata, None, {}, bctx)
    check("a failed thread read fails only the thread pane", len(bdata["rows"]) == 3 and
          "couldn't read" in bmodel["/whatsapp/threadCaption"] and len(bmodel["/whatsapp/rows"]) == 3,
          bmodel["/whatsapp/threadCaption"])
    gone = FakeWacli()
    gone.chats, gone.messages = [], []
    edata = WhatsApp().fetch(world(tmp, gone))
    elines = draw(WhatsApp(), edata, None, {}, ctx)
    check("empty draws valid Kyber Lines and says so", not tks.validate(elines) and
          "No WhatsApp chats" in WhatsApp().model(edata, None, {}, ctx)["/whatsapp/caption"])
    missing = Context(run=lambda argv: (127, "", "wacli is not installed"), now=lambda: fx.NOW, home=tmp,
                      sleep=lambda s: None, env={"KYBER_WACLI": "/nope/wacli"})
    try:
        WhatsApp().fetch(missing)
        check("a missing wacli is a readable error", False)
    except SurfaceError as err:
        check("a missing wacli is a readable error", "isn't installed" in str(err), str(err))


def sending(tmp: Path) -> None:
    wacli = FakeWacli()
    ctx = world(tmp, wacli)
    p = WhatsApp()
    data = p.fetch(ctx)
    sagar = next(r for r in data["rows"] if r["jid"] == SAGAR_JID)
    stranger = next(r for r in data["rows"] if r["jid"] == STRANGER_JID)
    group = next(r for r in data["rows"] if r["group"])

    res = p.send(ctx, data, {"/whatsapp/draft": "hi"})
    check("Send with nothing opened sends nothing", not res.ok and not wacli.sent, res)
    res = p.send(ctx, data, {"/whatsapp/pick": sagar["label"], "/whatsapp/to": SAGAR_JID,
                             "/whatsapp/draft": "hi"})
    check("a forged pick or target value from the glass sends nothing", not res.ok and not wacli.sent, res)
    p.open(ctx, data, {"row": group["id"]})
    res = p.send(ctx, data, {"/whatsapp/draft": "hi"})
    check("an opened group can't be sent to", not res.ok and not wacli.sent, res)
    opened = p.open(ctx, data, {"row": sagar["id"]})
    check("Open on a 1:1 row targets it by JID, not by a value on the glass",
          opened.ok and not opened.updates and p.opened == SAGAR_JID, opened)
    check("the button names the opened chat",
          p.model(data, None, {}, ctx)["/whatsapp/go"] == "Send to Sagar Tiwari")
    res = p.send(ctx, data, {"/whatsapp/draft": "   "})
    check("an empty message sends nothing", not res.ok and not wacli.sent)
    res = p.send(ctx, data, {"/whatsapp/draft": "x" * 2001})
    check("an over-long message sends nothing", not res.ok and not wacli.sent)

    typed = "--to=" + STRANGER_JID + " on it\n" + BIDI + "terms by tonight"
    res = p.send(ctx, data, {"/whatsapp/draft": typed})
    check("Send on the opened 1:1 chat sends once and reads it back", res.ok and len(wacli.sent) == 1, res)
    out = wacli.sent[-1]
    check("it goes to the exact JID, never a name", out["to"] == SAGAR_JID, out)
    check("typed flag-looking words stay inside --message", out["text"].startswith("--to=") and
          [a for a in out["argv"] if a.startswith("--to=")] == ["--to=" + SAGAR_JID], out["argv"])
    check("bidi characters are stripped from what is sent, and the typed line break is kept",
          out["text"] == "--to=" + STRANGER_JID + " on it\nterms by tonight", out["text"])
    check("the send is not --read-only and never interprets escapes",
          "--read-only" not in out["argv"] and "--message-escapes" not in out["argv"], out["argv"])
    check("wacli's own budget is set under the runner's 20s kill",
          "--timeout=12s" in out["argv"] and "--lock-wait=4s" in out["argv"] and
          "--post-send-wait=1s" in out["argv"], out["argv"])
    check("a sent message clears the draft", res.updates == {"/whatsapp/draft": ""}, res.updates)

    wacli.store_sends = False
    res = p.send(ctx, data, {"/whatsapp/draft": "second"})
    check("a send that never shows up in the chat says so", not res.ok and "isn't in the chat yet" in res.line, res)

    # An old identical line must not prove a new send landed.
    wacli.messages.append(msg(SAGAR_JID, "OLD-OK", 60 * 48, "ok", from_me=True))
    for with_id in (True, False):
        wacli.send_id = with_id
        res = p.send(ctx, data, {"/whatsapp/draft": "ok"})
        check(f"an earlier 'ok' never verifies a new 'ok' that didn't land ({'with' if with_id else 'without'} an id)",
              not res.ok and "isn't in the chat yet" in res.line, res)
    wacli.store_sends = True
    wacli.send_id = False
    res = p.send(ctx, data, {"/whatsapp/draft": "ok"})
    check("without an id, a new message with the same text verifies", res.ok, res)
    wacli.send_id = True

    # Only the returned id counts: a new message with the same words under
    # another id is not this send.
    wacli.answer_id = "NOT-IN-THE-STORE"
    res = p.send(ctx, data, {"/whatsapp/draft": "same words"})
    stored = [m for m in wacli.messages if m["Text"] == "same words"]
    check("with an id, a new same-text message under a different id never verifies",
          len(stored) == 1 and stored[0]["MsgID"] != "NOT-IN-THE-STORE" and
          not res.ok and "isn't in the chat yet" in res.line, res)
    wacli.answer_id = ""

    # wacli's own deadline: exit 1, success false, the message may be out.
    wacli.deadline = True
    before = len(wacli.sent)
    res = p.send(ctx, data, {"/whatsapp/draft": "deadline but landed"})
    check("a send that answers 'context deadline exceeded' is read back, and it landed",
          res.ok and "It's in the chat" in res.line and res.updates == {"/whatsapp/draft": ""}, res)
    wacli.store_sends = False
    res = p.send(ctx, data, {"/whatsapp/draft": "deadline not found"})
    check("a deadline error that isn't found says it may have gone and clears the draft, never 'Didn't send'",
          not res.ok and "may have gone" in res.line and "context deadline exceeded" in res.line and
          res.updates == {"/whatsapp/draft": ""} and not res.line.startswith("Didn't send"), res)
    check("each deadline send was attempted once", len(wacli.sent) == before + 2)
    wacli.deadline = False
    wacli.store_sends = True

    # Killed at the runner's timeout after the message went out.
    wacli.killed = True
    before = len(wacli.sent)
    res = p.send(ctx, data, {"/whatsapp/draft": "on my way"})
    check("a send killed at the timeout is read back, and it landed",
          res.ok and "It's in the chat" in res.line and res.updates == {"/whatsapp/draft": ""}, res)
    wacli.store_sends = False
    res = p.send(ctx, data, {"/whatsapp/draft": "still coming"})
    check("a killed send that isn't found says it may have gone and clears the draft, so no double send",
          not res.ok and "may have gone" in res.line and res.updates == {"/whatsapp/draft": ""} and
          not res.line.startswith("Didn't send"), res)
    check("each killed send was attempted once", len(wacli.sent) == before + 2)
    wacli.killed = False
    wacli.store_sends = True

    # Things that change between the draw and the press.
    before = len(wacli.sent)
    saved = [dict(c) for c in wacli.chats]
    wacli.chats = [c for c in wacli.chats if c["jid"] != SAGAR_JID]
    res = p.send(ctx, data, {"/whatsapp/draft": "hello"})
    check("a chat gone from wacli at the press sends nothing", not res.ok and len(wacli.sent) == before, res)
    wacli.chats.insert(0, {"jid": SAGAR_JID, "kind": "group", "name": "x", "last_message_ts": stamp(1)})
    res = p.send(ctx, data, {"/whatsapp/draft": "hello"})
    check("a chat that became a group sends nothing", not res.ok and len(wacli.sent) == before, res)
    wacli.chats[0] = {"jid": SAGAR_JID, "kind": "dm", "name": "x", "last_message_ts": stamp(1), "archived": True}
    res = p.send(ctx, data, {"/whatsapp/draft": "hello"})
    check("a chat archived since it was opened sends nothing", not res.ok and len(wacli.sent) == before, res)
    wacli.chats[0] = {"jid": SAGAR_JID, "kind": "dm", "name": "x", "last_message_ts": stamp(1)}
    # The contact changes on disk after Open. ctx.ids, the ingest-time copy,
    # still says Sagar; the press must read the store, not that copy.
    db = sqlite3.connect(tmp / "people.db")
    removed = db.execute("SELECT * FROM identities WHERE person_id = ? AND kind = 'phone'", (fx.SAGAR,)).fetchall()
    db.execute("DELETE FROM identities WHERE person_id = ? AND kind = 'phone'", (fx.SAGAR,))
    db.commit()
    check("the ingest-time copy still names Sagar (so only a fresh read can catch it)",
          WA.person_for(ctx.ids, SAGAR_JID).id == f"person:{fx.SAGAR}")
    res = p.send(ctx, data, {"/whatsapp/draft": "hello"})
    check("a number that stopped being that contact on disk sends nothing",
          not res.ok and "same contact" in res.line and len(wacli.sent) == before, res)
    stale_open = WhatsApp()
    res = stale_open.open(ctx, data, {"row": sagar["id"]})
    check("Open on a row drawn before the contact changed refuses to target it",
          not res.ok and stale_open.opened == "" and "contact changed" in res.line, res)
    db.executemany("INSERT INTO identities VALUES (?, ?, ?)", removed)
    db.commit()
    db.close()
    wacli.linked = False
    res = p.send(ctx, data, {"/whatsapp/draft": "hello"})
    check("an unlinked account sends nothing and says how to link",
          not res.ok and "qr" in res.line.lower() and len(wacli.sent) == before, res)
    wacli.linked = True
    wacli.chats = saved
    p.open(ctx, data, {"row": stranger["id"]})
    res = p.send(ctx, data, {"/whatsapp/draft": "who is this"})
    check("an unsaved number opened on the glass can be answered at its own JID",
          res.ok and wacli.sent[-1]["to"] == STRANGER_JID, res)


def unknown_group_sender(tmp: Path) -> None:
    """A group line wacli stored with no SenderJID has nobody behind it: the
    group's own JID never becomes a Person or a SENT_BY target."""
    wacli = FakeWacli()
    wacli.chats = [c for c in wacli.chats if c["jid"] == GROUP_JID]
    wacli.messages = [msg(GROUP_JID, "G9", 3, "who sent this", SenderJID="")]
    ctx = world(tmp, wacli)
    p = WhatsApp()
    data = p.fetch(ctx)
    p.open(ctx, data, {"row": f"wa:{GROUP_JID}"})
    thread = p.model(p.fetch(ctx), None, {}, ctx)["/whatsapp/thread"]
    check("the surface labels an empty group sender as unknown, never the group's number",
          [t["text"] for t in thread] == ["Unknown sender: who sent this"], thread)
    g = osgraph.Graph(tmp / "graph.sqlite")
    WA.whatsapp(g, ctx, ctx.ids, days=7)
    persons = [n for n in g.nodes("Person") if "120363" in (n["id"] + n["label"])]
    check("no Person is made for the group", not persons, persons)
    sent_by = g.edges(verb="SENT_BY")
    check("the message has no SENT_BY edge, and the graph still validates",
          not sent_by and len(g.nodes("Message")) == 1 and not g.validate(), (sent_by, g.validate()))


ALEX_A = "15550000001@s.whatsapp.net"
ALEX_B = "15550000002@s.whatsapp.net"


def same_label_resort(tmp: Path) -> None:
    """The verifier's repro: two people-store rows both named Alex. A is
    opened, then B gets a newer message and the list re-sorts. The send must
    still go to A, the chat on screen."""
    people = tmp / "people.db"
    fx.people_db(people)
    db = sqlite3.connect(people)
    db.executemany("INSERT INTO people (id, name, company, nickname) VALUES (?, ?, ?, ?)",
                   [("p-alex-a", "Alex", "", ""), ("p-alex-b", "Alex", "", "")])
    db.executemany("INSERT INTO identities VALUES (?, ?, ?)",
                   [("p-alex-a", "phone", "+15550000001"), ("p-alex-b", "phone", "+15550000002")])
    db.commit()
    db.close()
    wacli = FakeWacli()
    wacli.chats = [{"jid": j, "kind": "dm", "name": "Alex", "last_message_ts": stamp(m), "unread_count": 0}
                   for j, m in ((ALEX_A, 5), (ALEX_B, 50))]
    wacli.messages = [msg(ALEX_A, "A1", 5, "hey from A"), msg(ALEX_B, "B1", 50, "hey from B")]
    ctx = world(tmp, wacli)
    p = WhatsApp()
    data = p.fetch(ctx)
    check("both Alexes are rows, A on top", [r["jid"] for r in data["rows"]] == [ALEX_A, ALEX_B],
          [r["jid"] for r in data["rows"]])
    p.open(ctx, data, {"row": f"wa:{ALEX_A}"})
    wacli.messages.append(msg(ALEX_B, "B2", 1, "newer from B"))
    data = p.fetch(ctx)
    check("B's newer message re-sorts B to the top", data["rows"][0]["jid"] == ALEX_B)
    res = p.send(ctx, data, {"/whatsapp/draft": "for A"})
    check("after the re-sort the send still goes to the chat that was opened",
          res.ok and [x["to"] for x in wacli.sent] == [ALEX_A], [x["to"] for x in wacli.sent])


def through_the_daemon(tmp: Path) -> None:
    """The real daemon, a fake display: the row press, the typed Field and
    the Send press arrive as socket lines, and a message's text never acts."""
    wacli = FakeWacli()
    ctx = world(tmp, wacli)
    kinds = surfaces.KINDS
    surfaces.KINDS = kinds + ("whatsapp",)
    try:
        hud = tks.FakeHud()
        d = tks.ks.Daemon(hud, ctx=ctx, state_path=tmp / "state.json", activity_path=tmp / "activity.jsonl",
                          badges_path=tmp / "badges.json", spaces={}, clock=lambda: 0.0, spawn=lambda fn: fn(),
                          ingest=lambda c: {},
                          make=lambda kind, arg="": WhatsApp() if kind == "whatsapp" else surfaces.make(kind, arg))
        d.open_surface("whatsapp")
        drawn = hud.take()
        check("the daemon draws it valid", not tks.validate(drawn), tks.validate(drawn))
        d.handle_line('e ks-send whatsapp-send surface="whatsapp"')
        check("Send before any row is opened sends nothing", not wacli.sent)
        d.handle_line(f'e action ks-open row="wa:{SAGAR_JID}" surface="whatsapp"')
        lines = hud.take()
        check("a row's Open press targets that chat and draws its lines",
              any(x.startswith("d /whatsapp/to ") and "Sagar Tiwari" in x for x in lines) and
              any(x.startswith("d /whatsapp/thread ") and "terms by monday" in x for x in lines), lines)
        d.handle_line('v /whatsapp/draft "on it"')
        d.handle_line('e ks-send whatsapp-send surface="whatsapp"')
        check("Send on the glass sends exactly once, to that chat",
              len(wacli.sent) == 1 and wacli.sent[0]["to"] == SAGAR_JID and wacli.sent[0]["text"] == "on it",
              wacli.sent)
        activity = (tmp / "activity.jsonl").read_text()
        check("the activity log records the send and never its words",
              '"action": "send"' in activity and "on it" not in activity, activity)
        d.handle_line(f'e action ks-open row="wa:{STRANGER_JID}" surface="whatsapp"')
        d.handle_line('e ks-send whatsapp-send surface="whatsapp"')
        check("the injection text in that chat triggered nothing", len(wacli.sent) == 1, wacli.sent)
        d.handle_line('v /whatsapp/pick "Sagar Tiwari"')
        d.handle_line('v /whatsapp/draft "forged"')
        d.handle_line(f'e ks-send whatsapp-send surface="whatsapp" to="{SAGAR_JID}"')
        check("a typed pick or a to= on the press can't redirect the send",
              [x["to"] for x in wacli.sent] == [SAGAR_JID, STRANGER_JID], [x["to"] for x in wacli.sent])
    finally:
        surfaces.KINDS = kinds


def ingesting(tmp: Path) -> None:
    wacli = FakeWacli()
    ctx = world(tmp, wacli)
    g = osgraph.Graph(tmp / "graph.sqlite")
    report = WA.whatsapp(g, ctx, ctx.ids, days=7)
    check("the ingester writes a snapshot", report.get("nodes", 0) > 0, report)
    check("every stored edge fits the ontology", not g.validate(), g.validate())
    threads = {n["id"]: n for n in g.nodes("Thread")}
    check("one Thread per 1:1 chat and group, none for a newsletter",
          set(threads) == {f"thread:whatsapp:{j}" for j in (SAGAR_JID, STRANGER_JID, GROUP_JID)}, set(threads))
    sagar_thread = threads[f"thread:whatsapp:{SAGAR_JID}"]
    check("a Thread is tagged WhatsApp and never carries an iMessage reply_to",
          sagar_thread["props"]["network"] == "WhatsApp" and "reply_to" not in sagar_thread["props"] and
          sagar_thread["props"]["wa_jid"] == SAGAR_JID, sagar_thread["props"])
    parts = {n["id"] for n in g.out(sagar_thread["id"], "PARTICIPANT")}
    check("a known number fuses to the people-store person, the same node iMessage uses",
          parts == {f"person:{fx.SAGAR}"}, parts)
    stranger = g.out(f"thread:whatsapp:{STRANGER_JID}", "PARTICIPANT")
    node = stranger[0] if len(stranger) == 1 else {"unresolved": False, "label": stranger}
    check("an unknown number is its own unresolved Person, labelled with the number",
          node["unresolved"] and node["label"] == "+15625550199", node)
    awaiting = {e["src"] for e in g.edges(verb="AWAITS_REPLY_FROM")}
    check("only the known person's ask waits on me", awaiting == {sagar_thread["id"]}, awaiting)
    msgs = g.nodes("Message")
    check("messages are WhatsApp, snippets, no reactions",
          all(m["props"]["network"] == "WhatsApp" and len(m["label"]) <= osgraph.SNIPPET_CHARS for m in msgs) and
          not any(m["label"] in ("", "+1") for m in msgs), [m["label"] for m in msgs])
    check("message ids are hashed, not the network's free text",
          all(len(m["id"].split(":", 1)[1]) == 64 for m in msgs), [m["id"] for m in msgs][:2])
    check("no Task is read out of a WhatsApp text (prune would never clear it)", not g.nodes("Task"))
    before = len(g.nodes("Message"))
    WA.whatsapp(g, ctx, ctx.ids, days=7)
    check("a second ingest replaces, never doubles", len(g.nodes("Message")) == before)
    stale = FakeWacli(linked=False)
    report = WA.whatsapp(g, world(tmp, stale), ctx.ids, days=7)
    check("an unlinked account with a stored week still ingests it, and says it's unlinked",
          report.get("nodes", 0) > 0 and report.get("linked") is False, report)
    filed = FakeWacli()
    filed.chats[0]["archived"] = True
    WA.whatsapp(g, world(tmp, filed), ctx.ids, days=7)
    check("an archived chat is not ingested",
          f"thread:whatsapp:{SAGAR_JID}" not in {n["id"] for n in g.nodes("Thread")})
    unlinked = FakeWacli(linked=False)
    unlinked.chats, unlinked.messages = [], []
    try:
        report = WA.whatsapp(g, world(tmp, unlinked), ctx.ids, days=7)
        check("an unlinked, empty account is a note in the report, never an error",
              report.get("linked") is False and "isn't linked" in report.get("note", "") and
              not g.nodes("Thread"), report)
    except WA.WacliError as err:
        check("an unlinked, empty account is a note in the report, never an error", False, str(err))


def helpers() -> None:
    check("clean strips controls and bidi, keeps emoji joins",
          WA.clean("a\x1b[31m" + BIDI + "b‍c\nd") == "a[31mb‍c d", WA.clean("a\x1b[31m" + BIDI + "b"))
    check("only user JIDs are one-to-one", [WA.is_dm({"kind": "dm", "jid": j}) for j in
                                             (SAGAR_JID, "123456@lid", GROUP_JID, "x@s.whatsapp.net")]
          == [True, True, False, False])
    check("a LID has no phone", WA.phone_of("123456@lid") == "" and WA.handle_of("123456@lid") == "123456@lid")
    check("the brew wacli is found under launchd's short PATH",
          WA.wacli_bin({"PATH": "/usr/bin"}) in ("/opt/homebrew/bin/wacli", "/usr/local/bin/wacli", "wacli"))
    check("typed line breaks and tabs are kept, CRLF becomes LF, bidi and escape go",
          WA.clean_typed("  one\r\ntwo\rthree\n\tfour" + BIDI + "\x1b ") == "one\ntwo\nthree\n\tfour",
          WA.clean_typed("  one\r\ntwo\rthree\n\tfour" + BIDI + "\x1b "))
    try:
        WA.envelope(1, '{"success":false,"data":null,"error":"read-only mode: nope"}', "", "WhatsApp send")
        check("a wacli error envelope raises", False)
    except WA.WacliError as err:
        check("a wacli error envelope raises with its words", "read-only mode" in str(err), str(err))


def long_group_keeps_marker():
    """A 63-character group subject used to lose " (group)" at the list's
    48-character clip, so a stranger's group read as a known contact."""
    label = WA.chat_label(None, {"kind": "group", "name": "Sagar Tiwari " + "x" * 50, "jid": "1@g.us"})
    check("a long group subject keeps its (group) marker after the list clip",
          WA.clean(label, WA.GROUP_LABEL_MAX).endswith("(group)"), label)


def main() -> int:
    helpers()
    long_group_keeps_marker()
    for fn in (reading, sending, unknown_group_sender, same_label_resort, through_the_daemon, ingesting):
        with tempfile.TemporaryDirectory() as d:
            fn(Path(d))
    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
