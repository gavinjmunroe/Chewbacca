#!/usr/bin/env python3
"""mac/lib/texts.py carries the id of a group nobody named as its room, and a 1:1 has none."""
import os, sqlite3, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "mac", "lib"))
import texts

with tempfile.TemporaryDirectory() as t:
    p = os.path.join(t, "chat.db")
    d = sqlite3.connect(p)
    d.executescript("""
      CREATE TABLE message (rowid INTEGER PRIMARY KEY, date INT, is_from_me INT, text TEXT, attributedBody BLOB,
        handle_id INT, cache_has_attachments INT, associated_message_type INT);
      CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
      CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, display_name TEXT, chat_identifier TEXT);
      CREATE TABLE chat_message_join (chat_id INT, message_id INT);
      INSERT INTO handle VALUES (1, '+15550001');
      INSERT INTO chat VALUES (1, '', 'chat4242'), (2, 'Den', 'chat99'), (3, '', '+15550001');
    """)
    import time
    now = int((time.time() - texts.APPLE_EPOCH) * 1e9)
    for rid, me, h, c in [(1, 0, 1, 1), (2, 1, None, 1), (3, 0, 1, 2), (4, 0, 1, 3)]:
        d.execute("INSERT INTO message VALUES (?,?,?,?,NULL,?,0,0)", (rid, now, me, f"m{rid}", h))
        d.execute("INSERT INTO chat_message_join VALUES (?,?)", (c, rid))
    d.commit(); d.close()
    rooms = {m["id"]: m["room"] for m in texts.read(days=1, db_path=p)}
assert rooms[1] == "chat4242" and rooms[2] == "chat4242", rooms
assert rooms[3] == "Den", rooms
assert rooms[4] is None, rooms
print("texts room: ok")
