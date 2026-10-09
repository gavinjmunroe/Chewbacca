#!/usr/bin/env python3
"""slack_link: Slack user ids in people.db get linked to people in two steps.

scan writes nothing to either database, matches only on an exact full name or
an exact email, and refuses a first name, a duplicate name, and a profile
whose names point at two people. apply writes only the rows still marked
match in the proposal, stamps each with an origin, and undo with that origin
removes exactly those links and leaves a hand-made link alone.

Both stores are fakes built here with the columns people.db and slacrawl
0.10.2 had on 2026-10-09. No real data, no network.
"""
import hashlib
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "mac" / "lib"))
import slack_link  # noqa: E402

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


PEOPLE = [
    ("p-sagar", "Sagar Tiwari", None),
    ("p-maggie", "maggie  CHEN", None),          # case and spacing differ from Slack
    ("p-jonah-black", "Jonah Black", None),      # the wrong Jonah a first name once found
    ("p-shirley-1", "Shirley Park", None),
    ("p-shirley-2", "Shirley Park", None),       # a duplicate in the store
    ("p-will", "William Thoman", None),
    ("p-preston", "Preston Thoman", None),
    ("p-kev", "Kevin Ortiz", "kev@example.com"),
    ("p-hand", "Hand Linked", None),
]

# id, real_name, display_name, email, is_bot
SLACK_USERS = [
    ("U0SAGAR001", "Sagar Tiwari", "", None, 0),
    ("U0MAGGIE01", "Maggie Chen", "Maggie Chen", None, 0),
    ("U0JONAH001", "", "Jonah", None, 0),                    # first name only
    ("U0SHIRLEY1", "Shirley Park", "", None, 0),             # two people share it
    ("U0PRESTON1", "Preston Thoman", "William Thoman", None, 0),  # names point at two people
    ("W0KEVIN001", "K. Ortiz", "kev", "Kev@Example.com", 0),  # email only
    ("U0STRANGE1", "Someone Else", "", None, 0),
    ("U0BOT00001", "Deploy Bot", "", None, 1),
    ("U0ME000001", "Caleb Newton", "", None, 0),
    ("U0HAND0001", "Hand Linked", "", None, 0),
]

# handle -> number of unlinked rows. U0NOPROF01 has no slacrawl profile at all.
MESSAGES = {"U0SAGAR001": 3, "U0MAGGIE01": 2, "U0JONAH001": 4, "U0SHIRLEY1": 1,
            "U0PRESTON1": 1, "W0KEVIN001": 1, "U0STRANGE1": 1, "U0ME000001": 2,
            "U0NOPROF01": 1, "C0CHANNEL1": 2}


def build_people(path):
    con = sqlite3.connect(path)
    con.executescript("""
        CREATE TABLE people (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, deleted_at TEXT);
        CREATE TABLE identities (person_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('phone','email')),
                                 value TEXT NOT NULL, PRIMARY KEY (kind, value));
        CREATE TABLE messages (msg_id INTEGER PRIMARY KEY, person_id TEXT REFERENCES people (id) ON DELETE SET NULL,
                               who TEXT NOT NULL, handle TEXT, from_me INTEGER NOT NULL, body TEXT NOT NULL,
                               sent_at TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'imessage', room TEXT);
    """)
    con.executemany("INSERT INTO people (id, name, email) VALUES (?,?,?)", PEOPLE)
    n = 0
    for handle, count in MESSAGES.items():
        for _ in range(count):
            n += 1
            con.execute("INSERT INTO messages (msg_id, who, handle, from_me, body, sent_at, source)"
                        " VALUES (?,?,?,?,?,?,'slack')", (n, handle, handle, 0, "hi", "2026-10-01 10:00"))
    # One Slack row linked by hand before any apply: undo must never touch it.
    con.execute("INSERT INTO messages (msg_id, person_id, who, handle, from_me, body, sent_at, source)"
                " VALUES (999, 'p-hand', 'Hand Linked', 'U0HAND0001', 0, 'hi', '2026-10-01 10:00', 'slack')")
    # An iMessage row with the same shape of handle must never be touched.
    con.execute("INSERT INTO messages (msg_id, who, handle, from_me, body, sent_at, source)"
                " VALUES (1000, 'x', 'U0SAGAR001', 0, 'hi', '2026-10-01 10:00', 'imessage')")
    con.commit()
    con.close()


def build_slacrawl(path):
    con = sqlite3.connect(path)
    con.executescript("""
        CREATE TABLE workspaces (id text primary key, name text not null, domain text, enterprise_id text,
                                 raw_json text not null, updated_at text not null);
        CREATE TABLE users (id text primary key, workspace_id text not null, name text not null, real_name text,
                            display_name text, title text, is_bot integer not null default 0,
                            is_deleted integer not null default 0, raw_json text not null, updated_at text not null);
    """)
    con.execute("INSERT INTO workspaces VALUES ('T1','Team','team',NULL,?, 'now')",
                ('{"id":"T1","user_id":"U0ME000001","token":"xoxc-redacted"}',))
    import json
    for uid, real, disp, email, bot in SLACK_USERS:
        prof = {"real_name": real, "display_name": disp}
        if email:
            prof["email"] = email
        con.execute("INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (uid, "T1", uid.lower(), real, disp, "", bot, 0,
                     json.dumps({"id": uid, "profile": prof}), "now"))
    con.commit()
    con.close()


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def links(path):
    con = sqlite3.connect(path)
    try:
        return dict(con.execute("SELECT handle, person_id FROM messages WHERE source='slack' AND person_id IS NOT NULL"
                                " GROUP BY handle"))
    finally:
        con.close()


def scanning(tmp):
    pdb, sdb = tmp / "people.db", tmp / "slacrawl.db"
    before = (digest(pdb), digest(sdb))
    rows = slack_link.scan(str(pdb), str(sdb))
    rows2 = slack_link.scan(str(pdb), str(sdb))
    check("scan writes nothing to either database", (digest(pdb), digest(sdb)) == before)
    check("scan twice gives the same proposal", rows == rows2)
    by = {r["slack_id"]: r for r in rows}

    check("exact full name links", by["U0SAGAR001"]["status"] == "match"
          and by["U0SAGAR001"]["person_id"] == "p-sagar", by.get("U0SAGAR001"))
    check("case and spacing are forgiven, nothing else", by["U0MAGGIE01"]["person_id"] == "p-maggie",
          by.get("U0MAGGIE01"))
    check("a first name is never a match, even with one Jonah in the store",
          by["U0JONAH001"]["status"] == "none" and by["U0JONAH001"]["person_id"] == "", by.get("U0JONAH001"))
    check("two people with the same name is ambiguous",
          by["U0SHIRLEY1"]["status"] == "ambiguous" and "p-shirley-1" in by["U0SHIRLEY1"]["candidates"]
          and "p-shirley-2" in by["U0SHIRLEY1"]["candidates"], by.get("U0SHIRLEY1"))
    check("real and display names pointing at two people is ambiguous",
          by["U0PRESTON1"]["status"] == "ambiguous", by.get("U0PRESTON1"))
    check("an exact email links when the names do not",
          by["W0KEVIN001"]["person_id"] == "p-kev" and by["W0KEVIN001"]["basis"] == "email", by.get("W0KEVIN001"))
    check("no exact name is no match", by["U0STRANGE1"]["status"] == "none")
    check("my own Slack account is never linked", by["U0ME000001"]["status"] == "self")
    check("an id with no profile is listed as no match", by["U0NOPROF01"]["status"] == "none")
    check("channel handles are not people", "C0CHANNEL1" not in by)
    check("already linked ids are not proposed", "U0HAND0001" not in by)
    check("message counts come along", by["U0SAGAR001"]["messages"] == 3, by["U0SAGAR001"]["messages"])

    out = tmp / "proposal.tsv"
    slack_link.write_proposal(rows, str(out))
    back = {r["slack_id"]: r for r in slack_link.read_proposal(str(out))}
    check("the proposal round-trips through TSV", back["U0SAGAR001"]["person_id"] == "p-sagar"
          and set(back) == set(by))
    return out


def applying(tmp, proposal):
    pdb = tmp / "people.db"
    # The reviewer says no to Maggie by changing her status, and someone hand-edits
    # an ambiguous row's person_id without marking it match: neither may be written.
    lines = proposal.read_text().splitlines()
    edited = []
    for line in lines:
        cols = line.split("\t")
        if cols[1] == "U0MAGGIE01":
            cols[0] = "rejected"
        if cols[1] == "U0SHIRLEY1":
            cols[3] = "p-shirley-1"
        edited.append("\t".join(cols))
    proposal.write_text("\n".join(edited) + "\n")

    before = digest(pdb)
    dry = slack_link.apply(str(proposal), str(pdb), origin="slack-link:dry", dry_run=True)
    check("dry run reports and writes nothing", digest(pdb) == before and dry["messages"] == 4, dry)

    rep = slack_link.apply(str(proposal), str(pdb), origin="slack-link:test1")
    got = links(pdb)
    check("apply links only reviewed matches",
          got == {"U0SAGAR001": "p-sagar", "W0KEVIN001": "p-kev", "U0HAND0001": "p-hand"}, got)
    check("apply counts what it wrote", rep["links"] == 2 and rep["messages"] == 4, rep)
    con = sqlite3.connect(pdb)
    stamped = con.execute("SELECT count(*) FROM messages WHERE link_origin='slack-link:test1'").fetchone()[0]
    imsg = con.execute("SELECT person_id FROM messages WHERE msg_id=1000").fetchone()[0]
    con.close()
    check("every written row carries the origin", stamped == 4, stamped)
    check("an iMessage row with the same handle is untouched", imsg is None, imsg)

    again = slack_link.apply(str(proposal), str(pdb), origin="slack-link:test2")
    check("apply twice writes nothing new", again["links"] == 0 and again["messages"] == 0, again)

    # A new Slack row for Sagar arrives after the first apply. Re-applying links it
    # under the first origin, so one undo still removes the whole link.
    con = sqlite3.connect(pdb)
    con.execute("INSERT INTO messages (msg_id, who, handle, from_me, body, sent_at, source)"
                " VALUES (2000, 'Sagar Tiwari', 'U0SAGAR001', 0, 'new', '2026-10-09 10:00', 'slack')")
    con.commit()
    con.close()
    late = slack_link.apply(str(proposal), str(pdb), origin="slack-link:test3")
    con = sqlite3.connect(pdb)
    late_origin = con.execute("SELECT link_origin FROM messages WHERE msg_id=2000").fetchone()[0]
    con.close()
    check("a later row joins the original link's origin", late["messages"] == 1
          and late_origin == "slack-link:test1", (late, late_origin))


def undoing(tmp):
    pdb = tmp / "people.db"
    rep = slack_link.undo(str(pdb), "slack-link:test1")
    got = links(pdb)
    check("undo removes exactly what that apply wrote", got == {"U0HAND0001": "p-hand"}, got)
    check("undo counts it", rep == {"links": 2, "messages": 5}, rep)
    con = sqlite3.connect(pdb)
    left = con.execute("SELECT count(*) FROM slack_links").fetchone()[0]
    con.close()
    check("no link rows are left behind", left == 0, left)
    check("undo of an unknown origin touches nothing",
          slack_link.undo(str(pdb), "slack-link:never") == {"links": 0, "messages": 0})


def main() -> int:
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        build_people(tmp / "people.db")
        build_slacrawl(tmp / "slacrawl.db")
        proposal = scanning(tmp)
        applying(tmp, proposal)
        undoing(tmp)
    print(f"\n{'FAILED ' + str(failed) if failed else 'all passed'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
