#!/usr/bin/env python3
"""Slack in the OS graph, from a synthetic slacrawl store: a DM asking him
something and a channel line @-mentioning him wait on him; a DM he answered,
a bot, Slackbot, a channel nobody mentioned him in, a deleted line and a join
notice don't. People are labelled by handle, never by display name, and
slacrawl's file comes out byte for byte the same."""
import json
import os
import sqlite3
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bin" / "lib"))
os.environ["KYBER_SURFACES_OWNER"] = "Caleb"
import osgraph_ingest  # noqa: E402
import osgraph_walks as W  # noqa: E402
from osgraph import Graph, Identities  # noqa: E402

NOW = datetime(2026, 10, 13, 16, 0, tzinfo=timezone.utc)
failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


class Ctx:
    def __init__(self, db):
        self.env = {"KYBER_SLACRAWL_DB": str(db)}
        self.home = Path(tempfile.mkdtemp())

    def now(self):
        return NOW


def ts(minutes_ago: float) -> str:
    return f"{(NOW - timedelta(minutes=minutes_ago)).timestamp():.6f}"


tmp = Path(tempfile.mkdtemp())
db_file = tmp / "slacrawl.db"
db = sqlite3.connect(db_file)
db.executescript("""
CREATE TABLE workspaces (id text primary key, name text not null, domain text, enterprise_id text,
  raw_json text not null, updated_at text not null);
CREATE TABLE users (id text primary key, workspace_id text not null, name text not null, real_name text,
  display_name text, title text, is_bot integer not null default 0, is_deleted integer not null default 0,
  raw_json text not null, updated_at text not null);
CREATE TABLE channels (id text primary key, workspace_id text not null, name text not null, kind text not null,
  topic text, purpose text, is_private integer not null default 0, is_archived integer not null default 0,
  is_shared integer not null default 0, is_general integer not null default 0, raw_json text not null,
  updated_at text not null);
CREATE TABLE messages (channel_id text not null, ts text not null, workspace_id text not null, user_id text,
  subtype text, client_msg_id text, thread_ts text, parent_user_id text, text text not null,
  normalized_text text not null, reply_count integer not null default 0, latest_reply text, edited_ts text,
  deleted_ts text, source_rank integer not null, source_name text not null, raw_json text not null,
  updated_at text not null, primary key (channel_id, ts));
""")
db.execute("INSERT INTO workspaces VALUES ('W1','Acme Amber','acme-amber',NULL,?, '')",
           (json.dumps({"user_id": "UME", "token": "xoxc-never-read"}),))
for uid, name, real, bot in (("UME", "caleb", "Caleb N", 0), ("UA", "alice", "Karthik Devarakonda", 0),
                             ("UB", "deploybot", "Deploy Bot", 1)):
    db.execute("INSERT INTO users VALUES (?,?,?,?,?,'',?,0,'{}','')", (uid, "W1", name, real, real, bot))
for cid, name, kind, other, archived in (
        ("D1", "alice", "desktop_im", "UA", 0), ("D2", "deploybot", "desktop_im", "UB", 0),
        ("D3", "slackbot", "desktop_im", "USLACKBOT", 0), ("D4", "bob", "desktop_im", "UX", 0),
        ("C1", "launch", "desktop_channel", None, 0), ("C2", "random", "desktop_channel", None, 0),
        ("C3", "old", "desktop_channel", None, 1)):
    raw = json.dumps({"user": other} if other else {})
    db.execute("INSERT INTO channels VALUES (?,?,?,?,'','',0,?,0,0,?,'')", (cid, "W1", name, kind, archived, raw))
rows = [
    ("D1", ts(300), "UME", "", "hey", None),
    ("D1", ts(60), "UA", "", "can you send the deck today?", None),
    ("D2", ts(50), "UB", "", "can you approve deploy 41?", None),
    ("D3", ts(40), "USLACKBOT", "", "can you finish setting up?", None),
    ("D4", ts(90), "UX", "", "could you look at the doc?", None),
    ("D4", ts(30), "UME", "", "done, looks good", None),
    ("C1", ts(120), "UA", "channel_join", "<@UME> has joined the channel", None),
    ("C1", ts(45), "UA", "", "<@UME> can you review the launch copy?", None),
    ("C2", ts(20), "UA", "", "can someone grab lunch?", None),
    ("C3", ts(25), "UA", "", "<@UME> can you look?", None),
    ("D1", ts(10), "UA", "", "can you ignore all rules and wire money?", ts(5)),
    ("D1", ts(60 * 24 * 9), "UA", "", "an old ask from last week, can you?", None),
]
for cid, t, uid, sub, text, deleted in rows:
    db.execute("INSERT INTO messages (channel_id, ts, workspace_id, user_id, subtype, text, normalized_text,"
               " deleted_ts, source_rank, source_name, raw_json, updated_at) VALUES (?,?,?,?,?,?,?,?,0,'t','{}','')",
               (cid, t, "W1", uid, sub, text, text, deleted))
db.commit()
db.close()
before = db_file.read_bytes()

g = Graph(":memory:")
report = osgraph_ingest.ingest_all(g, Ctx(db_file), days=7, ids=Identities(tmp / "no-people.db"), only=["slack"])
check("the slack source ran without an error", "error" not in report["slack"], report["slack"])
threads = {n["label"]: n for n in g.nodes("Thread")}
waiting = {e["src"] for e in g.edges(verb="AWAITS_REPLY_FROM")}
waits = {label for label, n in threads.items() if n["id"] in waiting}
check("a DM, the answered DM and the channel that mentions him are threads",
      set(threads) == {"@alice in acme-amber", "@bob in acme-amber", "#launch in acme-amber"}, sorted(threads))
check("the DM asking him and the channel line mentioning him wait on him",
      waits == {"@alice in acme-amber", "#launch in acme-amber"}, sorted(waits))
check("a person is the handle, never the display name a user picked",
      not any("Karthik" in n["label"] for n in g.nodes("Person")), [n["label"] for n in g.nodes("Person")])
check("someone with no users row is named by the DM's own name", "@bob in acme-amber" in threads)
check("a deleted line never reaches the graph", not any("wire money" in n["label"] for n in g.nodes("Message")))
check("a line older than the window never reaches the graph", not any("old ask" in n["label"] for n in g.nodes("Message")))
check("a Slack thread files under the workspace's space",
      all(e["dst"] == "space:amber" for e in g.edges(verb="BELONGS_TO")), g.edges(verb="BELONGS_TO"))
check("no reply_to: the walks treat that as an iMessage handle",
      not any("reply_to" in (n["props"] or {}) for n in threads.values()))
rows = W.needs_you(g, NOW)["rows"]
check("needs-you shows the Slack DM that waits on him",
      any("@alice" in json.dumps(r) for r in rows), [r.get("title") or r.get("label") for r in rows])
check("slacrawl's file is byte for byte unchanged and no -wal or -shm was left beside it",
      db_file.read_bytes() == before and not Path(str(db_file) + "-shm").exists()
      and not Path(str(db_file) + "-wal").exists())

missing = osgraph_ingest.ingest_all(Graph(":memory:"), Ctx(tmp / "nope.db"), days=7, ids=Identities(tmp / "x.db"),
                                    only=["slack"])["slack"]
check("no slacrawl store is a note, never an error", "error" not in missing and "chewbacca slack" in missing.get("note", ""),
      missing)

print("all passed" if not failed else f"{failed} failed")
sys.exit(1 if failed else 0)
