"""Bridged chats on the glass: the last week of Signal, Telegram, Discord,
Instagram, Messenger, X, Google Messages, Google Chat, Google Voice, LinkedIn
and Bluesky as Thread, Message and Person nodes, so needs-you and the person
panel show them next to iMessage, WhatsApp and mail.

Read from the people store, never from the homeserver: `people texts sync`
already filed every bridged row there (mac/lib/matrix.py), with the person
decided by address only. A row the store linked to a person is that person;
any other sender is its own node labelled with the raw handle, the same rule
as person_node. A display name never labels anyone, because on Telegram and
Discord the sender picks it.

Read-only, and nothing here sends. A Thread carries `network` and `chat_room`
and never `reply_to`, which the walks treat as an iMessage handle: a reply to
a bridged thread goes through `people texts drafts` and `people send`, where
the no-send rules live. Message text is cleaned and clipped like WhatsApp's
(ingest_whatsapp.clean); the one thing read from it is AWAITS_REPLY_FROM, by
the iMessage rule (osgraph_ingest.awaits_me).
"""
from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

import osgraph
from sqlite_ro import open_ro
from osgraph import Graph, Identities, Node, me_node, person_node, space_node

SOURCE = "chats"
# Must match BRIDGED in bin/lib/people/apps.js (tests/chewbacca_chat.sh checks).
BRIDGED = ("signal", "telegram", "discord", "instagram", "messenger", "twitter",
           "gmessages", "googlechat", "gvoice", "linkedin", "bluesky")
LABELS = {"signal": "Signal", "telegram": "Telegram", "discord": "Discord", "instagram": "Instagram",
          "messenger": "Messenger", "twitter": "X", "gmessages": "Google Messages",
          "googlechat": "Google Chat", "gvoice": "Google Voice", "linkedin": "LinkedIn", "bluesky": "Bluesky"}
# Bridged rows start at 6e12 (mac/lib/matrix.py ID_BASE). The LinkedIn export
# below that has no sender and was never a conversation that waits on anyone.
BRIDGED_FLOOR = 6_000_000_000_000
MESSAGES_PER_THREAD = 5
# Guessed, never measured: a week across eleven networks for one person.
MOST_ROWS = 4000


def people_db() -> Path:
    return Path(os.environ.get("PEOPLE_DB")
                or Path(os.environ.get("PEOPLE_DIR") or Path.home() / ".chewbacca" / "people") / "people.db")


def chats(graph: Graph, ctx, ids: Identities, days: int = 7) -> dict:
    from ingest_whatsapp import clean  # noqa: PLC0415
    from osgraph_ingest import SPACE_BY_COMPANY, Snapshot, awaits_me, space_for  # noqa: PLC0415

    path = people_db()
    snap = Snapshot()
    me = snap.add(me_node())
    if not path.exists():
        report = snap.write(graph, SOURCE)
        report["note"] = "no people store yet"
        return report
    since = (ctx.now() - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
    marks = ",".join("?" * len(BRIDGED))
    db = open_ro(path, timeout=2)
    try:
        rows = db.execute(
            f"""SELECT msg_id, person_id, who, handle, from_me, body, sent_at, room, source FROM messages
                 WHERE source IN ({marks}) AND msg_id >= ? AND sent_at >= ?
                 ORDER BY sent_at DESC LIMIT ?""", (*BRIDGED, BRIDGED_FLOOR, since, MOST_ROWS)).fetchall()
    finally:
        db.close()
    threads: dict[tuple, list] = {}
    for r in rows:
        msg_id, pid, who, handle, from_me, body, sent_at, room, src = r
        # A 1:1 is keyed by the other person's handle, a group by its room.
        key = (src, "room", room) if room else (src, "dm", handle)
        threads.setdefault(key, []).append(r)

    def person_of(pid, handle, src) -> Node:
        if pid and pid in ids.people:
            p = ids.people[pid]
            return Node(f"person:{pid}", "Person", p["name"], {"company": p["company"]}, 1.0, False)
        return person_node(ids, handle or "", source_hint=src)

    for (src, kind, ident), msgs in threads.items():
        msgs = msgs[:MESSAGES_PER_THREAD]
        group = kind == "room"
        people: dict[str, Node] = {}
        for _id, pid, _who, handle, from_me, *_ in msgs:
            if not from_me and handle and handle not in people:
                people[handle] = person_of(pid, handle, src)
        if not group and ident not in people:
            first_pid = next((m[1] for m in msgs if m[1]), None)
            people[ident] = person_of(first_pid, ident, src)
        for p in people.values():
            snap.add(p)
        newest = msgs[0]
        last_at = datetime.fromisoformat(newest[6]).astimezone()
        label = (clean(ident, 52) + " (group)") if group else (people.get(ident).label if people.get(ident) else ident)
        first = None if group else people.get(ident)
        space = space_for({"props": first.props} if first else None, SPACE_BY_COMPANY)
        tid = snap.add(Node(osgraph.node_key("thread", src, kind, ident), "Thread", clean(label, 60), {
            "app": LABELS.get(src, src), "network": src, "group": group, "chat_room": ident if group else "",
            "last_at": last_at.isoformat(), "last_from_me": bool(newest[4])}))
        snap.add(space_node(space))
        snap.link(tid, "BELONGS_TO", f"space:{space}")
        for p in people.values():
            snap.link(tid, "PARTICIPANT", p.id)
        burst = []
        for msg_id, pid, _who, handle, from_me, body, sent_at, _room, _src in msgs:
            at = datetime.fromisoformat(sent_at).astimezone()
            sender = me if from_me else (people[handle].id if handle in people else "")
            mid = snap.add(Node(osgraph.node_key("message", src, str(msg_id)), "Message",
                                clean(body, osgraph.SNIPPET_CHARS) or "Attachment",
                                {"network": src, "from_me": bool(from_me), "at": at.isoformat()},
                                observed_at=at.isoformat()))
            snap.link(mid, "IN_THREAD", tid)
            if sender:
                snap.link(mid, "SENT_BY", sender)
        for m in msgs:
            if m[4]:
                break
            burst.append(clean(m[5]))
        known = group or any(not p.unresolved for p in people.values())
        if awaits_me(list(reversed(burst)), "" if group else ident, group, known):
            snap.link(tid, "AWAITS_REPLY_FROM", me, confidence=0.9 if not group else 0.6,
                      props={"since": last_at.isoformat()})
    report = snap.write(graph, SOURCE)
    report["threads"] = len(threads)
    return report
