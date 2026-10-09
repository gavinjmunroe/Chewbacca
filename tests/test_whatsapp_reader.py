#!/usr/bin/env python3
"""mac/lib/whatsapp.py: WhatsApp rows in texts.py's shape, so `people texts
sync` files them next to iMessage.

Fake wacrawl and wacli stores with the columns read off wacrawl 0.4.2 and
wacli 0.20.0 on 2026-10-08. Checks: one message seen by both stores is one
row, a LID chat resolves to its phone, group senders own their lines, junk
push names and bidi marks never become a name, non-conversation rows are
flagged, and a machine with neither store prints [].
"""
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

READER = Path(__file__).resolve().parent.parent / "mac" / "lib" / "whatsapp.py"
failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


def wacrawl_db(path):
    con = sqlite3.connect(path)
    con.executescript("""
      CREATE TABLE messages (rowid integer primary key, chat_jid text, chat_name text, msg_id text,
        sender_jid text, sender_name text, ts integer, from_me integer, text text,
        message_type text, deleted_at integer);
      CREATE TABLE chats (jid text primary key, kind text, name text);
      CREATE TABLE contacts (jid text primary key, phone text, full_name text, first_name text,
        business_name text, lid text);
    """)
    con.executemany("INSERT INTO chats VALUES (?,?,?)", [
        ("111@lid", "dm", None), ("g1@g.us", "group", "Family"), ("status@broadcast", "status", None),
    ])
    con.execute("INSERT INTO contacts VALUES ('12035550100@s.whatsapp.net','+12035550100','Jonah Z',NULL,NULL,'111@lid')")
    con.executemany("INSERT INTO messages (chat_jid,chat_name,msg_id,sender_jid,sender_name,ts,from_me,text,message_type) VALUES (?,?,?,?,?,?,?,?,?)", [
        ("111@lid", None, "AAA", "111@lid", "Jonah", 1791500000, 0, "hey", "text"),
        ("111@lid", None, "BBB", None, "me", 1791500060, 1, "yo", "text"),
        ("g1@g.us", "Family", "CCC", "222@lid", "IAA=", 1791500120, 0, "dinner?", "text"),
        ("g1@g.us", "Family", "DDD", None, "me", 1791500180, 1, "yes", "text"),
        ("111@lid", None, "EEE", "111@lid", "Jonah", 1791500240, 0, None, "image"),
        ("status@broadcast", None, "FFF", "111@lid", "Jonah", 1791500300, 0, "a status", "text"),
    ])
    con.commit()


def wacli_db(path):
    con = sqlite3.connect(path)
    con.executescript("""
      CREATE TABLE messages (rowid integer primary key, chat_jid text, chat_name text, msg_id text,
        sender_jid text, sender_name text, ts integer, from_me integer, text text, display_text text,
        media_caption text, reaction_to_id text, revoked integer default 0, deleted_at integer);
      CREATE TABLE chats (jid text primary key, name text);
      CREATE TABLE contacts (jid text primary key, phone text, push_name text, full_name text,
        business_name text, system_name text);
    """)
    con.execute("INSERT INTO contacts VALUES ('15625550199@s.whatsapp.net','15625550199','‪+1 (562) 555‑0199‬',NULL,NULL,NULL)")
    con.executemany("INSERT INTO messages (chat_jid,msg_id,sender_jid,sender_name,ts,from_me,text,display_text,reaction_to_id) VALUES (?,?,?,?,?,?,?,?,?)", [
        # the same message wacrawl already has, keyed by phone instead of LID
        ("12035550100@s.whatsapp.net", "AAA", "12035550100@s.whatsapp.net", "Jonah", 1791500000, 0, "hey", None, None),
        ("15625550199@s.whatsapp.net", "GGG", "15625550199@s.whatsapp.net", None, 1791500400, 0, "who dis", None, None),
        ("15625550199@s.whatsapp.net", "HHH", "15625550199@s.whatsapp.net", None, 1791500460, 0, None, "(message)", None),
        ("15625550199@s.whatsapp.net", "III", "15625550199@s.whatsapp.net", None, 1791500520, 0, "", None, "GGG"),
    ])
    con.commit()


def run(env):
    out = subprocess.run([sys.executable, str(READER), "--json", "--days", "0"],
                         env={**os.environ, **env}, capture_output=True, text=True, check=True).stdout
    return json.loads(out)


with tempfile.TemporaryDirectory() as tmp:
    t = Path(tmp)
    (t / "wacli").mkdir()
    wacrawl_db(t / "wacrawl.db")
    wacli_db(t / "wacli" / "wacli.db")
    rows = run({"WACRAWL_DB": str(t / "wacrawl.db"), "WACLI_STORE_DIR": str(t / "wacli")})
    by = {r["text"] or r["id"]: r for r in rows}

    hey = [r for r in rows if r["text"] == "hey"]
    check("a message in both stores is one row", len(hey) == 1, len(hey))
    check("a LID chat resolves to its phone", hey[0]["handle"] == "+12035550100", hey[0]["handle"])
    check("the contact's saved name wins over the push name", hey[0]["with"] == "Jonah Z", hey[0]["with"])
    check("my reply in a DM is filed under the other person",
          by["yo"]["from_me"] and by["yo"]["handle"] == "+12035550100" and by["yo"]["room"] is None, by["yo"])
    check("a group line belongs to its sender, in its room",
          by["dinner?"]["room"] == "Family" and by["dinner?"]["handle"] == "222@lid", by["dinner?"])
    check("a base64 push name never becomes a name", by["dinner?"]["with"] != "IAA=", by["dinner?"]["with"])
    check("my line in a group is filed under the room", by["yes"]["with"] == "Family", by["yes"]["with"])
    check("bidi marks and a non-breaking hyphen are stripped from names",
          by["who dis"]["with"] == "+1 (562) 555-0199", by["who dis"]["with"])
    check("status updates are not conversation", not any(r["text"] == "a status" for r in rows))
    check("an image with no caption is attachment-only",
          all(r["attachment_only"] for r in rows if not r["text"]), [r for r in rows if not r["text"]])
    check("wacli's '(message)' placeholder is not text", not any(r["text"] == "(message)" for r in rows))
    check("a reaction is marked a reaction", any(r["reaction"] for r in rows))
    check("ids sit in the WhatsApp range, past iMessage and LinkedIn",
          all(20_000_000_000 <= r["id"] < 20_000_000_000 + 2**40 for r in rows))
    check("every row says it came from WhatsApp", all(r["source"] == "whatsapp" for r in rows))

    empty = run({"WACRAWL_DB": str(t / "none.db"), "WACLI_STORE_DIR": str(t / "nothing")})
    check("no WhatsApp on this machine prints []", empty == [], empty)

print("all passed" if not failed else f"{failed} failed")
sys.exit(1 if failed else 0)
