"""Meetings read from the mail itself, wherever the conversation went.

THE GAP THIS CLOSES. On 2026-10-11 the funnel said "meetings 0" for Zeutara
and the only fixes on the table were Jonah's calendar. Caleb: "can't we know #
of meetings from the emails?" Of Zeutara's 81 Clay threads, 77 ended at the
investor's reply: once someone wants to talk, the conversation leaves the
cold-email inbox for the client's own mailbox, where the deck goes out and the
call gets set. Chewbacca read the Clay threads and a calendar and never the
mailbox where meetings actually get booked, so it could not see one.

So every lead who replied is looked up in the inboxes connected with
`chewbacca email add`, and the same detector the Clay threads use
(gtm_ingest.detect_booking) runs on that whole conversation.

WHO A BOOKING BELONGS TO (security reviews of 1e5f7e4e and 2ce02c27). One Mac
holds several clients' inboxes and the owner's own, so a client reads only the
inboxes its config names (`"mailboxes": ["jonah@zeutara.com"]`), never a
default. A lead enrolled by two clients is credited to neither.

WHAT COUNTS AS CONFIRMED (same review). Anyone can send an email titled
"Invitation:" with an .ics attached, so a lead's own message never confirms a
meeting by itself. Our side is decided by Gmail's SENT label, never by a From
header the sender wrote. Confirmed means our side sent the invite or the
confirmation, or the lead accepted an invite our side sent. Anything else a
lead wrote that looks like a booking is kept as proposed.

Read only: Gmail `messages list` and `messages get`. Mail is from strangers,
so it is clipped, screened and never read for instructions.
"""
from __future__ import annotations

import base64
import os
import re
import sys
from datetime import datetime, timezone
from email.utils import parseaddr

import gtm_ingest as gi
from osgraph import Edge, Graph, Node, node_key

# A lead address goes into a Gmail search, so it must be one plain address:
# a crafted "a@b.c OR in:anywhere" would widen the search to the whole box.
ADDRESS = re.compile(r"^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8}$")
# How far back a conversation is read. Zeutara's first sends were 2026-09-28;
# a quarter covers a campaign and its follow-ups. Guessed, not measured.
WINDOW = "newer_than:120d"
# Messages per lead per inbox. The longest Zeutara thread was 10 messages.
PER_LEAD = 25
OUR_EVIDENCE = {"calendar_invite", "scheduler_confirmation", "time_confirmed", "time_confirmed_in_reply"}


def replied_leads(graph: Graph) -> list[dict]:
    """Each (client, lead) that replied in a campaign, with the person node."""
    rows = graph.query(
        "SELECT DISTINCT e.src AS person, json_extract(n.props, '$.lead_email') AS email, "
        "json_extract(n.props, '$.client_id') AS cid FROM edges e JOIN nodes n ON n.id = e.dst "
        "WHERE e.verb = 'REPLIED' AND n.type = 'Reply'")
    return [dict(r) for r in rows if r["email"] and r["cid"] and ADDRESS.match(r["email"])]


def exclusive(graph: Graph, cfg: dict) -> dict[str, str]:
    """lead email -> the one client whose campaigns enrolled it. A lead two
    clients enrolled maps to nobody."""
    owner: dict[str, str] = {}
    shared: set[str] = set()
    for client in cfg.get("clients") or []:
        cid = gi.client_id(client)
        for email in gi.client_lead_emails(graph, cid):
            e = email.lower()
            if e in owner and owner[e] != cid:
                shared.add(e)
            owner.setdefault(e, cid)
    return {e: c for e, c in owner.items() if e not in shared}


def inboxes_for(cfg: dict, cid: str, connected: list[str]) -> list[str]:
    clients = cfg.get("clients") or []
    client = next((c for c in clients if gi.client_id(c) == cid), None)
    if client is None:
        return []
    # Only inboxes the client names, even with one client: the second security
    # review (2026-10-11) found the one-client fallback read whatever else was
    # connected, the owner's personal Gmail included.
    named = [str(x).lower() for x in client.get("mailboxes") or []]
    return [i for i in connected if i.lower() in named]


def _part_text(payload: dict) -> tuple[str, str, bool]:
    """(plain, html, has a calendar part) of a Gmail payload."""
    plain = html = ""
    ics = False
    stack = [payload or {}]
    while stack:
        p = stack.pop(0)
        mime = p.get("mimeType") or ""
        if mime.startswith("text/calendar") or (p.get("filename") or "").endswith(".ics"):
            ics = True
        data = (p.get("body") or {}).get("data")
        if data:
            text = base64.urlsafe_b64decode(data + "==").decode("utf-8", "replace")
            if mime.startswith("text/plain") and not plain:
                plain = text
            elif mime.startswith("text/html") and not html:
                html = text
        stack.extend(p.get("parts") or [])
    return plain, html, ics


def to_message(raw: dict, lead: str) -> dict | None:
    """A Gmail message as a thread message the booking detector reads. SENT
    (our side) comes from Gmail's own SENT label, which a sender cannot set."""
    heads = {h.get("name", "").lower(): h.get("value", "") for h in (raw.get("payload") or {}).get("headers", [])}
    ours = "SENT" in (raw.get("labelIds") or [])
    frm = parseaddr(heads.get("from", ""))[1].lower()
    if not ours and frm != lead:
        return None  # a third party in the thread: not the lead, not us
    plain, html, ics = _part_text(raw.get("payload") or {})
    # Gmail's own receive time orders the conversation. The Date header is
    # whatever the sender wrote, so a backdated "accept" could otherwise sit
    # after an invite it never answered (second security review, 2026-10-11).
    try:
        ms = int(raw.get("internalDate") or 0)
    except (TypeError, ValueError):
        ms = 0
    when = datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat() if ms else ""
    if not when:
        return None
    body = html or plain.replace("\n", "<br>")
    if ics:
        body += "<br>BEGIN:VCALENDAR"
    return {"type": "SENT" if ours else "REPLY", "from": frm, "subject": heads.get("subject", ""),
            "email_body": body, "time": when,
            "message_id": heads.get("message-id", "") or str(raw.get("id") or "")}


def connected_inboxes() -> list[str]:
    lib = str(gi.ROOT / "mac" / "lib")
    if lib not in sys.path:
        sys.path.insert(0, lib)
    import gmail  # noqa: PLC0415  mac/lib/gmail.py: the kit's one Gmail reader
    return [gmail.inbox_name(c) or "default" for c in gmail.accounts()]


def gmail_reader(lead: str, inbox: str) -> list[dict]:
    """Raw Gmail messages with this lead in one connected inbox."""
    import gmail  # noqa: PLC0415  loaded by connected_inboxes
    cfg = gmail.inbox_dir("" if inbox == "default" else inbox)
    if cfg is False:
        return []
    gmail.ACCOUNT["cfg"] = cfg
    found = gmail.api("list", {"userId": "me", "q": f"(from:{lead} OR to:{lead}) {WINDOW}", "maxResults": PER_LEAD})
    return [gmail.api("get", {"userId": "me", "id": m["id"], "format": "full"}) for m in found.get("messages") or []]


def trusted(msgs: list[dict], msg: dict, found: dict) -> str:
    """The status a finding may carry: "confirmed" only on our side's word."""
    if found["status"] != "confirmed":
        return found["status"]
    if msg["type"] == "SENT" and found["evidence"] in OUR_EVIDENCE:
        return "confirmed"
    if msg["type"] == "REPLY" and found["evidence"] == "calendar_accept":
        earlier = [m for m in msgs if m["type"] == "SENT" and m["time"] <= msg["time"]]
        if any((gi.detect_booking(m) or {}).get("evidence") == "calendar_invite" for m in earlier):
            return "confirmed"
    return "proposed"


def build_mailbox(graph: Graph, cfg: dict, inboxes: list[str], reader=None,
                  screen_fn=gi.screened) -> tuple[list[Node], list[Edge], dict]:
    reader = reader or gmail_reader
    owner = exclusive(graph, cfg)
    nodes: dict[str, Node] = {}
    edges: dict[tuple, Edge] = {}
    report = {"leads": 0, "messages": 0, "inboxes": inboxes, "skipped_shared": 0, "skipped_no_inbox": 0,
              "booking_confirmed": 0, "booking_proposed": 0}
    for row in replied_leads(graph):
        lead, cid = row["email"].lower(), row["cid"]
        if owner.get(lead) != cid:
            report["skipped_shared"] += 1
            continue
        mine = inboxes_for(cfg, cid, inboxes)
        if not mine:
            report["skipped_no_inbox"] += 1
            continue
        report["leads"] += 1
        seen, msgs = set(), []
        for inbox in mine:
            for raw in reader(lead, inbox):
                msg = to_message(raw, lead)
                if msg is None or msg["message_id"] in seen:
                    continue
                seen.add(msg["message_id"])
                msg["inbox"] = inbox
                msgs.append(msg)
        msgs.sort(key=lambda m: m["time"])
        report["messages"] += len(msgs)
        for msg, found in gi.thread_bookings(msgs):
            status = trusted(msgs, msg, found)
            sig = node_key("signal", "mailbox", "booking", cid, lead, msg["message_id"], found["evidence"])
            nodes[sig] = Node(sig, "Signal", f"Booking {status} with {lead} {msg['time'][:10]}", {
                "kind": "booking_signal", "client_id": cid, "workspace_id": "mailbox", "email": lead,
                "status": status, "evidence": found["evidence"], "confidence": found["confidence"],
                "snippet": found["snippet"], "screen_flag": screen_fn(found["snippet"]),
                "message_time": msg["time"], "direction": "lead" if msg["type"] == "REPLY" else "us",
                "inbox": msg["inbox"], "credited": True,
                "attribution": "the lead replied in this client's campaign only; found in this client's inbox"},
                confidence=found["confidence"])
            edges[(sig, "SIGNAL_ON", row["person"])] = Edge(sig, "SIGNAL_ON", row["person"], {})
            report["booking_" + status] += 1
    return list(nodes.values()), list(edges.values()), report


def sync_mailbox(graph: Graph, cfg: dict, reader=None, inboxes: list[str] | None = None) -> dict:
    inboxes = connected_inboxes() if inboxes is None else inboxes
    if not inboxes:
        raise gi.SourceUnavailable("mailbox: no inbox is connected, so the conversations after a reply "
                                   "can't be read. Connect one with: chewbacca email add <address>")
    nodes, edges, report = build_mailbox(graph, cfg, inboxes, reader)
    graph.apply("gtm-mailbox", nodes, edges)
    return report
