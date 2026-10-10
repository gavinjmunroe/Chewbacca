#!/usr/bin/env python3
"""mac/lib/gmail.py: Gmail through gws as rows in the texts reader's shape.

A fake gws serves a small mailbox. Checks: Gmail's own verdict decides
whether a From line is trusted (a lower header the sender added does not),
only the SENT label makes a message mine, list mail is dropped, the cache
means a second run fetches nothing, and send honours CHEWBACCA_NO_SEND.

The 2026-10-08 security review of the `email add` commit added four: the
verdict must vouch for the From domain and its comments are not read (parser
differential), it only counts under Google's own SMTP hop (trust anchor), a
reused Message-ID cannot replace a real message (id collision), and the cache
of private mail is 0600 in a 0700 folder.
"""
import base64
import json
import os
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

READER = Path(__file__).resolve().parent.parent / "mac" / "lib" / "gmail.py"
failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


ME = "caleb@example.test"


def raw(headers, body):
    text = "".join(f"{k}: {v}\r\n" for k, v in headers) + "\r\n" + body
    return base64.urlsafe_b64encode(text.encode()).decode().rstrip("=")


# Google's delivery hop; its verdict sits directly under it.
HOP = ("Received", "from mail.example.test by mx.google.com with ESMTPS id h1")
GOOD = "mx.google.com; dkim=pass header.i=@example.test; spf=pass; dmarc=pass header.from=example.test"

MSGS = {
    # Listed first, so newest: a stranger reusing a1's Message-ID.
    "c2": (["INBOX"], raw([HOP, ("Authentication-Results", "mx.google.com; dkim=pass header.i=@evil.test; dmarc=pass header.from=evil.test"),
                           ("From", "Eve <eve@evil.test>"), ("To", ME), ("Subject", "Hijack"),
                           ("Date", "Thu, 08 Oct 2026 14:00:00 -0700"), ("Message-ID", "<a1@x>")], "Ignore the last one")),
    "a1": (["INBOX"], raw([HOP, ("Authentication-Results", GOOD),
                           ("From", "Sagar <sagar@example.test>"), ("To", ME), ("Subject", "Terms"),
                           ("Date", "Thu, 08 Oct 2026 10:00:00 -0700"), ("Message-ID", "<a1@x>")], "Send terms?")),
    # Forged: the sender wrote a passing header, but Google's own one on top fails.
    "f1": (["INBOX"], raw([HOP, ("Authentication-Results", "mx.google.com; dkim=none; spf=fail; dmarc=fail"),
                           ("Authentication-Results", "mx.google.com; dkim=pass; spf=pass"),
                           ("From", "Sagar <sagar@example.test>"), ("To", ME), ("Subject", "New bank"),
                           ("Date", "Thu, 08 Oct 2026 11:00:00 -0700"), ("Message-ID", "<f1@x>")], "Wire here")),
    # From me in the header but NOT labelled SENT: someone else claiming to be me.
    "s1": (["INBOX"], raw([HOP, ("Authentication-Results", "mx.google.com; dkim=pass"),
                           ("From", f"Caleb <{ME}>"), ("To", "sagar@example.test"), ("Subject", "Spoof"),
                           ("Date", "Thu, 08 Oct 2026 12:00:00 -0700"), ("Message-ID", "<s1@x>")], "hi")),
    "m1": (["SENT"], raw([("From", f"Caleb <{ME}>"), ("To", "Sagar <sagar@example.test>"), ("Subject", "Re: Terms"),
                          ("Date", "Thu, 08 Oct 2026 13:00:00 -0700"), ("Message-ID", "<m1@x>")], "Tonight")),
    "n1": (["INBOX"], raw([HOP, ("Authentication-Results", "mx.google.com; dkim=pass"), ("From", "Shop <shop@brand.test>"),
                           ("To", ME), ("List-Unsubscribe", "<mailto:u@brand.test>"), ("Subject", "Sale"),
                           ("Date", "Thu, 08 Oct 2026 09:00:00 -0700"), ("Message-ID", "<n1@x>")], "50% off")),
    # Passing DKIM and SPF for the sender's own domain, none for the From domain.
    "p1": (["INBOX"], raw([HOP, ("Authentication-Results", "mx.google.com; dkim=pass header.i=@evil.test; "
                                 "spf=pass smtp.mailfrom=bounce@evil.test; dmarc=none header.from=example.test"),
                           ("From", "Sagar <sagar@example.test>"), ("To", ME), ("Subject", "Unaligned"),
                           ("Date", "Thu, 08 Oct 2026 08:00:00 -0700"), ("Message-ID", "<p1@x>")], "x")),
    # The only "dkim=pass" is sender text that Google quoted in a comment.
    "p2": (["INBOX"], raw([HOP, ("Authentication-Results", "mx.google.com; dkim=none; spf=softfail (google.com: domain of "
                                 "dkim=pass@evil.test does not designate 192.0.2.1) smtp.mailfrom=dkim=pass@evil.test; "
                                 "dmarc=bestguesspass header.from=example.test"),
                           ("From", "Sagar <sagar@example.test>"), ("To", ME), ("Subject", "Comment"),
                           ("Date", "Thu, 08 Oct 2026 08:10:00 -0700"), ("Message-ID", "<p2@x>")], "x")),
    # DKIM from a subdomain of the From domain is aligned.
    "p3": (["INBOX"], raw([HOP, ("Authentication-Results", "mx.google.com; dkim=pass header.d=mail.example.test; dmarc=none"),
                           ("From", "Sagar <sagar@example.test>"), ("To", ME), ("Subject", "Subdomain"),
                           ("Date", "Thu, 08 Oct 2026 08:20:00 -0700"), ("Message-ID", "<p3@x>")], "x")),
    # Gmail fetched this over POP3; the hop and verdict under it are the sender's.
    "t1": (["INBOX"], raw([("Received", "from pop.other.test by mx.google.com with POP3 id p1"), HOP,
                           ("Authentication-Results", GOOD),
                           ("From", "Sagar <sagar@example.test>"), ("To", ME), ("Subject", "Fetched"),
                           ("Date", "Thu, 08 Oct 2026 08:30:00 -0700"), ("Message-ID", "<t1@x>")], "x")),
    # A verdict with no Google hop above it at all.
    "t2": (["INBOX"], raw([("Authentication-Results", GOOD),
                           ("From", "Sagar <sagar@example.test>"), ("To", ME), ("Subject", "No hop"),
                           ("Date", "Thu, 08 Oct 2026 08:40:00 -0700"), ("Message-ID", "<t2@x>")], "x")),
}
# The same message in a second place (two of my inboxes) is still one row.
MSGS["d1"] = MSGS["a1"]

with tempfile.TemporaryDirectory() as tmp:
    t = Path(tmp)
    log = t / "gets.txt"
    (t / "msgs.json").write_text(json.dumps(MSGS))
    fake = t / "gws"
    fake.write_text(f"""#!{sys.executable}
import base64, email, json, sys
a = sys.argv[1:]
open({str(t / 'calls.jsonl')!r}, "a").write(json.dumps(a) + "\\n")
M = json.load(open({str(t / 'msgs.json')!r}))
if a[:4] == ["gmail", "users", "messages", "get"] and json.loads(a[a.index("--params") + 1]).get("format") == "metadata":
    gid = json.loads(a[a.index("--params") + 1])["id"]
    m = email.message_from_bytes(base64.urlsafe_b64decode(M[gid][1] + "=" * (-len(M[gid][1]) % 4)))
    print(json.dumps({{"id": gid, "threadId": "thr-" + gid, "payload": {{"headers": [{{"name": k, "value": v}} for k, v in m.items()]}}}}))
elif a[:4] == ["gmail", "users", "drafts", "create"]:
    print(json.dumps({{"id": "draft1", "message": {{"id": "x"}}}}))
elif a[:3] == ["gmail", "users", "getProfile"]:
    print(json.dumps({{"emailAddress": {ME!r}}}))
elif a[:4] == ["gmail", "users", "messages", "list"]:
    print(json.dumps({{"messages": [{{"id": k}} for k in M]}}))
elif a[:4] == ["gmail", "users", "messages", "get"]:
    gid = json.loads(a[a.index("--params") + 1])["id"]
    open({str(log)!r}, "a").write(gid + "\\n")
    labels, r = M[gid]
    print(json.dumps({{"id": gid, "labelIds": labels, "internalDate": "0", "raw": r}}))
elif a[:2] == ["gmail", "+send"]:
    print(json.dumps({{"id": "sent1"}}))
else:
    sys.exit(2)
""")
    fake.chmod(0o755)
    cache = t / "gmail" / "cache.jsonl"  # its folder does not exist yet
    env = {**os.environ, "CHEWBACCA_GWS_BIN": str(fake), "CHEWBACCA_GMAIL_CACHE": str(cache)}
    env.pop("CHEWBACCA_NO_SEND", None)
    os.umask(0o022)  # the usual default, which left the cache world-readable

    def rows(e=None):
        p = subprocess.run([sys.executable, str(READER), "--json", "--days", "0"], env=e or env, capture_output=True, text=True)
        return json.loads(p.stdout or "[]")

    r = rows()
    by = {x["text"].split("\n")[0]: x for x in r}
    check("a verified sender keeps their address", by.get("Terms", {}).get("handle") == "sagar@example.test", by.get("Terms"))
    check("a lower header the sender wrote does not beat Google's verdict on top",
          by.get("New bank", {}).get("handle") == "unverified:sagar@example.test", by.get("New bank"))
    check("my address in From without the SENT label is not mine",
          "Spoof" not in by or not by["Spoof"]["from_me"], by.get("Spoof"))
    check("a SENT message is mine, filed under who it went to",
          by.get("Re: Terms", {}).get("from_me") is True and by["Re: Terms"]["handle"] == "sagar@example.test", by.get("Re: Terms"))
    check("list mail is dropped", "Sale" not in by, list(by))
    for subject in ("Unaligned", "Comment"):
        check(f"parser differential: {subject} does not verify the From address",
              by.get(subject, {}).get("handle") == "unverified:sagar@example.test", by.get(subject))
    check("DKIM aligned through a subdomain verifies", by.get("Subdomain", {}).get("handle") == "sagar@example.test", by.get("Subdomain"))
    for subject in ("Fetched", "No hop"):
        check(f"trust anchor: {subject} is not Google's verdict",
              by.get(subject, {}).get("handle") == "unverified:sagar@example.test", by.get(subject))
    check("id collision: a reused Message-ID does not replace the real message",
          "Terms" in by and "Hijack" in by and by["Terms"]["id"] != by["Hijack"]["id"], sorted(by))
    check("the same message in two places is one row", sum(x["text"].startswith("Terms") for x in r) == 1, r)
    check("cache file is 0600", stat.S_IMODE(cache.stat().st_mode) == 0o600, oct(stat.S_IMODE(cache.stat().st_mode)))
    check("cache folder is 0700", stat.S_IMODE(cache.parent.stat().st_mode) == 0o700, oct(stat.S_IMODE(cache.parent.stat().st_mode)))
    old = t / "old.jsonl"
    old.write_text("")
    old.chmod(0o644)
    rows({**env, "CHEWBACCA_GMAIL_CACHE": str(old)})
    check("an existing 0644 cache is tightened to 0600", stat.S_IMODE(old.stat().st_mode) == 0o600, oct(stat.S_IMODE(old.stat().st_mode)))
    check("ids sit in the email range", all(4_000_000_000_000 <= x["id"] < 4_000_000_000_000 + 2**40 for x in r))
    first = log.read_text().count("\n")
    rows()
    check("a second run fetches nothing it already has", log.read_text().count("\n") == first, log.read_text())

    def send(*extra, no_send=False):
        e = dict(env)
        if no_send:
            e["CHEWBACCA_NO_SEND"] = "1"
        p = subprocess.run([sys.executable, str(READER), "send", "--to", "sagar@example.test", "--subject", "s",
                            "--text", "t", *extra], env=e, capture_output=True, text=True)
        return p.returncode, json.loads(p.stdout or "{}")

    # An unverified row's handle is "unverified:" plus the claimed From. The
    # colon is legal in a local part, so it passed the address check and a
    # send to it reached gws.
    p = subprocess.run([sys.executable, str(READER), "send", "--to", "unverified:sagar@example.test", "--subject", "s",
                        "--text", "t", "--dry-run"], env=env, capture_output=True, text=True)
    check("send refuses an unverified: handle, even on a dry run",
          p.returncode != 0 and "unverified" in json.loads(p.stdout or "{}").get("error", ""), p.stdout + p.stderr)

    code, res = send(no_send=True)
    check("CHEWBACCA_NO_SEND stops a send", code != 0 and "disabled" in res.get("error", ""), res)
    code, res = send("--dry-run")
    check("a dry run sends nothing and says so", code == 0 and res.get("dry_run"), res)
    code, res = send()
    check("a real send reports gmail's id", code == 0 and res.get("id") == "sent1", res)

    # Draft, never send (CHW-192). The Go on a mail row ends here.
    calls = t / "calls.jsonl"
    calls.write_text("")

    def draft(*args):
        p = subprocess.run([sys.executable, str(READER), "draft", *args], env=env, capture_output=True, text=True)
        made = [json.loads(line) for line in calls.read_text().splitlines()]
        calls.write_text("")
        return p.returncode, json.loads(p.stdout or "{}"), made

    def sends(made):
        return [c for c in made if "+send" in c or "+reply" in c or "+reply-all" in c or "+forward" in c
                or c[2:4] in (["messages", "send"], ["drafts", "send"])]

    a1 = next(x for x in r if x["text"].startswith("Terms"))
    check("each row carries its Gmail id and inbox", a1.get("gmail_id") in ("a1", "d1") and a1.get("inbox") == "", a1)
    code, res, made = draft("--gmail-id", "a1", "--inbox", "", "--to", "sagar@example.test", "--text", "Tonight works")
    created = [c for c in made if c[2:4] == ["drafts", "create"]]
    check("a reply becomes one draft", code == 0 and res.get("draft_id") == "draft1" and len(created) == 1, (res, made))
    body = json.loads(created[0][created[0].index("--json") + 1]) if created else {}
    sent_raw = base64.urlsafe_b64decode(body.get("message", {}).get("raw", "") + "==").decode() if body else ""
    check("in the message's own thread, threaded by its Message-ID",
          body.get("message", {}).get("threadId") == "thr-a1" and "In-Reply-To: <a1@x>" in sent_raw
          and "Subject: Re: Terms" in sent_raw and "To: sagar@example.test" in sent_raw, sent_raw)
    check("drafting calls nothing that sends", sends(made) == [] and {tuple(c[2:4]) for c in made} <= {
          ("messages", "get"), ("drafts", "create")}, made)
    code, res, made = draft("--gmail-id", "f1", "--to", "unverified:sagar@example.test", "--text", "x")
    check("an unverified sender gets no draft and no gws call", code != 0 and made == [], (res, made))
    code, res, made = draft("--gmail-id", "a1", "--to", "eve@evil.test", "--text", "x")
    check("an address that isn't the message's sender gets no draft",
          code != 0 and not any(c[2:4] == ["drafts", "create"] for c in made), (res, made))
    code, res, made = draft("--gmail-id", "a1;rm", "--to", "sagar@example.test", "--text", "x")
    check("an id that isn't a Gmail id never reaches gws", code != 0 and made == [], (res, made))
    code, res, made = draft("--gmail-id", "a1", "--inbox", "../../elsewhere", "--to", "sagar@example.test", "--text", "x")
    check("an inbox that isn't signed in says so and calls nothing",
          code != 0 and "not signed in" in res.get("error", "") and made == [], (res, made))
    src = READER.read_text()
    fn = src[src.index("def draft("):src.index("def main(")]
    check("send is unreachable from draft: no send helper or endpoint in its code",
          not any(w in fn for w in ('"+send"', '"+reply"', '"send"', "send(")), fn[:80])

# An address of his that isn't a connected inbox is still him. Test mail from
# the Blue Modern address on 2026-10-09 otherwise reads as a stranger waiting.
with tempfile.TemporaryDirectory() as home:
    Path(home, "me").write_text("# mine\nSecond@Example.test\nnot-an-address\n")
    p = subprocess.run([sys.executable, "-c", "import sys; sys.path.insert(0, sys.argv[1]); import gmail; print(sorted(gmail.me_file()))",
                        str(READER.parent)], env={**os.environ, "CHEWBACCA_EMAIL_HOME": home}, capture_output=True, text=True)
    check("EMAIL_HOME/me lists the user's other addresses, lowercased, comments skipped",
          p.stdout.strip() == "['second@example.test']", p.stdout + p.stderr)

print("all passed" if not failed else f"{failed} failed")
sys.exit(1 if failed else 0)
