#!/usr/bin/env python3
"""Link Slack threads in people.db to people, in two steps the user can read between.

Slack rows land in people.db with a Slack user id (U.../W...) as their handle,
because the desktop cache slacrawl reads carries no email or phone. Nothing in
`people texts sync` can match an id, so every Slack row stayed unlinked
(1,522 of 1,578 on 2026-10-09).

    slack_link.py scan  [--out FILE]          read-only, writes only FILE
    slack_link.py apply FILE [--dry-run]      writes the reviewed matches
    slack_link.py undo  [--origin ORIGIN]     removes exactly what one apply wrote

SCAN opens both databases read-only (mode=ro) and writes nothing but the
proposal TSV. It maps each Slack user id to a person by:

  - exact profile email, against identities(kind='email') and people.email
  - exact FULL name: the Slack real_name or display_name, case-folded and
    whitespace-collapsed, equal to a person's name. A name with one word is
    never used. A first name is not evidence: matching "Jonah" by first name
    once filed a client's thread under a different Jonah in the store.

One person found = `match`. Two or more (two people share the name, or the
email and the name point at different people) = `ambiguous`, never linked.

APPLY reads the proposal back and writes only rows still marked `match`, so
deleting a line or changing its status is how a reviewer says no. Each link
gets an origin (`slack-link:<UTC stamp>`) in slack_links.origin and in
messages.link_origin, and UNDO with that origin clears exactly those rows.
"""

import argparse
import csv
import json
import os
import re
import sqlite3
import sys
import unicodedata
from datetime import datetime, timezone

PEOPLE_DB = os.path.join(
    os.path.expanduser(os.environ.get("PEOPLE_DIR", "~/.chewbacca/people")), "people.db"
)
SLACRAWL_DB = os.path.expanduser(os.environ.get("SLACRAWL_DB", "~/.slacrawl/slacrawl.db"))

# Slack user ids: U... in a single workspace, W... across an Enterprise Grid
# (the USC workspaces). C.../D.../G... handles are channels, which is what a
# message I sent to a channel carries, and are never a person.
USER_ID = re.compile(r"^[UW][A-Z0-9]{6,}$")

COLUMNS = ["status", "slack_id", "slack_name", "person_id", "person_name", "basis",
           "candidates", "messages"]


def ro(path):
    if not os.path.exists(path):
        sys.exit(f"slack_link: no database at {path}")
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=15)
    con.row_factory = sqlite3.Row
    return con


def norm(name):
    """Case and spacing are the only differences forgiven. Nothing else."""
    s = unicodedata.normalize("NFKC", str(name or "")).casefold()
    return " ".join(s.split())


def full_name(name):
    n = norm(name)
    return n if len(n.split()) >= 2 else ""


def loads(raw):
    try:
        val = json.loads(raw or "{}")
        return val if isinstance(val, dict) else {}
    except ValueError:
        return {}


def slack_profiles(con):
    """id -> {names, email, bot}, plus the set of ids that are me."""
    me = set()
    for r in con.execute("SELECT raw_json FROM workspaces"):
        uid = loads(r["raw_json"]).get("user_id")
        if uid:
            me.add(uid)
    users = {}
    for r in con.execute("SELECT id, name, real_name, display_name, is_bot, raw_json FROM users"):
        prof = loads(r["raw_json"]).get("profile") or {}
        names = [r["real_name"], prof.get("real_name"), r["display_name"], prof.get("display_name")]
        label = next((n for n in names if n), r["name"] or r["id"])
        users[r["id"]] = {
            "label": label,
            "names": [n for n in names if n],
            "email": (prof.get("email") or "").strip().lower() or None,
            "bot": bool(r["is_bot"]),
        }
    return me, users


def unlinked_ids(pcon):
    """Slack user ids with unlinked rows in people.db, and how many rows each."""
    out = {}
    for r in pcon.execute(
        "SELECT handle, who, count(*) n FROM messages WHERE source='slack' AND person_id IS NULL"
        " AND handle IS NOT NULL GROUP BY handle, who"
    ):
        h = r["handle"]
        if not USER_ID.match(h):
            continue
        cur = out.setdefault(h, {"n": 0, "who": r["who"]})
        cur["n"] += r["n"]
    return out


def people_index(pcon):
    by_name, by_email, names = {}, {}, {}
    for r in pcon.execute("SELECT id, name, email FROM people WHERE deleted_at IS NULL"):
        names[r["id"]] = r["name"]
        key = full_name(r["name"])
        if key:
            by_name.setdefault(key, set()).add(r["id"])
        if r["email"]:
            by_email.setdefault(r["email"].strip().lower(), set()).add(r["id"])
    for r in pcon.execute("SELECT person_id, value FROM identities WHERE kind='email'"):
        if r["person_id"] in names:
            by_email.setdefault(r["value"].strip().lower(), set()).add(r["person_id"])
    return by_name, by_email, names


def decide(uid, prof, me, by_name, by_email):
    """(status, {person_id: [bases]}, note) for one Slack user id."""
    if uid in me:
        return "self", {}, "my own account"
    if prof is None:
        return "none", {}, "no slacrawl profile"
    if prof["bot"]:
        return "none", {}, "bot"
    hits = {}
    if prof["email"]:
        for pid in by_email.get(prof["email"], ()):
            hits.setdefault(pid, []).append("email")
    for n in prof["names"]:
        key = full_name(n)
        for pid in by_name.get(key, ()):
            basis = f"full-name:{key}"
            if basis not in hits.setdefault(pid, []):
                hits[pid].append(basis)
    if len(hits) == 1:
        return "match", hits, ""
    if len(hits) > 1:
        return "ambiguous", hits, ""
    if not any(full_name(n) for n in prof["names"]) and not prof["email"]:
        return "none", {}, "single-word name only"
    return "none", {}, "no person with that exact name or email"


def scan(people_db, slacrawl_db):
    pcon, scon = ro(people_db), ro(slacrawl_db)
    try:
        me, users = slack_profiles(scon)
        by_name, by_email, names = people_index(pcon)
        rows = []
        for uid, info in sorted(unlinked_ids(pcon).items(), key=lambda kv: -kv[1]["n"]):
            prof = users.get(uid)
            status, hits, note = decide(uid, prof, me, by_name, by_email)
            label = prof["label"] if prof else info["who"]
            row = {"status": status, "slack_id": uid, "slack_name": label, "person_id": "",
                   "person_name": "", "basis": note, "candidates": "", "messages": info["n"]}
            if status == "match":
                pid, bases = next(iter(hits.items()))
                row.update(person_id=pid, person_name=names[pid], basis="+".join(bases))
            elif status == "ambiguous":
                row["basis"] = "several people match"
                row["candidates"] = "; ".join(
                    f"{names[p]} ({p}) by {'+'.join(b)}" for p, b in sorted(hits.items())
                )
            rows.append(row)
        return rows
    finally:
        pcon.close()
        scon.close()


def clean(v):
    return str(v).replace("\t", " ").replace("\n", " ").replace("\r", " ")


def write_proposal(rows, path):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, delimiter="\t", lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({k: clean(r[k]) for k in COLUMNS})


def read_proposal(path):
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f, delimiter="\t"))


def ensure_schema(con):
    con.execute(
        """CREATE TABLE IF NOT EXISTS slack_links (
             slack_id   TEXT PRIMARY KEY,
             person_id  TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
             basis      TEXT NOT NULL,
             origin     TEXT NOT NULL,
             created_at TEXT NOT NULL DEFAULT (datetime('now'))
           )"""
    )
    con.execute("CREATE INDEX IF NOT EXISTS slack_links_origin_idx ON slack_links (origin)")
    cols = {r[1] for r in con.execute("PRAGMA table_info(messages)")}
    if "link_origin" not in cols:
        con.execute("ALTER TABLE messages ADD COLUMN link_origin TEXT")


def apply(proposal, people_db, origin=None, dry_run=False):
    rows = [r for r in read_proposal(proposal) if (r.get("status") or "").strip() == "match"]
    origin = origin or "slack-link:" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    con = sqlite3.connect(people_db, timeout=15)
    con.execute("PRAGMA busy_timeout = 15000")
    report = {"origin": origin, "links": 0, "messages": 0, "skipped": []}
    try:
        con.execute("BEGIN IMMEDIATE")
        ensure_schema(con)
        for r in rows:
            sid, pid = r["slack_id"].strip(), r["person_id"].strip()
            if not USER_ID.match(sid) or not pid:
                report["skipped"].append((sid, "malformed row"))
                continue
            if not con.execute("SELECT 1 FROM people WHERE id=? AND deleted_at IS NULL", (pid,)).fetchone():
                report["skipped"].append((sid, "person no longer in the store"))
                continue
            have = con.execute("SELECT person_id, origin FROM slack_links WHERE slack_id=?", (sid,)).fetchone()
            if have and have[0] != pid:
                report["skipped"].append((sid, f"already linked to {have[0]}"))
                continue
            # A link an earlier apply made keeps its origin, so new rows for it
            # are undone with that apply, not split across two.
            stamp = have[1] if have else origin
            if not have:
                con.execute(
                    "INSERT INTO slack_links (slack_id, person_id, basis, origin) VALUES (?,?,?,?)",
                    (sid, pid, r.get("basis") or "", origin),
                )
                report["links"] += 1
            report["messages"] += con.execute(
                "UPDATE messages SET person_id=?, link_origin=? WHERE source='slack' AND handle=?"
                " AND person_id IS NULL",
                (pid, stamp, sid),
            ).rowcount
        con.execute("ROLLBACK" if dry_run else "COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise
    finally:
        con.close()
    return report


def undo(people_db, origin):
    con = sqlite3.connect(people_db, timeout=15)
    con.execute("PRAGMA busy_timeout = 15000")
    try:
        has = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "slack_links" not in has:
            return {"links": 0, "messages": 0}
        con.execute("BEGIN IMMEDIATE")
        m = con.execute(
            "UPDATE messages SET person_id=NULL, link_origin=NULL WHERE link_origin=?", (origin,)
        ).rowcount
        l = con.execute("DELETE FROM slack_links WHERE origin=?", (origin,)).rowcount
        con.execute("COMMIT")
        return {"links": l, "messages": m}
    finally:
        con.close()


def origins(people_db):
    con = ro(people_db)
    try:
        if not con.execute("SELECT 1 FROM sqlite_master WHERE name='slack_links'").fetchone():
            return []
        return con.execute(
            "SELECT origin, count(*) n, min(created_at) t FROM slack_links GROUP BY origin ORDER BY t"
        ).fetchall()
    finally:
        con.close()


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("scan")
    s.add_argument("--out", default="slack-link-proposal.tsv")
    a = sub.add_parser("apply")
    a.add_argument("proposal")
    a.add_argument("--origin")
    a.add_argument("--dry-run", action="store_true")
    u = sub.add_parser("undo")
    u.add_argument("--origin")
    for p in (s, a, u):
        p.add_argument("--people-db", default=PEOPLE_DB)
    s.add_argument("--slacrawl-db", default=SLACRAWL_DB)
    args = ap.parse_args(argv)

    if args.cmd == "scan":
        rows = scan(args.people_db, args.slacrawl_db)
        write_proposal(rows, args.out)
        counts = {}
        for r in rows:
            counts[r["status"]] = counts.get(r["status"], 0) + 1
        msgs = sum(int(r["messages"]) for r in rows if r["status"] == "match")
        print(f"{len(rows)} Slack ids with unlinked rows: "
              + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))
        print(f"{msgs} messages would link. Proposal: {args.out}")
        return 0
    if args.cmd == "apply":
        rep = apply(args.proposal, args.people_db, args.origin, args.dry_run)
        verb = "would link" if args.dry_run else "linked"
        print(f"{verb} {rep['links']} Slack ids, {rep['messages']} messages. origin {rep['origin']}")
        for sid, why in rep["skipped"]:
            print(f"  skipped {sid}: {why}")
        if not args.dry_run and rep["links"]:
            print(f"  undo: python3 {os.path.abspath(__file__)} undo --origin {rep['origin']}")
        return 0
    if not args.origin:
        found = origins(args.people_db)
        if not found:
            print("no Slack links to undo")
        for o in found:
            print(f"{o['origin']}  {o['n']} links  {o['t']}")
        return 0
    rep = undo(args.people_db, args.origin)
    print(f"removed {rep['links']} Slack links and unlinked {rep['messages']} messages ({args.origin})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
