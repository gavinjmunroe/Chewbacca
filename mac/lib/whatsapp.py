#!/usr/bin/env python3
"""WhatsApp history as rows in the same shape mac/lib/texts.py prints.

`people texts sync` already knows how to file iMessage rows against people.
This prints WhatsApp in that exact JSON so the same code files both, and
`people texts maggie` shows one conversation whichever app it happened in.

Two local stores, both read-only here:

- wacrawl (~/.wacrawl/wacrawl.db), a copy of WhatsApp Desktop's own database.
  Full history, but only as fresh as the last `wacrawl import`.
- wacli (~/.wacli/wacli.db), a linked device. Live, but only what WhatsApp
  sent it since linking.

A message is in both when both saw it. WhatsApp's message id is the same in
each, so it is the key, and the id printed is derived from it alone: the two
copies land on one row in people.db instead of two.

IDENTITY. wacrawl keys most one-to-one chats by LID (a privacy id with no
phone in it) while wacli keys them by phone. A LID resolves to a phone through
wacrawl's contacts table, and the phone is what people.db matches a person on.
"""

import argparse, hashlib, json, os, re, sqlite3, sys
from datetime import datetime

WACRAWL_DB = os.path.expanduser(os.environ.get("WACRAWL_DB", "~/.wacrawl/wacrawl.db"))
WACLI_DB = os.path.expanduser(os.path.join(os.environ.get("WACLI_STORE_DIR", "~/.wacli"), "wacli.db"))

# Each app owns its own trillion: iMessage ids are chat.db ROWIDs (642k here
# on 2026-10-08), LinkedIn sits at 1e10, WhatsApp at 2e12, Slack 3e12, email
# 4e12. A 40-bit hash spans 1.1e12, so no two ranges can touch. They used to
# sit 1e10 apart, which overlapped and only stayed distinct by hash luck.
ID_BASE = 2_000_000_000_000
ID_BITS = 40

# Message kinds that are a conversation. Reactions, joins, calls, polls and
# the numbered system types are not, the same way texts.py drops "Loved an image".
TEXT_KINDS = {"text", "link", None, ""}


def row_id(msg_id):
    h = int(hashlib.sha1(msg_id.encode()).hexdigest()[: ID_BITS // 4], 16)
    return ID_BASE + h


def connect(path):
    if not os.path.exists(path):
        return None
    try:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
        con.row_factory = sqlite3.Row
        con.execute("SELECT 1 FROM messages LIMIT 1")
        return con
    except sqlite3.Error as err:
        print(f"whatsapp: skipping {path}: {err}", file=sys.stderr)
        return None


def phone_of(jid, lid_phone):
    """+digits for a person's JID when one is knowable, else None."""
    if not jid:
        return None
    user, _, server = jid.partition("@")
    if server == "s.whatsapp.net" and user.isdigit():
        return "+" + user
    if server == "lid":
        return lid_phone.get(jid)
    return None


# WhatsApp wraps a bare phone number in bidi isolates and a non-breaking
# hyphen ("\u202a+1 (732) 581\u20111906\u202c" in this store on 2026-10-08), and
# some senders carry a push name that is only base64 padding ("IAA=", 34 rows).
FORMAT_CHARS = dict.fromkeys(map(ord, "\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069"))
JUNK_NAME = re.compile(r"^[A-Za-z0-9+/]{1,8}={1,2}$")


def clean_name(name):
    if not name:
        return None
    s = " ".join(str(name).translate(FORMAT_CHARS).replace("\u2011", "-").split())
    return None if not s or JUNK_NAME.match(s) else s


def local_minute(ts):
    return datetime.fromtimestamp(int(ts)).strftime("%Y-%m-%dT%H:%M:%S")


def directory(cons):
    """jid -> display name, and lid -> phone, from both stores' contacts."""
    names, lid_phone = {}, {}
    for kind, con in cons:
        if kind == "wacrawl":
            q = "SELECT jid, phone, lid, coalesce(nullif(full_name,''), nullif(business_name,''), nullif(first_name,'')) n FROM contacts"
            for r in con.execute(q):
                if r["n"]:
                    names.setdefault(r["jid"], r["n"])
                    if r["lid"]:
                        names.setdefault(r["lid"], r["n"])
                if r["lid"] and r["phone"]:
                    lid_phone[r["lid"]] = "+" + r["phone"].lstrip("+")
        else:
            q = "SELECT jid, coalesce(nullif(system_name,''), nullif(full_name,''), nullif(business_name,''), nullif(push_name,'')) n FROM contacts"
            for r in con.execute(q):
                if r["n"]:
                    names.setdefault(r["jid"], r["n"])
        q = "SELECT jid, name FROM chats WHERE name IS NOT NULL AND name <> ''"
        for r in con.execute(q):
            names.setdefault(r["jid"], r["name"])
    return names, lid_phone


def read(days, limit):
    cons = [(k, c) for k, c in (("wacrawl", connect(WACRAWL_DB)), ("wacli", connect(WACLI_DB))) if c]
    if not cons:
        return [], []
    names, lid_phone = directory(cons)
    since = 0 if not days else int(datetime.now().timestamp()) - days * 86400
    seen, out, sources = set(), [], []
    for kind, con in cons:
        if kind == "wacrawl":
            q = """SELECT m.chat_jid, m.msg_id, m.sender_jid, m.sender_name, m.from_me, m.ts, m.text,
                          m.message_type kind, coalesce(m.chat_name, c.name) chat_name,
                          (c.kind = 'group') is_group
                     FROM messages m LEFT JOIN chats c ON c.jid = m.chat_jid
                    WHERE m.ts >= ? AND m.deleted_at IS NULL
                      AND m.chat_jid NOT IN ('status@broadcast', '0@s.whatsapp.net')
                      AND coalesce(c.kind, '') <> 'status'"""
        else:
            q = """SELECT m.chat_jid, m.msg_id, m.sender_jid, m.sender_name, m.from_me, m.ts,
                          coalesce(nullif(m.text,''), m.media_caption) text,
                          CASE WHEN m.reaction_to_id IS NOT NULL THEN 'reaction' ELSE NULL END kind,
                          coalesce(m.chat_name, c.name) chat_name,
                          (m.chat_jid LIKE '%@g.us') is_group
                     FROM messages m LEFT JOIN chats c ON c.jid = m.chat_jid
                    WHERE m.ts >= ? AND m.deleted_at IS NULL AND m.revoked = 0
                      AND m.chat_jid NOT LIKE '%@broadcast' AND m.chat_jid NOT LIKE '%@newsletter'
                      AND m.chat_jid <> '0@s.whatsapp.net'"""
        n = 0
        for r in con.execute(q + " ORDER BY m.ts", (since,)):
            n += 1
            if r["msg_id"] in seen:
                continue
            seen.add(r["msg_id"])
            text = (r["text"] or "").strip()
            chat = r["chat_jid"]
            if r["is_group"]:
                room = clean_name(names.get(chat)) or clean_name(r["chat_name"]) or "WhatsApp group"
                if r["from_me"]:
                    who, handle = room, chat
                else:
                    sender = r["sender_jid"] or ""
                    handle = phone_of(sender, lid_phone) or sender or chat
                    who = clean_name(names.get(sender)) or clean_name(r["sender_name"]) or handle
            else:
                room = None
                handle = phone_of(chat, lid_phone) or chat
                who = (clean_name(names.get(chat))
                       or clean_name(r["sender_name"] if not r["from_me"] else None)
                       or clean_name(r["chat_name"]) or handle)
            out.append({
                "id": row_id(r["msg_id"]),
                "at": local_minute(r["ts"]),
                "with": who,
                "room": room,
                "handle": handle,
                "from_me": bool(r["from_me"]),
                "text": text,
                "reaction": r["kind"] == "reaction",
                "attachment_only": not text or r["kind"] not in TEXT_KINDS,
                "source": "whatsapp",
            })
        sources.append({"store": kind, "rows": n})
    out.sort(key=lambda r: r["at"])
    if limit:
        out = out[-limit:]
    return out, sources


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--days", type=int, default=30, help="0 means all history")
    ap.add_argument("--limit", type=int, default=0, help="0 means no row cap")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--sources", action="store_true", help="print which stores were read")
    a = ap.parse_args()
    rows, sources = read(a.days, a.limit)
    if a.sources:
        print(json.dumps(sources))
        return
    if a.json:
        json.dump(rows, sys.stdout, ensure_ascii=False)
        return
    for r in rows:
        arrow = "->" if r["from_me"] else "<-"
        print(f"{r['at']}  {r['with'][:20]:20} {arrow} {r['text'][:90]}")


if __name__ == "__main__":
    main()
