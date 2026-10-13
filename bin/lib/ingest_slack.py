"""Slack on the glass: the last week of Slack DMs, group DMs and channel
@-mentions as Thread, Message and Person nodes, so needs-you and the person
panel show Slack next to iMessage, WhatsApp, mail and the bridged chats.

Read from slacrawl's own SQLite store (~/.slacrawl/slacrawl.db), which
`chewbacca slack` keeps current from the Slack desktop app's cache. Opened
read-only; nothing here touches Slack, its cache or its tokens. Sending stays
in `chewbacca slack` (slackcli) behind a person's press.

Slack was 1 h 41 m of Caleb's 62 h on 10/7 to 10/13 (screen-time) while none
of it reached the graph: 104 DM and 486 channel messages that week across
amberintelligence, clayrunhq and six USC class workspaces, and needs-you had
never seen one.

IDENTITY. slacrawl's users carry no email (0 of 486 on 2026-10-13), so a Slack
person can't be matched to the people store by address, and a name match is
the merge the house refuses (osgraph.person_node). Each Slack user is its own
node, labelled with the handle `@username in workspace`, never a display name
a stranger could set to "Karthik". "Me" is the workspace's own user_id.

Message text is someone else's words: cleaned and clipped like WhatsApp's
(ingest_whatsapp.clean); the one thing read from it is AWAITS_REPLY_FROM, by
the iMessage rule (osgraph_ingest.thread_awaits_me), and for a channel only an
@-mention of him counts.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import osgraph
from osgraph import Graph, Identities, Node, me_node, space_node
from ingest_whatsapp import clean

SOURCE = "slack"
NETWORK = "Slack"
MESSAGES_PER_THREAD = 5
# Slack's own accounts: Slackbot, and the "slack" DM the desktop app files
# under USLACK (seen 2026-10-13, no users row, so no is_bot to read).
SLACK_ITSELF = {"USLACKBOT", "USLACK"}
DM_KINDS = {"desktop_im", "im"}
GROUP_DM_KINDS = {"desktop_mpim", "mpim"}
CHANNEL_KINDS = {"desktop_channel", "desktop_private_channel", "channel", "private_channel"}
# Message subtypes that are not a person writing (joins, topic changes, bot
# posts). A plain message has no subtype; a thread reply sent to the channel
# is thread_broadcast; an upload is file_share.
SPOKEN = {"", "thread_broadcast", "file_share", "me_message"}
# Workspace name or domain word to space. "clay" is the Clay community
# workspace, where his Zeutara outbound questions live (Zeutara is Amber work).
SPACE_BY_WORKSPACE = {"amber": "amber", "clay": "amber", "zeutara": "amber",
                      "usc": "school", "university of southern california": "school"}
# The name osgraph_ingest.NAMED listens for.
OWNER = os.environ.get("KYBER_SURFACES_OWNER") or "Caleb"
MENTION = re.compile(r"<@([A-Z0-9]+)(?:\|[^>]*)?>")


def db_path(ctx) -> Path:
    env = getattr(ctx, "env", {}) or {}
    home = Path(getattr(ctx, "home", None) or Path.home())
    return Path(env.get("KYBER_SLACRAWL_DB") or home / ".slacrawl" / "slacrawl.db")


def space_of(workspace: dict) -> str:
    words = f"{workspace.get('name', '')} {workspace.get('domain', '')}".lower()
    for word, space in SPACE_BY_WORKSPACE.items():
        if word in words:
            return space
    return "personal"


def readable(text: str, users: dict, ws: str) -> str:
    """<@U123> becomes @username so a mention reads as a name, not an id."""
    return MENTION.sub(lambda m: "@" + users.get((ws, m.group(1)), {}).get("name", "someone"), text or "")


def person(ws: dict, uid: str, users: dict, fallback: str = "") -> Node:
    """`fallback` is a DM channel's own name, which the Slack desktop app
    sets to the other person's username: someone from another org in a
    shared channel has no users row (3 of 7 DMs on 2026-10-13)."""
    u = users.get((ws["id"], uid), {})
    handle = f"@{clean(u.get('name') or fallback or uid, 40)} in {clean(ws.get('domain') or ws.get('name') or 'slack', 40)}"
    return Node(f"person:slack:{ws['id']}:{uid}", "Person", handle,
                {"handle": handle, "seen_as": SOURCE, "slack_user": uid}, 0.5, True)


def slack(graph: Graph, ctx, ids: Identities, days: int = 7) -> dict:
    """The INGESTER: the last `days` of Slack as the "slack" snapshot. No
    slacrawl store is an empty snapshot with a note, never an error."""
    from osgraph_ingest import Snapshot, thread_awaits_me  # noqa: PLC0415

    path = db_path(ctx)
    snap = Snapshot()
    me = snap.add(me_node())
    if not path.exists():
        report = snap.write(graph, SOURCE)
        report["note"] = "Slack isn't linked on this Mac yet (chewbacca slack link)."
        return report
    now = ctx.now()
    since, until = (now - timedelta(days=days)).timestamp(), now.timestamp()
    # A copy, not the file: slacrawl keeps its store in WAL mode, and the
    # SQLite 3.43 in macOS's own python3 refuses a read-only open of a WAL
    # store whose -shm isn't there ("unable to open database file", seen
    # 2026-10-13 while 3.53 under Homebrew opened it). 32 MB copies in
    # milliseconds, and nothing here can then touch slacrawl's file.
    tmp = tempfile.TemporaryDirectory(prefix="ingest-slack-")
    copy = Path(tmp.name) / "slacrawl.db"
    shutil.copyfile(path, copy)
    if path.with_name(path.name + "-wal").exists():
        shutil.copyfile(path.with_name(path.name + "-wal"), copy.with_name(copy.name + "-wal"))
    db = sqlite3.connect(str(copy), timeout=2)
    try:
        workspaces = {}
        for wid, name, domain, raw in db.execute("SELECT id, name, domain, raw_json FROM workspaces"):
            try:
                me_id = (json.loads(raw) or {}).get("user_id") or ""
            except (ValueError, TypeError):
                me_id = ""
            workspaces[wid] = {"id": wid, "name": name or "", "domain": domain or "", "me": me_id}
        users = {(w, uid): {"name": name, "bot": bool(bot) or uid in SLACK_ITSELF}
                 for uid, w, name, bot in db.execute("SELECT id, workspace_id, name, is_bot FROM users")}
        channels = {cid: {"id": cid, "ws": w, "name": name, "kind": kind, "archived": bool(arch), "raw": raw}
                    for cid, w, name, kind, arch, raw in db.execute(
                        "SELECT id, workspace_id, name, kind, is_archived, raw_json FROM channels")}
        rows = db.execute(
            "SELECT channel_id, ts, workspace_id, coalesce(user_id, ''), coalesce(subtype, ''), text"
            " FROM messages WHERE CAST(ts AS REAL) >= ? AND CAST(ts AS REAL) <= ?"
            " AND coalesce(deleted_ts, '') = '' ORDER BY CAST(ts AS REAL) DESC", (since, until)).fetchall()
    finally:
        db.close()
        tmp.cleanup()

    by_channel: dict[str, list[tuple]] = {}
    for cid, ts, wid, uid, subtype, text in rows:
        if subtype in SPOKEN and cid in channels and wid in workspaces:
            by_channel.setdefault(cid, []).append((float(ts), uid, text))

    for cid, msgs in by_channel.items():
        ch = channels[cid]
        ws = workspaces[ch["ws"]]
        mine = ws["me"]
        if ch["archived"]:
            continue
        if ch["kind"] in DM_KINDS:
            try:
                other = (json.loads(ch["raw"]) or {}).get("user") or ""
            except (ValueError, TypeError):
                other = ""
            if not other or other == mine or other in SLACK_ITSELF or users.get((ws["id"], other), {}).get("bot"):
                continue  # Slackbot, a bot, or his notes-to-self DM
            group, label = False, None
        elif ch["kind"] in GROUP_DM_KINDS:
            group, label = True, None
        elif ch["kind"] in CHANNEL_KINDS:
            # A channel is his business only where someone @-mentioned him.
            if not mine or not any(f"<@{mine}" in (t or "") and u != mine for _, u, t in msgs):
                continue
            group, label = True, f"#{clean(ch['name'], 40)} in {clean(ws['domain'] or ws['name'], 40)}"
        else:
            continue
        msgs = msgs[:MESSAGES_PER_THREAD]
        people: dict[str, Node] = {}
        for _, uid, _ in msgs:
            if uid and uid != mine and uid not in people and not users.get((ws["id"], uid), {}).get("bot"):
                people[uid] = person(ws, uid, users)
        if ch["kind"] in DM_KINDS:
            people[other] = person(ws, other, users, ch["name"] if ch["name"] != other else "")
        if not people:
            continue
        for p in people.values():
            snap.add(p)
        if label is None and not group:
            label = people[other].label
        elif label is None:
            label = ", ".join(p.label.split(" in ")[0] for p in list(people.values())[:3]) + " (group)"
        last_at = datetime.fromtimestamp(msgs[0][0], tz=timezone.utc)
        space = space_of(ws)
        tid = snap.add(Node(f"thread:slack:{ws['id']}:{cid}", "Thread", clean(label, 60), {
            "app": NETWORK, "network": NETWORK, "slack_channel": cid, "slack_workspace": ws["domain"],
            "group": group, "last_at": last_at.isoformat(), "last_from_me": msgs[0][1] == mine}))
        snap.add(space_node(space))
        snap.link(tid, "BELONGS_TO", f"space:{space}")
        for p in people.values():
            snap.link(tid, "PARTICIPANT", p.id)
        view = []
        for ts, uid, text in msgs:
            at = datetime.fromtimestamp(ts, tz=timezone.utc)
            words = clean(readable(text, users, ws["id"]))
            mid = snap.add(Node(osgraph.node_key("message", SOURCE, cid, f"{ts:.6f}"), "Message",
                                clean(words, osgraph.SNIPPET_CHARS) or "Attachment",
                                {"network": NETWORK, "from_me": uid == mine, "at": at.isoformat()},
                                observed_at=at.isoformat()))
            snap.link(mid, "IN_THREAD", tid)
            if uid == mine:
                snap.link(mid, "SENT_BY", me)
            elif uid in people:
                snap.link(mid, "SENT_BY", people[uid].id)
            # In a group the iMessage rule only counts a line that says the
            # owner's name, and on Slack the @-mention is that name.
            if group and uid != mine and f"<@{mine}" in (text or ""):
                words = f"{OWNER} {words}"
            view.append({"from_me": uid == mine, "text": words, "at": at})
        handle = people[next(iter(people))].props["handle"]
        if thread_awaits_me(view, handle, group, known=True):
            snap.link(tid, "AWAITS_REPLY_FROM", me, confidence=0.9 if not group else 0.6,
                      props={"since": last_at.isoformat()})
    return snap.write(graph, SOURCE)
