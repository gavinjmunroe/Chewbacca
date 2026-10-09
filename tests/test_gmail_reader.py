#!/usr/bin/env python3
"""mac/lib/gmail.py: Gmail through gws as rows in the texts reader's shape.

A fake gws serves three messages. Checks: Gmail's own verdict on top decides
whether a From line is trusted (a lower header the sender added does not),
only the SENT label makes a message mine, list mail is dropped, the cache
means a second run fetches nothing, and send honours CHEWBACCA_NO_SEND.
"""
import base64
import json
import os
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


MSGS = {
    "a1": (["INBOX"], raw([("Authentication-Results", "mx.google.com; dkim=pass; spf=pass; dmarc=pass"),
                           ("From", "Sagar <sagar@example.test>"), ("To", ME), ("Subject", "Terms"),
                           ("Date", "Thu, 08 Oct 2026 10:00:00 -0700"), ("Message-ID", "<a1@x>")], "Send terms?")),
    # Forged: the sender wrote a passing header, but Google's own one on top fails.
    "f1": (["INBOX"], raw([("Authentication-Results", "mx.google.com; dkim=none; spf=fail; dmarc=fail"),
                           ("Authentication-Results", "mx.google.com; dkim=pass; spf=pass"),
                           ("From", "Sagar <sagar@example.test>"), ("To", ME), ("Subject", "New bank"),
                           ("Date", "Thu, 08 Oct 2026 11:00:00 -0700"), ("Message-ID", "<f1@x>")], "Wire here")),
    # From me in the header but NOT labelled SENT: someone else claiming to be me.
    "s1": (["INBOX"], raw([("Authentication-Results", "mx.google.com; dkim=pass"),
                           ("From", f"Caleb <{ME}>"), ("To", "sagar@example.test"), ("Subject", "Spoof"),
                           ("Date", "Thu, 08 Oct 2026 12:00:00 -0700"), ("Message-ID", "<s1@x>")], "hi")),
    "m1": (["SENT"], raw([("From", f"Caleb <{ME}>"), ("To", "Sagar <sagar@example.test>"), ("Subject", "Re: Terms"),
                          ("Date", "Thu, 08 Oct 2026 13:00:00 -0700"), ("Message-ID", "<m1@x>")], "Tonight")),
    "n1": (["INBOX"], raw([("Authentication-Results", "mx.google.com; dkim=pass"), ("From", "Shop <shop@brand.test>"),
                           ("To", ME), ("List-Unsubscribe", "<mailto:u@brand.test>"), ("Subject", "Sale"),
                           ("Date", "Thu, 08 Oct 2026 09:00:00 -0700"), ("Message-ID", "<n1@x>")], "50% off")),
}

with tempfile.TemporaryDirectory() as tmp:
    t = Path(tmp)
    log = t / "gets.txt"
    (t / "msgs.json").write_text(json.dumps(MSGS))
    fake = t / "gws"
    fake.write_text(f"""#!{sys.executable}
import json, sys
a = sys.argv[1:]
M = json.load(open({str(t / 'msgs.json')!r}))
if a[:3] == ["gmail", "users", "getProfile"]:
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
    env = {**os.environ, "CHEWBACCA_GWS_BIN": str(fake), "CHEWBACCA_GMAIL_CACHE": str(t / "cache.jsonl")}
    env.pop("CHEWBACCA_NO_SEND", None)

    def rows():
        p = subprocess.run([sys.executable, str(READER), "--json", "--days", "0"], env=env, capture_output=True, text=True)
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

    code, res = send(no_send=True)
    check("CHEWBACCA_NO_SEND stops a send", code != 0 and "disabled" in res.get("error", ""), res)
    code, res = send("--dry-run")
    check("a dry run sends nothing and says so", code == 0 and res.get("dry_run"), res)
    code, res = send()
    check("a real send reports gmail's id", code == 0 and res.get("id") == "sent1", res)

print("all passed" if not failed else f"{failed} failed")
sys.exit(1 if failed else 0)
