"""Meetings read from the mail itself, wherever the conversation went.

THE GAP THIS CLOSES. On 2026-10-11 the funnel said "meetings 0" for Zeutara
and the only fixes on the table were Jonah's calendar. Caleb: "can't we know #
of meetings from the emails?" Of Zeutara's 81 Clay threads, 77 ended at the
investor's reply: once someone wants to talk, the conversation leaves the
cold-email inbox for the client's own mailbox, where the deck goes out and the
call gets set. Chewbacca read the Clay threads and a calendar and never the
mailbox where meetings actually get booked, so it could not see one.

So every lead who replied is looked up in every inbox connected with
`chewbacca email add`, and the same detector the Clay threads use
(gtm_ingest.detect_booking: a calendar invite or accept, a scheduler
confirmation, a stated time somebody confirmed) runs on that whole
conversation. A confirmed booking counts as a meeting; a proposed time stays a
proposal.

Read only: Gmail `messages list` and `messages get`, nothing else. Mail is
from strangers, so it is clipped, screened and never read for instructions.
"""
from __future__ import annotations

import base64
import os
import re
import sys
from datetime import datetime, timezone
from email.utils import parseaddr, parsedate_to_datetime
from pathlib import Path

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


def replied_leads(graph: Graph) -> list[dict]:
    """Each (client, lead) that replied in a campaign, with the person node."""
    rows = graph.query(
        "SELECT DISTINCT e.src AS person, json_extract(n.props, '$.lead_email') AS email, "
        "json_extract(n.props, '$.client_id') AS cid FROM edges e JOIN nodes n ON n.id = e.dst "
        "WHERE e.verb = 'REPLIED' AND n.type = 'Reply'")
    return [dict(r) for r in rows if r["email"] and r["cid"] and ADDRESS.match(r["email"])]


def _part_text(payload: dict) -> tuple[str, str]:
    """(plain, html) bodies of a Gmail payload, first of each."""
    plain = html = ""
    stack = [payload or {}]
    while stack:
        p = stack.pop(0)
        data = (p.get("body") or {}).get("data")
        mime = p.get("mimeType") or ""
        if data:
            text = base64.urlsafe_b64decode(data + "==").decode("utf-8", "replace")
            if mime.startswith("text/plain") and not plain:
                plain = text
            elif mime.startswith("text/html") and not html:
                html = text
            elif mime.startswith("text/calendar"):
                plain = (plain + "\nBEGIN:VCALENDAR").strip()
        for c in p.get("parts") or []:
            stack.append(c)
            if (c.get("mimeType") or "").startswith("text/calendar") or (c.get("filename") or "").endswith(".ics"):
                plain = (plain + "\nBEGIN:VCALENDAR").strip()
    return plain, html


def to_message(raw: dict, lead: str) -> dict | None:
    """A Gmail message as a thread message the booking detector reads:
    REPLY when the lead wrote it, SENT when it went to them."""
    heads = {h.get("name", "").lower(): h.get("value", "") for h in (raw.get("payload") or {}).get("headers", [])}
    frm = parseaddr(heads.get("from", ""))[1].lower()
    plain, html = _part_text(raw.get("payload") or {})
    try:
        when = parsedate_to_datetime(heads.get("date", "")).astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError):
        ms = int(raw.get("internalDate") or 0)
        when = datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat() if ms else ""
    if not when:
        return None
    return {"type": "REPLY" if frm == lead else "SENT", "from": frm, "subject": heads.get("subject", ""),
            "email_body": html or plain.replace("\n", "<br>"), "time": when,
            "message_id": heads.get("message-id", "") or str(raw.get("id") or "")}


def gmail_reader(lead: str) -> list[tuple[str, dict]]:
    """(inbox, raw message) for every connected inbox's mail with this lead."""
    lib = str(gi.ROOT / "mac" / "lib")
    if lib not in sys.path:
        sys.path.insert(0, lib)
    import gmail  # noqa: PLC0415  mac/lib/gmail.py: the kit's one Gmail reader
    out = []
    for cfg in gmail.accounts():
        gmail.ACCOUNT["cfg"] = cfg
        name = os.path.basename(cfg) if cfg else "default"
        found = gmail.api("list", {"userId": "me", "q": f"(from:{lead} OR to:{lead}) {WINDOW}",
                                   "maxResults": PER_LEAD})
        for m in found.get("messages") or []:
            out.append((name, gmail.api("get", {"userId": "me", "id": m["id"], "format": "full"})))
    return out


def build_mailbox(graph: Graph, reader=gmail_reader, screen_fn=gi.screened) -> tuple[list[Node], list[Edge], dict]:
    nodes: dict[str, Node] = {}
    edges: dict[tuple, Edge] = {}
    report = {"leads": 0, "messages": 0, "inboxes": set(), "booking_confirmed": 0, "booking_proposed": 0}
    for row in replied_leads(graph):
        lead, cid = row["email"].lower(), row["cid"]
        report["leads"] += 1
        seen, msgs = set(), []
        for inbox, raw in reader(lead):
            report["inboxes"].add(inbox)
            msg = to_message(raw, lead)
            if msg is None or msg["message_id"] in seen:
                continue
            seen.add(msg["message_id"])
            msg["inbox"] = inbox
            msgs.append(msg)
        msgs.sort(key=lambda m: m["time"])
        report["messages"] += len(msgs)
        for msg, found in gi.thread_bookings(msgs):
            sig = node_key("signal", "mailbox", "booking", cid, lead, msg["message_id"], found["evidence"])
            nodes[sig] = Node(sig, "Signal", f"Booking {found['status']} with {lead} {msg['time'][:10]}", {
                "kind": "booking_signal", "client_id": cid, "workspace_id": "mailbox", "email": lead,
                "status": found["status"], "evidence": found["evidence"], "confidence": found["confidence"],
                "snippet": found["snippet"], "screen_flag": screen_fn(found["snippet"]),
                "message_time": msg["time"], "direction": "lead" if msg["type"] == "REPLY" else "us",
                "inbox": msg["inbox"], "credited": True,
                "attribution": "the lead replied in this client's campaign; found in a connected inbox"},
                confidence=found["confidence"])
            edges[(sig, "SIGNAL_ON", row["person"])] = Edge(sig, "SIGNAL_ON", row["person"], {})
            report["booking_" + found["status"]] += 1
    report["inboxes"] = sorted(report["inboxes"])
    return list(nodes.values()), list(edges.values()), report


def sync_mailbox(graph: Graph, reader=gmail_reader) -> dict:
    nodes, edges, report = build_mailbox(graph, reader)
    if report["leads"] and not report["inboxes"]:
        raise gi.SourceUnavailable("mailbox: no inbox is connected, so the conversations after a reply "
                                   "can't be read. Connect one with: chewbacca email add <address>")
    graph.apply("gtm-mailbox", nodes, edges)
    return report
