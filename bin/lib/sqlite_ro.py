"""A read-only connection to a WAL database, whatever WAL files are beside it.

`mode=ro` cannot create the -shm a WAL database needs, so once the last
writer has closed and its -wal and -shm are gone, Apple's sqlite (3.43 in
/usr/bin/python3) refuses the open with "unable to open database file". The
people store is WAL, and on 2026-10-13 that took amber-redact (7 of 11 known
names leaked) and the chats ingest (needs-you empty) red. brain.py's
open_read (4ef7cdda) met the same thing on its index a day earlier.

The fallback is a normal connection, which can make the -shm, with
query_only so it still cannot write.
"""
import sqlite3


def open_ro(path, **kw):
    try:
        db = sqlite3.connect(f"file:{path}?mode=ro", uri=True, **kw)
        # sqlite opens lazily: only a read of the schema touches the file.
        db.execute("SELECT count(*) FROM sqlite_master").fetchall()
        return db
    except sqlite3.OperationalError:
        # mode=rw, never the default rwc: a missing file is an error, not a
        # new empty database that later reads would take for a real store.
        db = sqlite3.connect(f"file:{path}?mode=rw", uri=True, **kw)
        db.execute("PRAGMA query_only=ON")
        return db
