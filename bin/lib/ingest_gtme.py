"""GTME work into the OS graph, so outbound shows up where everything else
does: the needs-you surface, not a command the person has to remember.

Two kinds of item become Tasks owed by the person:
- a batch of cold emails chewbacca built and froze, waiting for their ok
  (tools/gtme_solo.py), while its 2 hour approval window is open;
- a lead's reply that a person has to answer (interested, a question, a deck
  request, anything unclear). Opt-outs, bounces and out-of-office replies are
  handled on their own and never land here.

Read only. It never builds, sends or drafts anything; the ok still goes
through `chewbacca gtme send --batch <id>`. Reply text is not copied into the
graph: the row names who replied and what kind of reply it is.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import osgraph
from osgraph import Graph, Identities, Node, me_node

# The approval window gtme_solo.send enforces; a batch past it can't be sent,
# so it stops needing anyone.
BATCH_TTL = timedelta(hours=2)
# Kinds tools/gtme_reply.py marks as needing a person (its AUTO_HANDLED is the rest).
NEEDS_PERSON = {"interested": "wants to talk", "question": "asked a question", "deck": "asked for a deck",
                "form": "sent a form to fill", "referral": "pointed you to someone", "unclear": "replied"}


def home() -> Path:
    return Path(os.environ.get("GTME_HOME") or Path.home() / ".chewbacca" / "gtm")


def _time(text: str) -> datetime | None:
    try:
        t = datetime.fromisoformat(text)
    except (TypeError, ValueError):
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def _jsonl(path: Path) -> list[dict]:
    try:
        return [json.loads(x) for x in path.read_text().splitlines() if x.strip()]
    except (OSError, ValueError):
        return []


def gtme(graph: Graph, ctx, ids: Identities, days: int = 7) -> dict:
    from osgraph_ingest import Snapshot  # noqa: PLC0415  osgraph_ingest imports this module lazily

    snap = Snapshot()
    me = snap.add(me_node())
    now = ctx.now()
    root = home() / "clients"
    for plan_file in sorted(root.glob("*/plan.json")) if root.is_dir() else []:
        d = plan_file.parent
        try:
            client = json.loads(plan_file.read_text()).get("client") or d.name
        except (OSError, ValueError):
            continue
        for bf in sorted((d / "batches").glob("*.json")):
            try:
                b = json.loads(bf.read_text())
            except (OSError, ValueError):
                continue
            made = _time(b.get("made_at"))
            if b.get("sent_at") or not b.get("mails") or not made or now - made > BATCH_TTL:
                continue
            n = len(b["mails"])
            tid = snap.add(Node(osgraph.node_key("task", "gtme", client, b["id"]), "Task",
                                f"{n} cold email{'s' if n != 1 else ''} for {client} ready to send",
                                {"kind": "gtme", "status": "ready", "app": "Outbound", "at": made.isoformat(),
                                 "why": "waiting for your ok", "client": client, "batch": b["id"],
                                 "provenance": f"chewbacca gtme batch {b['id']}"}, observed_at=made.isoformat()))
            snap.link(tid, "OWED_BY", me)
        answered = {r.get("to") for r in _jsonl(d / "drafted.jsonl")}
        for r in _jsonl(d / "replies.jsonl"):
            at = _time(r.get("at"))
            what = NEEDS_PERSON.get(r.get("kind"))
            if not what or not at or now - at > timedelta(days=days) or r.get("from") in answered:
                continue
            tid = snap.add(Node(osgraph.node_key("task", "gtme", client, r.get("gmail_id") or ""), "Task",
                                f"{r.get('from')} {what}",
                                {"kind": "gtme", "status": "ready", "app": "Outbound", "at": at.isoformat(),
                                 "why": f"a lead for {client} {what}", "client": client,
                                 "provenance": f"chewbacca gtme inbox, {client}"}, observed_at=at.isoformat()))
            snap.link(tid, "OWED_BY", me)
    return snap.write(graph, "gtme")
