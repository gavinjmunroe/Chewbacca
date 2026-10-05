"""Ingesters: every source the person opens an app for, written as graph facts.

Each ingester reads one source through what is already on the machine (chat.db
read only, the `mac` CLI, `coursework`, the people store, backlog CSVs, the
agent hook's board) and returns a snapshot of nodes and edges for
`Graph.apply`. None of them writes anywhere else, sends anything, or reads a
message for instructions: text is stored as a label to be rendered, and the
one thing derived from it, a request-shaped sentence becoming a Task, is
marked as a guess with the message it came from.

THE PILOT WINDOW. Seven days by default (`days`), per the brief's "pilot
first": the AWAITS_REPLY_FROM rule is measured on a hand sample of this window
before the window is widened.

Not ingested, on purpose: the room-listen transcript (~/.chewbacca/room) has
times but no date and no speaker, so a sentence in it cannot be owed by
anyone; Granola's cache is encrypted to Granola-signed code
(memory, reference_granola_live_transcript).
"""
from __future__ import annotations

import csv
import glob
import json
import os
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

import osgraph
from osgraph import ME, Edge, Graph, Identities, Node, day_node, me_node, person_node, space_node

APPLE_EPOCH = datetime(2001, 1, 1, tzinfo=timezone.utc)
# chat.style: 43 is a group, 45 one-to-one.
STYLE_GROUP = 43
MESSAGES_PER_THREAD = 5
# A reaction ("Loved “...”") and a one-word closer end a conversation; nobody
# is waiting for an answer to "lol". Measured against the hand sample in
# tests/test_osgraph.py's pilot notes, 2026-10-04.
CLOSERS = re.compile(
    r"^(ok(ay)?|k+|kk|lol+|lmao+|haha+|ha|bet|cool|nice|thanks?( you)?|ty|thx|sounds good|got it|"
    r"word|yep|yup|yes|yeah|no worries|np|for sure|perfect|great|awesome|amen|love (it|you)|"
    r"gn|good ?night|night|see you|see ya|bye|will do|on it|done|same|true|facts|fr|ong)[.!\s]*$", re.I)
TAPBACK = re.compile(r"^(Loved|Liked|Disliked|Laughed at|Emphasized|Questioned|Reacted .{1,8} to) “", re.I)
# A sentence that asks the person to do something. Rules, not a model, so the
# precision is whatever the hand sample says and nothing is invented.
REQUEST = re.compile(
    r"\b(can you|could you|would you|will you|can u|could u|pls|please|lmk|let me know|send (me|over|it)|"
    r"need you to|don'?t forget|remember to|make sure (you|to)|when can you|are you able to)\b", re.I)
AUTOMATED_MAIL = re.compile(
    r"(^|[._+-])(no[-_]?reply|do[-_]?not[-_]?reply|notifications?|newsletters?|mailer-daemon|bounces?|"
    r"digest|marketing|updates|alerts|testflight|receipts?|billing|news|developer|accounts?|security|"
    r"support|team|hello|info|contact|admin|service|notify|orders?|shipping|feedback)([._+-]|@|$)", re.I)
ADDRESS = re.compile(r"<([^<>@\s]+@[^<>\s]+)>|([^\s<>]+@[^\s<>]+)")
# Company words that put a person's threads in a space. Overridable through
# "space_by_company" in ~/.chewbacca/surfaces.json.
SPACE_BY_COMPANY = {"amber": "amber", "zeutara": "amber", "togari": "amber", "medha": "amber",
                    "usc": "school", "university of southern california": "school"}
BACKLOG_LIVE = {"open", "decision", "blocked", "verify", "proposed"}


def clip(text, limit: int) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-")[:60] or "x"


def body_text(text, blob) -> str:
    """The words of an iMessage. Newer macOS leaves `text` empty and keeps them
    in an NSAttributedString archive (`attributedBody`) after the NSString
    class name, length-prefixed."""
    if text:
        return str(text)
    if not blob:
        return ""
    raw = bytes(blob)
    marker = raw.find(b"NSString")
    if marker < 0:
        return ""
    rest = raw[marker + len(b"NSString"):]
    plus = rest.find(b"+")
    if plus < 0 or plus + 1 >= len(rest):
        return ""
    rest = rest[plus + 1:]
    size, start = rest[0], 1
    if size == 0x81:
        size, start = int.from_bytes(rest[1:3], "little"), 3
    elif size == 0x82:
        size, start = int.from_bytes(rest[1:4], "little"), 4
    return rest[start:start + size].decode("utf-8", "replace")


# Something in the latest inbound burst asks for an answer. Measured on a
# 30-thread hand sample of the 7-day pilot, 2026-10-04: "newest message is
# theirs and is not a closer" was right on 6 of 30 (20%); the misses were
# statements ("Sounds like you have a cold"), sign-offs ("Fs bro") and
# automated texts. Requiring an ask is the fix the sample pointed at.
ASK = re.compile(
    r"\?|\b(can|could|would|will|do|did|are|were|have|r) (you|u|we)\b|\blmk\b|let me know|"
    r"\b(call|text|ping|email) me\b|\bwanna\b|want to|should (we|go|grab|get)|\blet'?s\b|"
    r"\b(u|you) free\b|free (tmr|tomorrow|today|tonight|this|next)|send (me|over|it)|need (you|u)|"
    r"when (are|r|can) (you|u)|how about\b", re.I)
# Texts no person typed: political blasts, delivery and bank codes. The
# U+FFFC object marker leads every rich-link blast in the sample.
AUTOMATED_TEXT = re.compile(
    r"^\ufffc|reply stop|text stop|stop to (end|opt|unsubscribe)|\bverification code\b|enter code|"
    r"never (call|text) you|track (at|your)|your order|package|deposited a new message|"
    r"thank you for (joining|checking|your|being)|friendly reminder|courtesy message|ready for your ticket", re.I)


URL = re.compile(r"https?://\S+", re.I)


NAMED = re.compile(rf"\b{re.escape((os.environ.get('KYBER_SURFACES_OWNER') or 'Caleb').lower())}\b", re.I)


def is_automated_handle(handle: str) -> bool:
    """Short codes (578398, 93557) and carrier relay handles (smsfp)."""
    handle = handle or ""
    if handle.startswith("chat"):
        return False  # a group chat's identifier, not a sender
    digits = re.sub(r"\D", "", handle)
    return "(smsfp)" in handle or (0 < len(digits) <= 6 and "@" not in handle)


# A message this long from a number nobody saved is a campaign, a survey or a
# registration notice: all three misses in the second held-out sample
# (2026-10-04) were 140+ characters from an unsaved number, and no true row was.
UNKNOWN_SENDER_MAX = 140
# Shorter than this is not a task anyone could act on ("please", "pls lmk").
MIN_TASK_CHARS = 12


def awaits_me(burst: list[str], handle: str, group: bool, known: bool = True) -> bool:
    """Does a thread wait on the person? `burst` is every inbound message
    since the person's own last one, oldest first; empty when the newest
    message is the person's own.

    Something in it has to ask for an answer. Reactions and closers never do,
    and a short code or a blast is nobody waiting."""
    if not burst or is_automated_handle(handle):
        return False
    asks = False
    for text in burst:
        # A shared link's "?mibextid=..." is not a question (pilot, 2026-10-04).
        t = URL.sub(" ", text or "").strip()
        if not t or TAPBACK.match(t):
            continue
        if AUTOMATED_TEXT.search(t) or (not known and len(t) > UNKNOWN_SENDER_MAX):
            return False
        if ASK.search(t) or REQUEST.search(t):
            # In a group, "Guys can we go to the game" asks the room, and
            # "you" is usually someone else: the held-out sample had 0 of 5
            # group threads truly waiting on him. Only his name counts there.
            if not group or NAMED.search(t):
                asks = True
    return asks


def space_for(person: dict | None, mapping: dict) -> str:
    company = ((person or {}).get("props") or {}).get("company", "") if person else ""
    company = (company or "").lower()
    for word, space in mapping.items():
        if word in company:
            return space
    return "personal"


class Snapshot:
    def __init__(self):
        self.nodes: dict[str, Node] = {}
        self.edges: list[Edge] = []

    def add(self, node: Node) -> str:
        if node.id not in self.nodes:
            self.nodes[node.id] = node
        return node.id

    def link(self, src: str, verb: str, dst: str, **kw) -> None:
        self.edges.append(Edge(src, verb, dst, **kw))

    def write(self, graph: Graph, source: str) -> dict:
        return graph.apply(source, list(self.nodes.values()), self.edges)


def imessage(graph: Graph, ctx, ids: Identities, days: int = 7, db_path: Path | None = None,
             mapping: dict = SPACE_BY_COMPANY) -> dict:
    path = Path(db_path or ctx.env.get("KYBER_SURFACES_CHAT_DB") or ctx.home / "Library" / "Messages" / "chat.db")
    if not path.exists():
        raise FileNotFoundError(f"no chat.db at {path}")
    now = ctx.now()
    floor = int((now - timedelta(days=days) - APPLE_EPOCH).total_seconds() * 1e9)
    snap = Snapshot()
    me = snap.add(me_node())
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2)
    try:
        # One conversation can be several chat rows (iMessage and SMS for the
        # same number). The pilot sample caught a thread read as "waiting"
        # because only one of its two rows was looked at, so rows are folded
        # by chat_identifier first.
        folded: dict[str, dict] = {}
        for rowid, ident, display, style, last in db.execute(
                """SELECT c.ROWID, c.chat_identifier, c.display_name, c.style, MAX(m.date)
                   FROM chat c JOIN chat_message_join j ON j.chat_id = c.ROWID
                   JOIN message m ON m.ROWID = j.message_id
                   WHERE m.date > ? GROUP BY c.ROWID""", (floor,)):
            f = folded.setdefault(ident, {"rows": [], "display": "", "style": style, "last": 0})
            f["rows"].append(rowid)
            f["display"] = f["display"] or display or ""
            f["last"] = max(f["last"], last or 0)
        for ident, f in sorted(folded.items(), key=lambda kv: kv[1]["last"], reverse=True):
            rowids, display, style, last = f["rows"], f["display"], f["style"], f["last"]
            marks = ",".join("?" * len(rowids))
            group = style == STYLE_GROUP
            handles = sorted({h for (h,) in db.execute(
                f"SELECT h.id FROM chat_handle_join chj JOIN handle h ON h.ROWID = chj.handle_id "
                f"WHERE chj.chat_id IN ({marks})", rowids)})
            people = {h: person_node(ids, h, source_hint="imessage") for h in handles}
            for p in people.values():
                snap.add(p)
            label = display or ", ".join(p.label for p in people.values()) or ident
            msgs = db.execute(
                f"""SELECT m.guid, m.text, m.attributedBody, m.is_from_me, m.date, m.is_read, h.id
                   FROM message m JOIN chat_message_join j ON j.message_id = m.ROWID
                   LEFT JOIN handle h ON h.ROWID = m.handle_id
                   WHERE j.chat_id IN ({marks}) AND m.item_type = 0 AND m.associated_message_type = 0
                     AND m.date > ?
                   ORDER BY m.date DESC LIMIT ?""", (*rowids, floor, MESSAGES_PER_THREAD)).fetchall()
            if not msgs:
                continue
            last_at = (APPLE_EPOCH + timedelta(seconds=(last or 0) / 1e9)).astimezone()
            unread = sum(1 for m in msgs if not m[3] and not m[5])
            newest_text = body_text(msgs[0][1], msgs[0][2])
            newest_from_me = bool(msgs[0][3])
            first_person = next(iter(people.values()), None)
            space = space_for({"props": first_person.props} if first_person else None, mapping)
            tid = snap.add(Node(f"thread:imessage:{ident}", "Thread", clip(label, 60), {
                "app": "Messages", "handle": ident, "group": group, "unread": unread,
                "last_at": last_at.isoformat(), "last_from_me": newest_from_me,
                "reply_to": ident if not group and handles else ""}))
            snap.add(space_node(space))
            snap.link(tid, "BELONGS_TO", f"space:{space}")
            for p in people.values():
                snap.link(tid, "PARTICIPANT", p.id)
            known = bool(display) or any(not p.unresolved for p in people.values())
            for guid, text, blob, from_me, date, _read, handle in msgs:
                at = (APPLE_EPOCH + timedelta(seconds=(date or 0) / 1e9)).astimezone()
                words = body_text(text, blob)
                sender = me if from_me else (people.get(handle).id if handle in people else
                                             snap.add(person_node(ids, handle or ident, source_hint="imessage")))
                mid = snap.add(Node(f"message:imessage:{guid}", "Message", clip(words, 160) or "Attachment",
                                    {"from_me": bool(from_me), "at": at.isoformat()}, observed_at=at.isoformat()))
                snap.link(mid, "IN_THREAD", tid)
                snap.link(mid, "SENT_BY", sender)
                # The same filters as AWAITS_REPLY_FROM, one message at a time:
                # the first pass made Tasks of four Amazon pickup reminders, a
                # pharmacy short code and a lone "please" (pilot, 2026-10-04).
                if (not from_me and len((words or "").strip()) >= MIN_TASK_CHARS and REQUEST.search(words or "")
                        and awaits_me([words], ident, group, known)):
                    who = snap.nodes[sender].label
                    task = snap.add(Node(
                        f"task:imessage:{guid}", "Task", clip(words, 100),
                        {"kind": "request", "status": "ready", "guess": True,
                         "provenance": f"from {who}'s text {at.strftime('%-I:%M%p').lower()}",
                         "at": at.isoformat()}, confidence=0.6, observed_at=at.isoformat()))
                    snap.link(task, "OWED_BY", me, confidence=0.6)
                    snap.link(task, "OWED_TO", sender, confidence=0.6)
                    snap.link(task, "EXTRACTED_FROM", mid)
                    snap.link(task, "BELONGS_TO", f"space:{space}")
            burst = []
            for m in msgs:
                if m[3]:
                    break
                burst.append(body_text(m[1], m[2]))
            if awaits_me(list(reversed(burst)), ident, group, known):
                snap.link(tid, "AWAITS_REPLY_FROM", me, confidence=0.9 if not group else 0.6,
                          props={"since": last_at.isoformat()})
            elif newest_from_me and "?" in (newest_text or "") and not group and first_person:
                snap.link(tid, "AWAITS_REPLY_FROM", first_person.id, confidence=0.7,
                          props={"since": last_at.isoformat()})
    finally:
        db.close()
    return snap.write(graph, "imessage")


def address_of(sender: str) -> str:
    m = ADDRESS.search(sender or "")
    return ((m.group(1) or m.group(2) or "").strip().strip('"').lower()) if m else ""


def mail_is_person(sender: str) -> bool:
    addr = address_of(sender)
    return bool(addr) and not AUTOMATED_MAIL.search(addr) and " via " not in (sender or "").lower()


def mail(graph: Graph, ctx, ids: Identities, days: int = 7, mapping: dict = SPACE_BY_COMPANY) -> dict:
    rows = ctx.json(["mac", "mail", "unread", "--limit", "40", "--scan", "60", "--json"], "Mail")
    now = ctx.now()
    snap = Snapshot()
    me = snap.add(me_node())
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict) or row.get("isRead"):
            continue
        at = osgraph_time(row.get("date"))
        if at and at < now - timedelta(days=days):
            continue
        sender_raw = str(row.get("from", ""))
        address = address_of(sender_raw)
        name = re.sub(r"<[^>]*>", "", sender_raw).strip().strip('"') or address
        person = person_node(ids, address or name, label=name, source_hint="mail")
        pid = snap.add(person)
        human = mail_is_person(sender_raw)
        space = space_for({"props": person.props}, mapping)
        mid = snap.add(Node(f"mail:{slug(row.get('id', ''))}", "MailItem", clip(row.get("subject") or "(no subject)", 120),
                            {"app": "Mail", "from": name, "address": address, "automated": not human,
                             "at": at.isoformat() if at else "", "account": row.get("account", "")},
                            observed_at=at.isoformat() if at else ""))
        snap.link(mid, "SENT_BY", pid)
        snap.add(space_node(space))
        snap.link(mid, "BELONGS_TO", f"space:{space}")
        if human:
            snap.link(mid, "AWAITS_REPLY_FROM", me, confidence=0.6,
                      props={"since": at.isoformat() if at else ""})
    return snap.write(graph, "mail")


def osgraph_time(stamp) -> datetime | None:
    if not stamp:
        return None
    try:
        moment = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    except ValueError:
        return None
    return (moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)).astimezone()


def coursework(graph: Graph, ctx, ids: Identities, days: int = 14) -> dict:
    body = ctx.json(["coursework", "due", "--days", str(days), "--json"], "Coursework") or {}
    snap = Snapshot()
    me = snap.add(me_node())
    snap.add(space_node("school"))
    for bucket in ("overdue", "upcoming"):
        for row in body.get(bucket) or []:
            if not isinstance(row, dict) or not row.get("name"):
                continue
            course = str(row.get("course") or "")
            aid = snap.add(Node(f"assignment:{slug(course)}:{slug(row['name'])}", "Assignment",
                                clip(f"{course} {row['name']}", 90),
                                {"course": course, "status": row.get("status") or "", "overdue": bucket == "overdue",
                                 "type": row.get("type") or "", "app": "Class"}))
            snap.link(aid, "OWED_BY", me)
            snap.link(aid, "BELONGS_TO", "space:school")
            day = str(row.get("date") or row.get("due") or "")[:10]
            if re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
                snap.add(day_node(day))
                snap.link(aid, "DUE_ON", f"day:{day}")
    return snap.write(graph, "coursework")


def calendar(graph: Graph, ctx, ids: Identities, days: int = 7) -> dict:
    now = ctx.now()
    rows = ctx.json(["mac", "calendar", "list", "--from", now.strftime("%Y-%m-%d"),
                     "--to", (now + timedelta(days=days)).strftime("%Y-%m-%d"), "--json"], "Calendar")
    snap = Snapshot()
    me = snap.add(me_node())
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict) or not row.get("title") or not row.get("start"):
            continue
        start = osgraph_time(row["start"])
        if start is None:
            continue
        day = (datetime.fromisoformat(row["start"].replace("Z", "+00:00")).date()
               if row.get("isAllDay") else start.date()).isoformat()
        key = row.get("id") or f"{slug(row['title'])}-{row['start']}"
        eid = snap.add(Node(f"event:{slug(key)}", "Event", clip(row["title"], 80),
                            {"start": start.isoformat(), "end": str(row.get("end") or ""),
                             "all_day": bool(row.get("isAllDay")), "calendar": row.get("calendar", ""),
                             "app": "Calendar"}))
        snap.add(day_node(day))
        snap.link(eid, "DUE_ON", f"day:{day}")
        snap.link(me, "ATTENDS", eid)
        for attendee in row.get("attendees") or []:
            addr = attendee.get("email") if isinstance(attendee, dict) else str(attendee)
            if addr and "@" in addr:
                pid = snap.add(person_node(ids, addr, source_hint="calendar"))
                snap.link(pid, "ATTENDS", eid)
    return snap.write(graph, "calendar")


def backlog_paths(ctx) -> list[Path]:
    raw = ctx.env.get("KYBER_SURFACES_BACKLOG")
    if raw is not None:
        return [Path(p).expanduser() for p in raw.split(":") if p]
    return [Path(p) for p in sorted(glob.glob(str(ctx.home / "second-brain" / "projects" / "*" / "backlog.csv")))]


def owner_people(owner: str, ids: Identities, me_name: str) -> list[Node]:
    """The people a backlog `owner` cell names. Its names are first names
    ("Caleb + Sagar + Karthik"), and a first name is never enough to pick a
    person, so anyone who is not the owner of this machine is an unresolved
    name node unless the people store has exactly one person by that exact
    name or nickname."""
    out = []
    for part in re.split(r"\s*(?:\+|,|&|/|\band\b)\s*", owner or ""):
        name = part.strip()
        if not name or len(name) > 40:
            continue
        if name.lower() == me_name.lower():
            out.append(me_node())
            continue
        found = ids.by_name(name)
        if len(found) == 1:
            p = found[0]
            out.append(Node(f"person:{p['id']}", "Person", p["name"], {"company": p["company"]}))
        else:
            out.append(Node(f"person:name:{slug(name)}", "Person", name, {"named_in": "backlog"}, 0.4, True))
    return out


def backlog(graph: Graph, ctx, ids: Identities, days: int = 7) -> dict:
    me_name = ctx.env.get("KYBER_SURFACES_OWNER") or "Caleb"
    snap = Snapshot()
    snap.add(me_node())
    for path in backlog_paths(ctx):
        project = path.parent.name
        space = "amber" if any(w in project.lower() for w in ("amber", "zeutara")) else "personal"
        pid = snap.add(Node(f"project:{slug(project)}", "Project", project, {"path": str(path.parent)}))
        snap.add(space_node(space))
        snap.link(pid, "BELONGS_TO", f"space:{space}")
        with path.open(newline="", encoding="utf-8") as f:
            for item in csv.DictReader(f):
                status = (item.get("status") or "").strip().lower()
                if status not in BACKLOG_LIVE:
                    continue
                tid = snap.add(Node(f"task:backlog:{slug(project)}:{slug(item.get('id') or item.get('title'))}", "Task",
                                    clip(item.get("title") or item.get("id"), 100),
                                    {"kind": "backlog", "status": status, "priority": item.get("priority", ""),
                                     "lane": item.get("lane", ""), "next": clip(item.get("next_action"), 160),
                                     "key": item.get("id", ""), "path": str(path),
                                     "provenance": f"backlog {item.get('id', '')}".strip(),
                                     "updated": item.get("updated", "")}))
                snap.link(tid, "ABOUT", pid)
                snap.link(tid, "BELONGS_TO", f"space:{space}")
                for person in owner_people(item.get("owner", ""), ids, me_name):
                    snap.add(person)
                    snap.link(tid, "OWED_BY", person.id, confidence=person.confidence)
                due = (item.get("due_date") or "").strip()[:10]
                if re.fullmatch(r"\d{4}-\d{2}-\d{2}", due):
                    snap.add(day_node(due))
                    snap.link(tid, "DUE_ON", f"day:{due}")
    return snap.write(graph, "backlog")


def people_tasks(graph: Graph, ctx, ids: Identities, days: int = 7) -> dict:
    """`people task add maggie "send her the book"`: owed by me, owed to them."""
    snap = Snapshot()
    me = snap.add(me_node())
    for task in getattr(ids, "tasks", []):
        person = ids.people.get(task["person_id"])
        tid = snap.add(Node(f"task:people:{task['id']}", "Task", clip(task["title"], 100),
                            {"kind": "promise", "status": "ready", "provenance": "people task"}))
        snap.link(tid, "OWED_BY", me)
        if person:
            pid = snap.add(Node(f"person:{person['id']}", "Person", person["name"], {"company": person["company"]}))
            snap.link(tid, "OWED_TO", pid)
        due = str(task.get("due_at") or "")[:10]
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", due):
            snap.add(day_node(due))
            snap.link(tid, "DUE_ON", f"day:{due}")
    return snap.write(graph, "people")


def reminders(graph: Graph, ctx, ids: Identities, days: int = 7) -> dict:
    """Open Reminders due by the end of the window, as Tasks owed by me.
    Reminders on this Mac reach back to 2024 (2026-10-04: 11 open, the oldest
    due 2024-08-18), so an overdue one only counts within the window."""
    now = ctx.now()
    rows = ctx.json(["mac", "reminders", "list", "--due-before",
                     (now + timedelta(days=days)).strftime("%Y-%m-%d"), "--json"], "Reminders")
    snap = Snapshot()
    me = snap.add(me_node())
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict) or row.get("isCompleted") or not row.get("title"):
            continue
        due = osgraph_time(row.get("due"))
        if due is None or due < now - timedelta(days=days):
            continue
        tid = snap.add(Node(f"task:reminder:{slug(row.get('id') or row['title'])}", "Task", clip(row["title"], 100),
                            {"kind": "promise", "status": "ready", "app": "Reminders",
                             "provenance": f"Reminders, {row.get('list') or 'list'}"}))
        snap.link(tid, "OWED_BY", me)
        day = due.date().isoformat()
        snap.add(day_node(day))
        snap.link(tid, "DUE_ON", f"day:{day}")
    return snap.write(graph, "reminders")


def agents(graph: Graph, ctx, ids: Identities, days: int = 7) -> dict:
    import agent_board  # noqa: PLC0415  bin/lib; imports jev, so only loaded when this source runs

    snap = Snapshot()
    me = snap.add(me_node())
    snap.add(space_node("chewbacca"))
    for s in agent_board.ordered(agent_board.load()):
        at = datetime.fromtimestamp(float(s.get("t") or 0)).astimezone().isoformat()
        status = {"waiting": "stuck", "running": "cooking", "done": "done"}.get(s["state"], "ready")
        tid = snap.add(Node(f"task:agent:{slug(s['session'])}", "Task", clip(agent_board.name(s), 80),
                            {"kind": "agent", "status": status, "tty": s.get("tty") or "",
                             "doing": clip(s.get("text"), 100), "at": at,
                             "provenance": f"Claude session in {s.get('folder', '')}"}, observed_at=at))
        snap.link(tid, "BELONGS_TO", "space:chewbacca")
        if s["state"] == "waiting":
            snap.link(tid, "OWED_BY", me)
    return snap.write(graph, "agents")


INGESTERS = {
    "imessage": imessage, "mail": mail, "coursework": coursework, "calendar": calendar,
    "backlog": backlog, "people": people_tasks, "reminders": reminders, "agents": agents,
}


def ingest_all(graph: Graph, ctx, days: int = 7, only: list[str] | None = None,
               ids: Identities | None = None) -> dict:
    """Run every ingester; one failing never stops the others. Returns
    {source: counts or error}."""
    ids = ids or Identities()
    report = {}
    for name, fn in INGESTERS.items():
        if only and name not in only:
            continue
        try:
            report[name] = fn(graph, ctx, ids, days=days)
        except osgraph.OntologyError as err:
            report[name] = {"error": f"ontology: {err}"}
        except Exception as err:  # noqa: BLE001  one dead source must not stop the rest
            report[name] = {"error": clip(str(err), 160)}
    return report


def dumps(report: dict) -> str:
    return json.dumps(report, indent=1, default=str)
