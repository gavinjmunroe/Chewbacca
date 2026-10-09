#!/usr/bin/env python3
"""slack: mac/lib/slack.py reads a slacrawl store into the rows texts.py
prints. A DM is filed against the other person whichever way it went, a
channel row against its sender, my own channel rows against the channel;
joins, bots, drafts and deletions never become rows; a missing store prints
[] and exits 0. `send --dry-run` resolves from the local store and touches no
network, and a real send never echoes the token.

The fake store copies the columns slacrawl 0.10.2 wrote on 2026-10-08 from
`slacrawl sync --source desktop`. No network, no real store.
"""
import hashlib
import io
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "mac" / "lib" / "slack.py"
sys.path.insert(0, str(SCRIPT.parent))
import slack  # noqa: E402

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


TEAM = "T0TEAM0001"
ME = "U0ME000001"
SAGAR = "U0SAGAR001"
KARTHIK = "U0KARTH001"
BOT = "U0BOT00001"
DM = "D0DMSAGAR1"
CHAN = "C0GENERAL1"
MPIM = "G0GROUPDM1"
NOW = time.time()


def ts(minutes_ago, frac="000100"):
    return f"{int(NOW - minutes_ago * 60)}.{frac}"


def build(path):
    con = sqlite3.connect(path)
    con.executescript("""
        CREATE TABLE workspaces (id text primary key, name text not null, domain text, enterprise_id text,
                                 raw_json text not null, updated_at text not null);
        CREATE TABLE channels (id text primary key, workspace_id text not null, name text not null, kind text not null,
                               topic text, purpose text, is_private integer not null default 0,
                               is_archived integer not null default 0, is_shared integer not null default 0,
                               is_general integer not null default 0, raw_json text not null, updated_at text not null);
        CREATE TABLE users (id text primary key, workspace_id text not null, name text not null, real_name text,
                            display_name text, title text, is_bot integer not null default 0,
                            is_deleted integer not null default 0, raw_json text not null, updated_at text not null);
        CREATE TABLE messages (channel_id text not null, ts text not null, workspace_id text not null, user_id text,
                               subtype text, client_msg_id text, thread_ts text, parent_user_id text,
                               text text not null, normalized_text text not null, reply_count integer not null default 0,
                               latest_reply text, edited_ts text, deleted_ts text, source_rank integer not null,
                               source_name text not null, raw_json text not null, updated_at text not null,
                               primary key (channel_id, ts));
    """)
    # slacrawl redacts the desktop token to "xoxc..." in raw_json; the user_id is real.
    con.execute("INSERT INTO workspaces VALUES (?,?,?,?,?,?)",
                (TEAM, "Amber", "amber", None, json.dumps({"id": TEAM, "token": "xoxc…", "user_id": ME}), ""))
    users = [
        (ME, "caleb", "Caleb Newton", "Caleb", 0, {}),
        (SAGAR, "sagar", "Sagar Tiwari", "", 0, {"profile": {"email": "sagar@example.com"}}),
        (KARTHIK, "karthik", "Karthik R", "Karthik", 0, {}),
        (BOT, "clay", "Clay Bot", "", 1, {}),
    ]
    for uid, name, real, disp, bot, raw in users:
        con.execute("INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (uid, TEAM, name, real, disp, None, bot, 0, json.dumps({"id": uid, **raw}), ""))
    chans = [
        (DM, "sagar", "desktop_im", {"user": SAGAR, "is_im": True}),
        (CHAN, "general", "desktop_channel", {}),
        (MPIM, "mpdm-caleb--sagar--karthik-1", "desktop_mpim", {"members": [ME, SAGAR, KARTHIK]}),
    ]
    for cid, name, kind, raw in chans:
        con.execute("INSERT INTO channels (id, workspace_id, name, kind, raw_json, updated_at) VALUES (?,?,?,?,?,?)",
                    (cid, TEAM, name, kind, json.dumps({"id": cid, **raw}), ""))
    msgs = [
        # channel, ts, user, subtype, text, deleted, raw extras
        (DM, ts(50), SAGAR, "", "yo did the deck land", "", {}),
        (DM, ts(49), ME, "", "Sending it rn &amp; the PDF", "", {}),
        (CHAN, ts(40), KARTHIK, "", "ping <@U0SAGAR001> see <https://example.com|the doc>", "", {}),
        (CHAN, ts(39), ME, "", "on it", "", {}),
        (CHAN, ts(38), ME, "", "", "", {"files": [{"id": "F1"}]}),
        (MPIM, ts(30), KARTHIK, "", "group hi", "", {}),
        # never rows:
        (CHAN, ts(20), KARTHIK, "channel_join", "<@U0KARTH001> has joined the channel", "", {}),
        (CHAN, ts(19), "", "bot_message", "Enrichment finished", "", {"bot_id": "B1"}),
        (CHAN, ts(18), BOT, "", "a bot user posting", "", {}),
        (CHAN, ts(17), SAGAR, "", "deleted one", ts(16), {}),
        (CHAN, "draft:123.456:" + TEAM + ":" + CHAN, ME, "desktop_draft", "unsent draft", "", {}),
        (CHAN, ts(15), SAGAR, "tombstone", "This message was deleted.", "", {}),
        # outside a 1-day window:
        (CHAN, ts(60 * 24 * 3), SAGAR, "", "three days old", "", {}),
    ]
    for cid, t, uid, sub, text, deleted, extra in msgs:
        raw = {"channel": cid, "ts": t, "user": uid, "subtype": sub, "text": text, **extra}
        con.execute("INSERT INTO messages (channel_id, ts, workspace_id, user_id, subtype, text, normalized_text,"
                    " deleted_ts, source_rank, source_name, raw_json, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    (cid, t, TEAM, uid or None, sub, text, text, deleted, 1, "desktop-indexeddb", json.dumps(raw), ""))
    con.commit()
    con.close()


def run_cli(*args, db):
    env = dict(os.environ, SLACRAWL_DB=str(db))
    env.pop("SLACK_USER_TOKEN", None)
    return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True, env=env, timeout=30)


def reading(db):
    p = run_cli("--json", "--days", "0", db=db)
    check("reader exits 0", p.returncode == 0, p.stderr)
    rows = json.loads(p.stdout)
    keys = {"id", "at", "with", "room", "handle", "from_me", "text", "reaction", "attachment_only", "source"}
    check("seven conversation rows, nothing else", len(rows) == 7, [r["text"] for r in rows])
    check("every row has exactly the contract keys", all(set(r) == keys for r in rows))
    check("source is slack, reaction false", all(r["source"] == "slack" and r["reaction"] is False for r in rows))
    check("at is local YYYY-MM-DDTHH:MM", all(len(r["at"]) == 16 and r["at"][10] == "T" for r in rows))
    by = {r["text"]: r for r in rows}

    inbound_dm = by.get("yo did the deck land", {})
    check("DM inbound: with is the other person", inbound_dm.get("with") == "Sagar Tiwari", inbound_dm)
    check("DM inbound: handle is their email when known", inbound_dm.get("handle") == "sagar@example.com", inbound_dm)
    check("DM inbound: room is null, not from me", inbound_dm.get("room") is None and inbound_dm.get("from_me") is False)

    outbound_dm = by.get("Sending it rn & the PDF", {})
    check("DM from me: entities unescaped", bool(outbound_dm), list(by))
    check("DM from me: with/handle are still the other person",
          outbound_dm.get("with") == "Sagar Tiwari" and outbound_dm.get("handle") == "sagar@example.com"
          and outbound_dm.get("from_me") is True, outbound_dm)

    chan_in = by.get("ping @Sagar Tiwari see the doc", {})
    check("channel inbound: mentions and links read as text", bool(chan_in), list(by))
    check("channel inbound: with is the sender, handle the sender's id",
          chan_in.get("with") == "Karthik" and chan_in.get("handle") == KARTHIK and chan_in.get("room") == "general",
          chan_in)

    chan_me = by.get("on it", {})
    check("channel from me: handle is the channel id",
          chan_me.get("from_me") is True and chan_me.get("handle") == CHAN and chan_me.get("room") == "general", chan_me)

    file_row = by.get("", {})
    check("file-only post is attachment_only", file_row.get("attachment_only") is True, file_row)
    check("text posts are not attachment_only", chan_me.get("attachment_only") is False)

    group = by.get("group hi", {})
    check("group DM room names the other members", group.get("room") == "Sagar Tiwari, Karthik", group)

    leaked = [t for t in ("has joined", "Enrichment", "a bot user", "deleted one", "unsent draft",
                          "This message was deleted") if any(t in r["text"] for r in rows)]
    check("joins, bots, deletions, drafts and tombstones are dropped", not leaked, leaked)

    first = rows[0]
    con = sqlite3.connect(db)
    t = con.execute("SELECT ts FROM messages WHERE text = 'yo did the deck land'").fetchone()[0]
    con.close()
    key = f"{TEAM}:{DM}:{t}".encode()
    want = 3_000_000_000_000 + int(hashlib.sha1(key).hexdigest()[:10], 16)
    check("id is 30e9 + 40 bits of sha1(workspace:channel:ts)", inbound_dm.get("id") == want, (inbound_dm.get("id"), want))
    check("ids sit above WhatsApp's range", all(3_000_000_000_000 <= r["id"] < 3_000_000_000_000 + 2**40 for r in rows))
    check("ids are unique", len({r["id"] for r in rows}) == len(rows))
    check("rows are in time order", [r["at"] for r in rows] == sorted(r["at"] for r in rows), first)

    p = run_cli("--json", "--days", "1", db=db)
    recent = json.loads(p.stdout)
    check("--days 1 drops the three-day-old row", len(recent) == 6 and not any("three days" in r["text"] for r in recent),
          len(recent))
    p = run_cli("--json", "--days", "0", "--limit", "2", db=db)
    check("--limit keeps the newest", len(json.loads(p.stdout)) == 2)


def empty(tmp):
    p = run_cli("--json", "--days", "0", db=tmp / "missing.db")
    check("no store: prints [] and exits 0", p.returncode == 0 and p.stdout.strip() == "[]", (p.returncode, p.stdout))
    junk = tmp / "junk.db"
    junk.write_text("not sqlite")
    p = run_cli("--json", "--days", "0", db=junk)
    check("unreadable store: prints [] and exits 0", p.returncode == 0 and p.stdout.strip() == "[]", (p.returncode, p.stdout))


def sending(db):
    calls = []

    def no_network(method, token, **params):
        calls.append(method)
        raise AssertionError("network touched")

    real_call, slack.call = slack.call, no_network
    saved = os.environ.pop("SLACK_USER_TOKEN", None)
    try:
        dry = slack.send(SAGAR, "hello", dry_run=True, path=str(db))
        check("dry run by user id finds the existing DM channel",
              dry.get("ok") and dry.get("channel") == DM and dry.get("workspace") == TEAM and dry.get("needs") is None, dry)
        dry = slack.send("sagar@example.com", "hello", dry_run=True, path=str(db))
        check("dry run by email resolves through the local profile", dry.get("user") == SAGAR and dry.get("channel") == DM, dry)
        dry = slack.send(CHAN, "hello", dry_run=True, path=str(db))
        check("dry run by channel id keeps the channel", dry.get("channel") == CHAN and dry.get("workspace") == TEAM, dry)
        dry = slack.send(KARTHIK, "hello", dry_run=True, path=str(db))
        check("dry run with no DM yet says conversations.open is needed", dry.get("needs") == "conversations.open", dry)
        check("dry run never touches the network", calls == [], calls)
        bad = slack.send("nonsense", "hello", dry_run=True, path=str(db))
        check("unrecognized target refused", bad.get("ok") is False)
        refused = slack.send(SAGAR, "hello", path=str(db))
        check("real send with no token refuses before any call", refused.get("ok") is False and calls == [], (refused, calls))
        check("empty text refused", slack.send(SAGAR, "  ", dry_run=True, path=str(db)).get("ok") is False)

        secret = "xoxp-test-not-a-real-token"
        os.environ["SLACK_USER_TOKEN"] = secret
        seen = []

        def fake(method, token, **params):
            seen.append((method, token == secret, params))
            if method == "conversations.open":
                return {"ok": True, "channel": {"id": "D0NEWKARTH"}}
            if method == "chat.postMessage":
                return {"ok": True, "channel": params["channel"], "ts": "1791500000.000200"}
            return {"ok": False, "error": method + ": unexpected"}

        slack.call = fake
        sent = slack.send(KARTHIK, "hello", path=str(db))
        check("send opens a DM then posts to it",
              [m for m, _, _ in seen] == ["conversations.open", "chat.postMessage"] and sent.get("channel") == "D0NEWKARTH",
              (seen, sent))
        check("send passes the env token", all(ok for _, ok, _ in seen))
        check("send answers with the row id its message will have",
              sent.get("ok") and sent.get("id") == slack.row_id(TEAM, "D0NEWKARTH", "1791500000.000200"), sent)
        buf = io.StringIO()
        with redirect_stdout(buf):
            print(json.dumps(sent))
        check("the token never appears in the answer", secret not in buf.getvalue())
        p = run_cli("send", "--to", "nonsense", "--text", "x", "--dry-run", db=db)
        check("CLI send failure exits nonzero with ok false",
              p.returncode != 0 and json.loads(p.stdout).get("ok") is False, (p.returncode, p.stdout))
        p = run_cli("send", "--to", SAGAR, "--text", "x", "--dry-run", db=db)
        check("CLI dry run exits 0 and reports the channel",
              p.returncode == 0 and json.loads(p.stdout).get("channel") == DM, p.stdout)
    finally:
        slack.call = real_call
        os.environ.pop("SLACK_USER_TOKEN", None)
        if saved is not None:
            os.environ["SLACK_USER_TOKEN"] = saved


def main() -> int:
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        db = tmp / "slacrawl.db"
        build(db)
        reading(db)
        empty(tmp)
        sending(db)
    print(f"\n{'FAILED ' + str(failed) if failed else 'all passed'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
