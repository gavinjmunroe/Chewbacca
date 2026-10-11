#!/usr/bin/env python3
"""Row-level snapshot and undo for the two SQLite stores chewbacca-mcp writes.

chewbacca-mcp's kit_write runs work-ledger and `people note` through their own
CLIs, so their checks still apply. Neither CLI has a delete or a put-back, and
restoring a whole file snapshot would wipe whatever another tab wrote in
between (ten-plus tabs share the ledger on a busy night). So the undo is one
row, and only if that row still looks the way the write left it.

  mcp_undo.py ledger-get <task id>
  mcp_undo.py ledger-delete <task id> <updated_at the add left>
  mcp_undo.py ledger-restore <task id> <updated_at the update left> <prior row json>
  mcp_undo.py obs-mark                      highest observation rowid right now
  mcp_undo.py obs-since <rowid> <body>      ids of observations added after it with that body
  mcp_undo.py obs-forget <id> [<id> ...]    soft-delete them (deleted_at), as `people` does

Every answer is one line of JSON. Exit 3 means "changed since, refused".
"""
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

LEDGER_FIELDS = ("status", "owner", "next_action", "evidence", "reason", "updated_at")


def ledger_db():
    home = Path(os.environ.get("CHEWBACCA_HOME") or Path.home() / ".chewbacca").expanduser()
    return sqlite3.connect(home / "work-ledger.sqlite", timeout=10, isolation_level=None)


def people_db():
    home = Path(os.environ.get("PEOPLE_DIR") or Path.home() / ".chewbacca" / "people").expanduser()
    return sqlite3.connect(home / "people.db", timeout=10, isolation_level=None)


def row(db, task_id):
    db.row_factory = sqlite3.Row
    got = db.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    return dict(got) if got else None


def say(obj, code=0):
    print(json.dumps(obj))
    sys.exit(code)


def main(argv):
    if not argv:
        say({"error": "no command"}, 2)
    cmd, args = argv[0], argv[1:]
    if cmd == "ledger-get":
        db = ledger_db()
        say({"task": row(db, args[0])})
    if cmd == "ledger-delete":
        db = ledger_db()
        db.execute("BEGIN IMMEDIATE")
        now = row(db, args[0])
        if now is None:
            db.execute("ROLLBACK")
            say({"undone": True, "note": "already gone"})
        if now["updated_at"] != args[1]:
            db.execute("ROLLBACK")
            say({"refused": f"the task changed after the add (updated {now['updated_at']}); left as is"}, 3)
        db.execute("DELETE FROM tasks WHERE id=?", (args[0],))
        db.execute("COMMIT")
        say({"undone": True})
    if cmd == "ledger-restore":
        prior = json.loads(args[2])
        db = ledger_db()
        db.execute("BEGIN IMMEDIATE")
        now = row(db, args[0])
        if now is None:
            db.execute("ROLLBACK")
            say({"refused": "the task is gone"}, 3)
        if now["updated_at"] != args[1]:
            db.execute("ROLLBACK")
            say({"refused": f"the task changed after the update (updated {now['updated_at']}); left as is"}, 3)
        fields = [f for f in LEDGER_FIELDS if f in prior]
        db.execute("UPDATE tasks SET " + ",".join(f + "=?" for f in fields) + " WHERE id=?",
                   [prior[f] for f in fields] + [args[0]])
        db.execute("COMMIT")
        say({"undone": True})
    if cmd == "obs-mark":
        db = people_db()
        (top,) = db.execute("SELECT coalesce(max(rowid), 0) FROM observations").fetchone()
        say({"rowid": top})
    if cmd == "obs-since":
        db = people_db()
        ids = [r[0] for r in db.execute(
            "SELECT id FROM observations WHERE rowid > ? AND body = ? AND deleted_at IS NULL",
            (int(args[0]), args[1]))]
        say({"ids": ids})
    if cmd == "obs-forget":
        db = people_db()
        at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        cur = db.execute(
            "UPDATE observations SET deleted_at=? WHERE id IN (%s) AND deleted_at IS NULL" % ",".join("?" * len(args)),
            [at, *args])
        say({"undone": True, "forgot": cur.rowcount})
    say({"error": f"unknown command {cmd}"}, 2)


if __name__ == "__main__":
    main(sys.argv[1:])
