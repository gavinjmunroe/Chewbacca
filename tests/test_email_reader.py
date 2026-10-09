#!/usr/bin/env python3
"""mac/lib/email_reader.py: human email in texts.py's row shape, so `people
texts sync` files it next to iMessage and WhatsApp.

A fake Mail.app store: an Envelope Index with the columns read off Mail on
macOS 15 (V10) on 2026-10-08, and .emlx files named by message ROWID. Checks:
from_me follows the Sent mailbox, bulk and machine mail never lands, a blind
copied blast is dropped, quoted replies and signatures are trimmed, three
participants make a room, one Message-ID in two mailboxes is one row, the id
is the contract's, and a machine with no Mail store prints []. The send path
runs against a fake `mac` binary; no email is ever sent.
"""
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path

READER = Path(__file__).resolve().parent.parent / "mac" / "lib" / "email_reader.py"
failed = 0

ME = "me@school.test"
SAGAR = "Sagar@Example.test"
NOW = int(time.time())


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


def eml(headers, body, attachment=False):
    head = "".join(f"{k}: {v}\n" for k, v in headers.items())
    if not attachment:
        return (head + "Content-Type: text/plain; charset=utf-8\n\n" + body).encode()
    return (head + 'Content-Type: multipart/mixed; boundary="B"\n\n'
            "--B\nContent-Type: text/plain; charset=utf-8\n\n" + body + "\n"
            '--B\nContent-Type: application/pdf\nContent-Disposition: attachment; filename="deck.pdf"\n'
            "Content-Transfer-Encoding: base64\n\nJVBERi0=\n--B--\n").encode()


# rid, mailbox, sender (addr, name), recipients [(type, addr, name)], subject, age_s, headers, body, attachment
MESSAGES = [
    (1, "INBOX", (SAGAR, "Sagar Tiwari"), [(0, ME, "Me")], "Terms", 3600,
     {"Message-ID": "<s1@example.test>"},
     "Can you send the terms by Monday?\n\nSent from my iPhone", False),
    (2, "Sent", (ME, "Me"), [(0, SAGAR, "Sagar Tiwari")], "Re: Terms", 1800,
     {"Message-ID": "<m1@school.test>"},
     "Yes, tonight.\n\nOn Tue, Oct 6, 2026 at 9:00 AM Sagar Tiwari <sagar@example.test> wrote:\n> Can you send the terms by Monday?\n", False),
    (3, "INBOX", ("jane@brand.test", "Jane at Brand"), [(0, ME, "")], "Big sale", 1700,
     {"Message-ID": "<n1@brand.test>", "List-Unsubscribe": "<mailto:u@brand.test>"}, "50% off", False),
    (4, "INBOX", ("no-reply@service.test", "Service"), [(0, ME, "")], "Your code", 1600,
     {"Message-ID": "<r1@service.test>"}, "123456", False),
    (5, "INBOX", ("coach@team.test", "Coach"), [(0, ME, "")], "Practice", 1500,
     {"Message-ID": "<p1@team.test>", "Precedence": "bulk"}, "Practice moved", False),
    (6, "INBOX", ("office@dept.test", "Dept Office"), [(0, "students@dept.test", "")], "Event", 1400,
     {"Message-ID": "<b1@dept.test>"}, "Come to the event", False),
    (7, "INBOX", ("jonah@client.test", "Jonah Graham"), [(0, ME, "Me"), (1, "ryan@client.test", "Ryan")],
     "Re: Fwd: Pipeline", 1300, {"Message-ID": "<g1@client.test>"}, "Looping Ryan in.", False),
    # The same message filed under a Gmail label as well: one row, not two.
    (8, "Important", ("jonah@client.test", "Jonah Graham"), [(0, ME, "Me"), (1, "ryan@client.test", "Ryan")],
     "Re: Fwd: Pipeline", 1300, {"Message-ID": "<g1@client.test>"}, "Looping Ryan in.", False),
    (9, "INBOX", (SAGAR, "Sagar Tiwari"), [(0, ME, "Me")], "", 1200,
     {"Message-ID": "<s2@example.test>"}, "", True),
    (10, "INBOX", (SAGAR, "Sagar Tiwari"), [(0, ME, "Me")], "Old one", 90 * 86400,
     {"Message-ID": "<s3@example.test>"}, "From last summer", False),
    (11, "Spam", ("prince@scam.test", "Prince"), [(0, ME, "")], "Funds", 1100,
     {"Message-ID": "<x1@scam.test>"}, "Wire me", False),
    # Sent from a second address of mine that never sent from a Sent mailbox
    # here, so only CHEWBACCA_EMAIL_ME can say it is me.
    (12, "INBOX", ("caleb@work.test", "Caleb"), [(0, SAGAR, "Sagar Tiwari")], "From work", 1000,
     {"Message-ID": "<w1@work.test>"}, "Sent from the work account", False),
    # Anyone can type Sagar's address into From. The receiving server says the
    # domain did not send it, so it must not be filed as Sagar.
    (13, "INBOX", (SAGAR, "Sagar Tiwari"), [(0, ME, "Me")], "New bank details", 900,
     {"Message-ID": "<f1@forged.test>", "Authentication-Results": "mx.test; dkim=none; spf=fail; dmarc=fail"},
     "Wire the deposit here instead", False),
]


def build_store(root):
    acct = Path(root) / "ACCT-UUID"
    (Path(root) / "MailData").mkdir(parents=True)
    con = sqlite3.connect(Path(root) / "MailData" / "Envelope Index")
    con.executescript("""
      CREATE TABLE mailboxes (ROWID INTEGER PRIMARY KEY, url TEXT, total_count INTEGER DEFAULT 0);
      CREATE TABLE subjects (ROWID INTEGER PRIMARY KEY, subject TEXT);
      CREATE TABLE summaries (ROWID INTEGER PRIMARY KEY, summary TEXT);
      CREATE TABLE addresses (ROWID INTEGER PRIMARY KEY, address TEXT COLLATE NOCASE, comment TEXT);
      CREATE TABLE recipients (ROWID INTEGER PRIMARY KEY, message INTEGER, address INTEGER, type INTEGER, position INTEGER);
      CREATE TABLE labels (message_id INTEGER, mailbox_id INTEGER);
      CREATE TABLE message_global_data (ROWID INTEGER PRIMARY KEY, message_id INTEGER, model_category INTEGER);
      CREATE TABLE messages (ROWID INTEGER PRIMARY KEY, global_message_id INTEGER, sender INTEGER,
        subject_prefix TEXT, subject INTEGER, summary INTEGER, date_sent INTEGER, date_received INTEGER,
        mailbox INTEGER, deleted INTEGER DEFAULT 0, list_id_hash INTEGER);
    """)
    boxes = {}
    for name in ("INBOX", "Sent", "Important", "Spam"):
        boxes[name] = len(boxes) + 1
        con.execute("INSERT INTO mailboxes VALUES (?,?,0)", (boxes[name], f"imap://ACCT-UUID/{name}"))
    addr_ids = {}

    def addr(a, name):
        key = (a.lower(), name)
        if key not in addr_ids:
            addr_ids[key] = len(addr_ids) + 1
            con.execute("INSERT INTO addresses VALUES (?,?,?)", (addr_ids[key], a, name))
        return addr_ids[key]

    for rid, box, (saddr, sname), recips, subject, age, headers, body, attach in MESSAGES:
        con.execute("INSERT INTO subjects VALUES (?,?)", (rid, subject))
        con.execute("INSERT INTO message_global_data VALUES (?,?,0)", (rid, rid))
        ts = NOW - age
        con.execute("INSERT INTO messages VALUES (?,?,?,NULL,?,NULL,?,?,?,0,NULL)",
                    (rid, rid, addr(saddr, sname), rid, ts, ts, boxes[box]))
        for pos, (kind, raddr, rname) in enumerate(recips):
            con.execute("INSERT INTO recipients (message,address,type,position) VALUES (?,?,?,?)",
                        (rid, addr(raddr, rname), kind, pos))
        hdr = {"From": f"{sname} <{saddr}>", "To": ", ".join(r[1] for r in recips), "Subject": subject,
               "Authentication-Results": "mx.test; dkim=pass; spf=pass; dmarc=pass", **headers}
        raw = eml(hdr, body, attach)
        d = acct / f"{box}.mbox" / "STORE-UUID" / "Data" / "Messages"
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{rid}.emlx").write_bytes(str(len(raw)).encode() + b"\n" + raw + b"<?xml version='1.0'?><plist/>")
    con.commit()
    con.close()


def run(args, root, extra_env=None):
    env = {**os.environ, "CHEWBACCA_MAIL_ROOT": str(root), "CHEWBACCA_EMAIL_ME": ""}
    env.update(extra_env or {})
    p = subprocess.run([sys.executable, str(READER), *args], capture_output=True, text=True, env=env)
    return p


with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)

    # No Mail store at all.
    p = run(["--json", "--days", "0"], tmp / "nothing-here")
    check("no Mail store prints [] and exits 0", p.returncode == 0 and json.loads(p.stdout) == [], (p.returncode, p.stdout, p.stderr))

    root = tmp / "V10"
    build_store(root)
    p = run(["--json", "--days", "30"], root)
    check("reader exits 0", p.returncode == 0, p.stderr)
    rows = json.loads(p.stdout or "[]")
    by_text = {r["text"].split("\n")[0]: r for r in rows}
    texts = [r["text"] for r in rows]

    keys = {"id", "at", "with", "room", "handle", "from_me", "text", "reaction", "attachment_only", "source"}
    check("every row has exactly the contract's keys", all(set(r) == keys for r in rows), [sorted(r) for r in rows])
    check("every row is source email, never a reaction", all(r["source"] == "email" and r["reaction"] is False for r in rows))

    inc = by_text.get("Terms")
    check("incoming human mail lands", inc is not None, texts)
    if inc:
        check("incoming is not from_me", inc["from_me"] is False, inc)
        check("incoming 'with' is the sender's name", inc["with"] == "Sagar Tiwari", inc)
        check("handle is the lowercase address", inc["handle"] == "sagar@example.test", inc)
        check("1:1 mail has no room", inc["room"] is None, inc)
        check("signature is trimmed", "iPhone" not in inc["text"] and "Monday?" in inc["text"], inc["text"])
        want = 4_000_000_000_000 + int(hashlib.sha1(b"s1@example.test").hexdigest()[:10], 16)
        check("id is 40e9 plus 40 bits of sha1(Message-ID)", inc["id"] == want, (inc["id"], want))
        check("at is local YYYY-MM-DDTHH:MM", len(inc["at"]) == 16 and inc["at"][10] == "T", inc["at"])

    out = by_text.get("Re: Terms")
    check("my sent mail lands", out is not None, texts)
    if out:
        check("sent mail is from_me", out["from_me"] is True, out)
        check("sent 'with' is the first To recipient", out["with"] == "Sagar Tiwari" and out["handle"] == "sagar@example.test", out)
        check("quoted reply is trimmed", "wrote:" not in out["text"] and ">" not in out["text"] and "tonight" in out["text"], out["text"])

    check("List-Unsubscribe newsletter is dropped", not any("Big sale" in t for t in texts), texts)
    check("no-reply sender is dropped", not any("Your code" in t for t in texts), texts)
    check("Precedence: bulk is dropped", not any("Practice" in t for t in texts), texts)
    check("blind-copied blast to a list address is dropped", not any("Event" in t for t in texts), texts)
    check("Spam mailbox is never read", not any("Funds" in t for t in texts), texts)

    group = [r for r in rows if "Looping Ryan" in r["text"]]
    check("one Message-ID in two mailboxes is one row", len(group) == 1, len(group))
    if group:
        check("3+ participants make a room named by the bare subject", group[0]["room"] == "Pipeline", group[0])
        check("group 'with' is the sender", group[0]["with"] == "Jonah Graham", group[0])

    att = [r for r in rows if r["id"] == 4_000_000_000_000 + int(hashlib.sha1(b"s2@example.test").hexdigest()[:10], 16)]
    check("attachment with no words is attachment_only", len(att) == 1 and att[0]["attachment_only"] is True, att)
    check("rows with words are not attachment_only", inc is not None and inc["attachment_only"] is False)

    check("--days 30 leaves out a 90-day-old message", not any("Old one" in t for t in texts), texts)
    p = run(["--json", "--days", "0"], root)
    check("--days 0 reaches back past 30 days (within the first-sync bound)",
          any("Old one" in r["text"] for r in json.loads(p.stdout or "[]")), p.stdout[:200])

    check("an unknown alias of mine is not guessed to be me", not any("From work" in t for t in texts), texts)
    p = run(["--json", "--days", "30"], root, {"CHEWBACCA_EMAIL_ME": "Caleb@Work.test"})
    alias = {r["text"].split("\n")[0]: r for r in json.loads(p.stdout or "[]")}.get("From work") or {}
    check("an address named in CHEWBACCA_EMAIL_ME counts as me",
          alias.get("from_me") is True and alias.get("handle") == "sagar@example.test", alias)

    # Send, against a fake `mac` that records its argv and never sends.
    log = tmp / "mac-calls.txt"
    fake = tmp / "mac"
    fake.write_text(f"#!/bin/sh\nprintf '%s\\n' \"$@\" >> '{log}'\necho '{{\"success\": true}}'\n")
    fake.chmod(0o755)
    env = {"CHEWBACCA_MAC_BIN": str(fake)}

    p = run(["send", "--to", "sagar@example.test", "--subject", "Hi", "--text", "body", "--dry-run"], root, env)
    res = json.loads(p.stdout or "{}")
    check("send --dry-run reports ok without calling mac", p.returncode == 0 and res.get("ok") is True and res.get("dry_run") and not log.exists(), (p.stdout, log.exists()))

    p = run(["send", "--to", "not an address", "--text", "body"], root, env)
    res = json.loads(p.stdout or "{}")
    forged = [r for r in rows if "bank details" in r["text"]]
    check("a forged From never gets the real address as its handle",
          len(forged) == 1 and forged[0]["handle"] == "unverified:" + SAGAR.lower(), forged)
    check("send to a bad address is ok:false with nonzero exit", p.returncode != 0 and res.get("ok") is False and res.get("error"), p.stdout)
    check("a refused send never reaches mac", not log.exists())

    p = run(["send", "--to", "sagar@example.test", "--subject", "Hi", "--text", "body"], root, env)
    res = json.loads(p.stdout or "{}")
    called = log.read_text().split("\n") if log.exists() else []
    check("send prints ok:true with an id in the email range", p.returncode == 0 and res.get("ok") is True and res.get("id", 0) >= 4_000_000_000_000, p.stdout)
    check("send calls `mac mail send` with the exact address", called[:4] == ["mail", "send", "--to", "sagar@example.test"], called)

    fake.write_text("#!/bin/sh\necho 'Mail is not running' >&2\nexit 3\n")
    p = run(["send", "--to", "sagar@example.test", "--text", "body"], root, env)
    res = json.loads(p.stdout or "{}")
    check("a failed mac send is ok:false with nonzero exit", p.returncode != 0 and res.get("ok") is False and "Mail" in res.get("error", ""), p.stdout)

print(f"\n{'all ok' if not failed else f'{failed} failed'}")
sys.exit(1 if failed else 0)
