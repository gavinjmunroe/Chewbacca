#!/usr/bin/env python3
"""open_ro reads a WAL database whose -wal and -shm are gone, and never writes.

On 2026-10-13 Apple's sqlite refused `mode=ro` on the closed WAL people store,
so the chats ingest read nothing and needs-you came up empty
(tests/chewbacca_chat.sh). This pins the reader, not the ingest.
"""
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bin" / "lib"))
from sqlite_ro import open_ro  # noqa: E402

failed = 0


def check(name, ok, got=None):
    global failed
    print(("  ok   " if ok else "  FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += 0 if ok else 1


with tempfile.TemporaryDirectory() as tmp:
    path = Path(tmp) / "people.db"
    db = sqlite3.connect(path)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("CREATE TABLE people (name TEXT)")
    db.execute("INSERT INTO people VALUES ('Sam Lee')")
    db.commit()
    db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    db.close()
    # Apple's sqlite keeps -wal and -shm after a close; node's, which writes
    # the people store, removes them. Remove them the way node leaves it.
    for extra in ("-wal", "-shm"):
        Path(f"{path}{extra}").unlink(missing_ok=True)
    try:
        bare = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        bare.execute("SELECT count(*) FROM sqlite_master").fetchall()
        refused = False
    except sqlite3.OperationalError:
        refused = True
    check("a plain mode=ro open is refused here (the bug this covers)", refused, os.listdir(tmp))

    ro = open_ro(path, timeout=2)
    check("open_ro reads the rows", ro.execute("SELECT name FROM people").fetchall() == [("Sam Lee",)])
    try:
        ro.execute("INSERT INTO people VALUES ('x')")
        wrote = True
    except sqlite3.Error:
        wrote = False
    ro.close()
    check("open_ro cannot write", not wrote)
    check("nothing was written", sqlite3.connect(path).execute("SELECT count(*) FROM people").fetchone() == (1,))

    try:
        open_ro(Path(tmp) / "missing.db")
        missing_ok = False
    except sqlite3.Error:
        missing_ok = True
    check("a missing file is an error", missing_ok)
    check("and no empty database is left behind", not (Path(tmp) / "missing.db").exists())

print("all passed" if not failed else f"{failed} failed")
sys.exit(1 if failed else 0)
