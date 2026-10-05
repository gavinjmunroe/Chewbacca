"""WhatsApp, read through wacli, as rows for the surface and facts for the OS graph.

wacli (openclaw/tap, 0.19.0 on 2026-10-05) is a WhatsApp Web linked device
with a local store at ~/.wacli. Everything here READS it, with `--read-only`
on every call, so a bug in this file cannot send, mark read or write the
store: wacli itself refuses ("read-only mode: command would intentionally
modify WhatsApp or the local store", checked 2026-10-05). The one write,
sending a reply, lives in surfaces/whatsapp.py behind a press.

The JSON shapes below were read off wacli 0.19.0 on 2026-10-05 against a
scratch copy of the store with hand-inserted rows, because the real store was
empty (not linked): `chats list` gives snake_case rows (jid, kind, name,
last_message_ts as RFC3339, unread, unread_count), `messages list` gives
{"messages": [...]} with Go field names (ChatJID, MsgID, SenderJID, Timestamp,
FromMe, Text, DisplayText, MediaType, MediaCaption, ReactionToID, Revoked,
DeletedForMe). Both arrive inside {"success", "data", "error"}, and an empty
list comes back as `null`, not [].

IDENTITY. A chat's name and a sender's name in wacli can be the push name the
sender chose, so neither ever labels a person (docs/KYBER-SURFACES.md,
Identity). A phone JID becomes a person only through the people store; until
then it shows as the raw number. A group shows its subject, marked as a group,
and is never a place a reply can go.

Message text is someone else's words: control and format characters (bidi
overrides included) are stripped before it reaches a label, it is clipped to
osgraph.SNIPPET_CHARS, and nothing here reads it for instructions. The one
thing derived from it is AWAITS_REPLY_FROM, by the same measured rule the
iMessage ingester uses (osgraph_ingest.awaits_me).
"""
from __future__ import annotations

import json
import os
import re
import shutil
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path

import osgraph
from osgraph import Graph, Identities, Node, me_node, person_node, space_node

SOURCE = "whatsapp"
NETWORK = "WhatsApp"
# A one-to-one chat with a phone number, or with a WhatsApp LID (the
# privacy id WhatsApp has been moving 1:1 chats to). Anything else (a group
# @g.us, a broadcast list, a newsletter, status@broadcast) is not a place a
# reply from the glass can go.
DM_JID = re.compile(r"^(\d{5,20})@(s\.whatsapp\.net|lid)$")
PHONE_JID = re.compile(r"^(\d{5,20})@s\.whatsapp\.net$")
# Guessed, never measured: the iMessage panel shows a week of threads and
# rarely more than twenty are live; fifty leaves room without paging.
MOST_CHATS = 50
# Guessed, never measured: a week of WhatsApp for one person. If the newest
# chats show no last line, this is the number to raise.
MOST_MESSAGES = 400
# Same as osgraph_ingest.MESSAGES_PER_THREAD, so both networks keep one shape.
MESSAGES_PER_THREAD = 5
# Unicode categories that never belong in a rendered line: controls (Cc),
# format characters (Cf, which includes the bidi overrides that can make a
# line read backwards), surrogates and private use. Zero-width joiner stays,
# or every multi-person emoji falls apart.
STRIP_CATEGORIES = {"Cc", "Cf", "Cs", "Co"}
KEEP = {"\u200d"}


def wacli_bin(env: dict | None = None) -> str:
    """The wacli to run. launchd hands its children a PATH without
    /opt/homebrew/bin (memory, feedback_launchd_minimal_path_breaks_children),
    so the brew location is tried before giving up on a bare name."""
    env = env if env is not None else dict(os.environ)
    if env.get("KYBER_WACLI"):
        return env["KYBER_WACLI"]
    found = shutil.which("wacli", path=env.get("PATH"))
    if found:
        return found
    for candidate in ("/opt/homebrew/bin/wacli", "/usr/local/bin/wacli"):
        if Path(candidate).exists():
            return candidate
    return "wacli"


def read_argv(env: dict, *args: str) -> list[str]:
    """A read: always `--read-only`, always JSON."""
    return [wacli_bin(env), "--read-only", "--json", *args]


def clean(text, limit: int | None = None) -> str:
    """Someone else's words, safe to draw: no control or format characters,
    whitespace collapsed to single spaces, optionally clipped."""
    raw = "".join(ch for ch in str(text or "")
                  if ch in KEEP or unicodedata.category(ch) not in STRIP_CATEGORIES or ch in "\n\t ")
    words = " ".join(raw.split())
    if limit is not None and len(words) > limit:
        return words[: limit - 1].rstrip() + "…"
    return words


# Typed whitespace that is sent as typed. Every other control character goes.
TYPED_KEEP = KEEP | {"\n", "\t"}


def clean_typed(text) -> str:
    """What Caleb typed into the Field, as it will be sent: line breaks and
    tabs kept exactly as typed (\\r\\n and a lone \\r become \\n), every
    other control and format character out (a pasted bidi override would
    make the line read differently on his screen than on theirs), outer
    whitespace trimmed. Collapsing his line breaks would send something
    other than what he saw in the Field (verifier, 2026-10-05)."""
    lines = re.sub(r"\r\n?", "\n", str(text or ""))
    return "".join(ch for ch in lines
                   if ch in TYPED_KEEP or unicodedata.category(ch) not in STRIP_CATEGORIES).strip()


def sent_id(data) -> str:
    """The message id a send answered with, under whichever key this wacli
    uses. Not measured: a send needs a linked account, and none was linked
    on 2026-10-05, so read-back falls back to matching the text."""
    if not isinstance(data, dict):
        return ""
    for key in ("id", "msg_id", "message_id", "MsgID", "ID"):
        if isinstance(data.get(key), str) and data[key]:
            return data[key]
    return ""


class WacliError(Exception):
    """wacli answered with an error, or not at all. The message is a line a
    person can read."""


def envelope(code: int, out: str, err: str, what: str):
    """The `data` of wacli's {"success","data","error"}, or WacliError."""
    body = None
    for text in (out, err):
        try:
            body = json.loads(text or "")
            break
        except json.JSONDecodeError:
            continue
    if isinstance(body, dict) and body.get("success") is True and code == 0:
        return body.get("data")
    if isinstance(body, dict) and body.get("error"):
        message = body["error"]
        if isinstance(message, dict):
            message = message.get("message") or json.dumps(message)
        raise WacliError(f"{what}: {clean(message, 120)}")
    if code == 127:
        raise WacliError("wacli isn't installed. `brew install openclaw/tap/wacli` puts it on this Mac.")
    first = clean((err or out or "no output").splitlines()[0] if (err or out) else "no output", 120)
    raise WacliError(f"{what} failed: {first}")


def call(ctx, what: str, *args: str):
    code, out, err = ctx.run(read_argv(ctx.env, *args))
    return envelope(code, out, err, what)


def linked(ctx) -> bool:
    data = call(ctx, "WhatsApp status", "auth", "status")
    return bool(isinstance(data, dict) and data.get("authenticated"))


NOT_LINKED = ("WhatsApp isn't linked on this Mac. Run `wacli auth --qr-format terminal` "
              "and scan it from WhatsApp > Linked Devices.")


def chats(ctx, limit: int = MOST_CHATS) -> list[dict]:
    data = call(ctx, "WhatsApp chats", "chats", "list", "--limit", str(limit))
    return [c for c in (data or []) if isinstance(c, dict) and isinstance(c.get("jid"), str)]


def messages(ctx, chat: str = "", after: datetime | None = None, limit: int = MOST_MESSAGES,
             from_me: bool = False) -> list[dict]:
    args = ["messages", "list", "--limit", str(limit)]
    if chat:
        args += ["--chat", chat]
    if after is not None:
        args += ["--after", after.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")]
    if from_me:
        args.append("--from-me")
    data = call(ctx, "WhatsApp messages", *args)
    rows = (data or {}).get("messages") if isinstance(data, dict) else None
    return [m for m in (rows or []) if isinstance(m, dict) and isinstance(m.get("ChatJID"), str)]


def when(stamp) -> datetime | None:
    if not isinstance(stamp, str) or not stamp or stamp.startswith("0001-"):
        return None
    try:
        moment = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone()


def is_dm(chat: dict) -> bool:
    return chat.get("kind") == "dm" and bool(DM_JID.match(str(chat.get("jid") or "")))


def phone_of(jid: str) -> str:
    """"+15625550199" for a phone JID, "" for anything else (a LID has no
    number, and a group is not a person)."""
    m = PHONE_JID.match(jid or "")
    return "+" + m.group(1) if m else ""


def handle_of(jid: str) -> str:
    """What a sender is known by before the people store says who they are:
    the phone number, or the raw JID for a LID."""
    return phone_of(jid) or (jid or "").strip()


def person_for(ids: Identities, jid: str) -> Node:
    return person_node(ids, handle_of(jid), source_hint=SOURCE)


GROUP_MARK = " (group)"
# The widest label any surface draws for a chat (surfaces/whatsapp.py clips at 48).
GROUP_LABEL_MAX = 48


def chat_label(ids: Identities, chat: dict) -> str:
    """Who a chat is, by the people store or the raw number. A group shows
    its subject, marked; a dm never shows the name wacli has for it."""
    jid = str(chat.get("jid") or "")
    if chat.get("kind") == "group":
        # The marker has to survive every later clip. The list clips labels at
        # 48 characters, and a review on 2026-10-05 showed a 63-character
        # subject losing " (group)" there, so a stranger's group read as a
        # known contact. The subject gets what is left after the marker.
        subject = clean(chat.get("name"), GROUP_LABEL_MAX - len(GROUP_MARK))
        return f"{subject or 'Unnamed group'}{GROUP_MARK}"
    return person_for(ids, jid).label


def words_of(m: dict) -> str:
    """The line a message shows: its text, else its caption, else what it is."""
    text = m.get("Text") or m.get("DisplayText") or m.get("MediaCaption") or ""
    if text:
        return clean(text)
    media = clean(m.get("MediaType"), 20)
    return f"[{media}]" if media else ""


def countable(m: dict) -> bool:
    """A message a person wrote: not a reaction, not deleted or revoked."""
    return not (m.get("ReactionToID") or m.get("Revoked") or m.get("DeletedForMe"))


def by_chat(rows: list[dict]) -> dict[str, list[dict]]:
    """Messages grouped by chat, newest first, reactions and deletions out."""
    out: dict[str, list[dict]] = {}
    for m in rows:
        if countable(m):
            out.setdefault(m["ChatJID"], []).append(m)
    for msgs in out.values():
        msgs.sort(key=lambda m: when(m.get("Timestamp")) or datetime.min.replace(tzinfo=timezone.utc),
                  reverse=True)
    return out


def waiting(msgs: list[dict], chat: dict, known: bool) -> bool:
    """Does this chat wait on the person? The iMessage rule, unchanged: the
    inbound burst since his last message has to ask for something."""
    import osgraph_ingest  # noqa: PLC0415  heavy module, only needed here

    burst = []
    for m in msgs:
        if m.get("FromMe"):
            break
        burst.append(words_of(m))
    group = chat.get("kind") == "group"
    return osgraph_ingest.awaits_me(list(reversed(burst)), handle_of(str(chat.get("jid") or "")), group, known)


def whatsapp(graph: Graph, ctx, ids: Identities, days: int = 7) -> dict:
    """The INGESTER: the last `days` of WhatsApp as Thread, Message and
    Person nodes, written as the "whatsapp" snapshot.

    Same shape as the iMessage ingester, with two differences on purpose. A
    WhatsApp Thread carries `wa_jid`, never `reply_to`: reply_routes and
    send_reply in the walks treat `reply_to` as an iMessage handle, and a JID
    there would be offered as "Send on iMessage". And no Task is read out of
    a WhatsApp text, because Graph.prune only clears `task:imessage:` tasks,
    so a WhatsApp one would outlive its message."""
    is_linked = linked(ctx)
    # Archived is Caleb filing a chat away (archived:true, seen on the
    # scratch store 2026-10-05): not waiting on him, not this week's news.
    listed = [c for c in chats(ctx) if not c.get("archived")]
    now = ctx.now()
    since = now - timedelta(days=days)
    from osgraph_ingest import SPACE_BY_COMPANY, Snapshot, space_for  # noqa: PLC0415

    snap = Snapshot()
    me = snap.add(me_node())
    grouped = by_chat(messages(ctx, after=since))
    for chat in listed:
        jid = chat["jid"]
        msgs = grouped.get(jid, [])[:MESSAGES_PER_THREAD]
        if not msgs:
            continue
        group = chat.get("kind") == "group"
        dm = is_dm(chat)
        if not group and not dm:
            continue  # broadcast lists, newsletters, status: nobody to talk to
        people: dict[str, Node] = {}
        if dm:
            p = person_for(ids, jid)
            people[jid] = p
        for m in msgs:
            sender = str(m.get("SenderJID") or "")
            if not m.get("FromMe") and sender and sender not in people:
                people[sender] = person_for(ids, sender)
        for p in people.values():
            snap.add(p)
        newest = msgs[0]
        last_at = when(newest.get("Timestamp")) or when(chat.get("last_message_ts")) or now
        first = people.get(jid) if dm else None
        space = space_for({"props": first.props} if first else None, SPACE_BY_COMPANY)
        tid = snap.add(Node(f"thread:whatsapp:{jid}", "Thread", clean(chat_label(ids, chat), 60), {
            "app": NETWORK, "network": NETWORK, "wa_jid": jid, "group": group,
            "unread": int(chat.get("unread_count") or 0), "last_at": last_at.isoformat(),
            "last_from_me": bool(newest.get("FromMe"))}))
        snap.add(space_node(space))
        snap.link(tid, "BELONGS_TO", f"space:{space}")
        for p in people.values():
            snap.link(tid, "PARTICIPANT", p.id)
        for m in msgs:
            at = when(m.get("Timestamp")) or last_at
            if m.get("FromMe"):
                sender = me
            else:
                sender_jid = str(m.get("SenderJID") or "")
                # A group line with no SenderJID has no known sender. The
                # group's JID is not a person; falling back to it made the
                # group a Person (verifier, 2026-10-05). No SENT_BY then.
                who = people.get(sender_jid) or first or (person_for(ids, sender_jid) if sender_jid else None)
                sender = snap.add(who) if who is not None else ""
            mid = snap.add(Node(osgraph.node_key("message", SOURCE, jid, str(m.get("MsgID") or "")), "Message",
                                clean(words_of(m), osgraph.SNIPPET_CHARS) or "Attachment",
                                {"network": NETWORK, "from_me": bool(m.get("FromMe")), "at": at.isoformat()},
                                observed_at=at.isoformat()))
            snap.link(mid, "IN_THREAD", tid)
            if sender:
                snap.link(mid, "SENT_BY", sender)
        known = any(not p.unresolved for p in people.values()) or group
        if waiting(msgs, chat, known):
            snap.link(tid, "AWAITS_REPLY_FROM", me, confidence=0.9 if not group else 0.6,
                      props={"since": last_at.isoformat()})
    report = snap.write(graph, SOURCE)
    # Unlinked is the state this Mac is in until Caleb scans the QR, so it
    # is a fact in the report, never an error: an error here would sit in
    # the caption of every walk surface that stands on this source, every
    # cycle, for as long as it stays unlinked. A store left over from a link
    # is still a real week and is ingested above either way.
    report["linked"] = is_linked
    if not is_linked:
        report["note"] = NOT_LINKED
    return report

