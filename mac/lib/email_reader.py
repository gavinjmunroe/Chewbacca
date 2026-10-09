#!/usr/bin/env python3
"""Email as rows in the same shape mac/lib/texts.py and whatsapp.py print.

`people texts sync` files iMessage and WhatsApp rows against people. This
prints real human email in that same JSON, so one person's thread shows
whichever channel it happened in.

SOURCE. Mail.app's own local store, read-only:

- ~/Library/Mail/V10/MailData/Envelope Index, a sqlite of every message's
  sender, recipients, subject, dates and mailbox.
- one .emlx per message under ~/Library/Mail/V10/<account>/..., named by the
  message's ROWID in that index. It holds the raw RFC 822 message, so the
  real Message-ID, List-Unsubscribe and Precedence headers are all there.

It needs Full Disk Access and no OAuth, and it holds every account Mail.app
syncs. `gog` (Gmail API) had no stored tokens on 2026-10-08, so it would need
a browser sign-in before it could read anything; Mail.app already had both
accounts synced. Sending goes through `mac mail send`, which drives Mail.app.

WHO IS ME. Every address that sent something filed in a Sent mailbox, plus
any in $CHEWBACCA_EMAIL_ME (comma separated). Nothing is hardcoded.

PRIVACY. Bodies are printed to stdout for the local people store and nowhere
else. Nothing here opens a network connection.
"""

import argparse, email, email.policy, hashlib, html, json, os, re, sqlite3, subprocess, sys
from datetime import datetime
from email.utils import getaddresses, parseaddr
from urllib.parse import unquote

MAIL_ROOT = os.path.expanduser(os.environ.get("CHEWBACCA_MAIL_ROOT", "~/Library/Mail/V10"))
MAC_BIN = os.environ.get("CHEWBACCA_MAC_BIN", "mac")

# Each app owns its own trillion (see the ID_BASE note in whatsapp.py):
# WhatsApp 2e12, Slack 3e12, email 4e12, each plus 40 hash bits (1.1e12).
ID_BASE = 4_000_000_000_000
ID_BITS = 40

# A first sync with --days 0 reads this many days, not all history. Measured
# 2026-10-08 on this Mac: 7,728 messages back to 2018-01, a full read took
# 5.0s, and of the human rows that survived the filters only 10 of 1,148
# were older than 730 days. So two years keeps 99% of the correspondence while
# a machine holding a decade of a busy inbox does not parse every .emlx it has
# on the first run. Pass --all to lift it.
FIRST_SYNC_DAYS = 730

TEXT_CAP = 4000

# Mailboxes that are not correspondence. Matched against the decoded mailbox
# URL path, case-insensitively.
SKIP_MAILBOX = re.compile(r"(spam|junk|trash|deleted messages|drafts|sendlater|outbox|bin)$", re.I)
SENT_MAILBOX = re.compile(r"(sent mail|sent messages|sent items|sent)$", re.I)

# Senders that are machines. Local part or whole address.
MACHINE_LOCAL = re.compile(
    r"^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|notifications?|notify|alerts?|"
    r"mailer-daemon|postmaster|bounces?|news(letter)?s?|digest|updates?|marketing|"
    r"info|hello|support|billing|receipts?|invoice|team|accounts?|security|calendar-notification|"
    r"automated|auto[-_.]?confirm|system|admin|feedback|survey|promo(tions)?)([-_.+].*)?$",
    re.I,
)
MACHINE_DOMAIN = re.compile(
    r"(^|\.)(bounce|mailer|email|mail|msg|e|em|news|mkt|marketing|notif\w*|reply|"
    r"sendgrid|mailchimp|mcsv|mandrillapp|amazonses|hubspot(email)?|salesforce|"
    r"intercom-mail|substack|beehiiv|convertkit|klaviyo)\.",
    re.I,
)

QUOTE_START = [
    re.compile(r"^On .{1,300}wrote:\s*$", re.S),
    re.compile(r"^-{2,}\s*Original Message\s*-{2,}", re.I),
    re.compile(r"^-{2,}\s*Forwarded message\s*-{2,}", re.I),
    re.compile(r"^_{10,}\s*$"),
    re.compile(r"^From:\s.+", re.I),
    re.compile(r"^Le .{1,200}a écrit\s*:\s*$"),
    re.compile(r"^Am .{1,200}schrieb.*:\s*$"),
]
SIGNATURE_START = [
    re.compile(r"^-- ?$"),
    re.compile(r"^Sent from my (iPhone|iPad|Android|Galaxy|mobile)", re.I),
    re.compile(r"^Get Outlook for ", re.I),
    re.compile(r"^Sent from (Mail|Outlook|Yahoo|Gmail) ", re.I),
]


def row_id(key):
    h = int(hashlib.sha1(key.encode()).hexdigest()[: ID_BITS // 4], 16)
    return ID_BASE + h


def local_minute(ts):
    return datetime.fromtimestamp(int(ts)).strftime("%Y-%m-%dT%H:%M")


def index_path(root):
    return os.path.join(root, "MailData", "Envelope Index")


def connect(root):
    path = index_path(root)
    if not os.path.exists(path):
        return None
    try:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
        con.row_factory = sqlite3.Row
        con.execute("SELECT 1 FROM messages LIMIT 1")
        return con
    except sqlite3.Error as err:
        print(f"email: skipping {path}: {err}", file=sys.stderr)
        return None


def mailbox_name(url):
    """'imap://UUID/%5BGmail%5D/Sent%20Mail' -> '[Gmail]/Sent Mail'."""
    rest = url.split("://", 1)[-1]
    return unquote(rest.split("/", 1)[1] if "/" in rest else "")


def emlx_paths(root):
    """messages.ROWID -> its .emlx file. Mail names each file by that ROWID."""
    out = {}
    for d, _, files in os.walk(root):
        if "MailData" in d:
            continue
        for f in files:
            if f.endswith(".emlx"):
                stem = f.split(".", 1)[0]
                if stem.isdigit():
                    # A full .emlx beats a .partial.emlx for the same message.
                    prev = out.get(int(stem))
                    if prev is None or (".partial." in prev and ".partial." not in f):
                        out[int(stem)] = os.path.join(d, f)
    return out


def read_emlx(path, headers_only=False):
    """The RFC 822 message inside an .emlx: a byte count line, then the bytes."""
    try:
        with open(path, "rb") as fh:
            first = fh.readline()
            n = int(first.strip() or 0)
            raw = fh.read(n) if n else fh.read()
    except (OSError, ValueError):
        return None
    if headers_only:
        cut = raw.find(b"\r\n\r\n")
        cut = raw.find(b"\n\n") if cut < 0 else cut
        raw = raw[: cut + 2] if cut >= 0 else raw
    try:
        return email.message_from_bytes(raw, policy=email.policy.compat32)
    except Exception as err:  # malformed mail is data, never a crash
        print(f"email: unparseable {os.path.basename(path)}: {err}", file=sys.stderr)
        return None


# Machine words anywhere in the local part: "drive-shares-dm-noreply@google.com"
# and "spamdigest@usc.edu" both got past an anchored match on 2026-10-08.
MACHINE_ANYWHERE = re.compile(r"(no-?reply|do-?not-?reply|notif|mailer|digest|alert|bounce|unsubscribe)", re.I)


def is_machine_address(addr):
    addr = (addr or "").lower()
    local, _, domain = addr.partition("@")
    if not domain:
        return True
    return bool(MACHINE_LOCAL.match(local) or MACHINE_ANYWHERE.search(local) or MACHINE_DOMAIN.search(domain))


def is_bulk(msg):
    """Header evidence that a message went to a list, not a person."""
    if msg is None:
        return False
    if msg.get("List-Unsubscribe") or msg.get("List-Id") or msg.get("List-Post"):
        return True
    prec = (msg.get("Precedence") or "").strip().lower()
    if prec in ("bulk", "list", "junk"):
        return True
    auto = (msg.get("Auto-Submitted") or "no").strip().lower()
    if auto != "no":
        return True
    if msg.get("X-Campaign") or msg.get("X-Mailchimp-Campaign") or msg.get("Feedback-ID"):
        return True
    return False


def html_to_text(s):
    s = re.sub(r"(?is)<(script|style|head).*?</\1>", " ", s)
    s = re.sub(r"(?is)<blockquote.*?</blockquote>", "\n", s)
    s = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>|</li>", "\n", s)
    s = re.sub(r"(?s)<[^>]+>", "", s)
    return html.unescape(s)


def _decode(part):
    payload = part.get_payload(decode=True)
    if payload is None:
        return ""
    charset = part.get_content_charset() or "utf-8"
    try:
        return payload.decode(charset, errors="replace")
    except LookupError:
        return payload.decode("utf-8", errors="replace")


def body_of(msg):
    """(plain text, has_attachment)."""
    plain, rich, attached = None, None, False
    for part in msg.walk():
        if part.is_multipart():
            continue
        disp = (part.get("Content-Disposition") or "").lower()
        ctype = part.get_content_type()
        if "attachment" in disp or (part.get_filename() and ctype not in ("text/plain", "text/html")):
            attached = True
            continue
        if ctype == "text/plain" and plain is None:
            plain = _decode(part)
        elif ctype == "text/html" and rich is None:
            rich = _decode(part)
    text = plain if plain and plain.strip() else (html_to_text(rich) if rich else "")
    return text, attached


def trim_reply(text):
    """Drop the quoted thread and the signature, keep what this person wrote."""
    # iPhone HTML mail pads addresses and times with hair spaces and opens the
    # quote with a BOM; left in, they hide "Sent from my iPhone" from the match.
    text = re.sub(r"[\u200a\u200b\u200c\u200d\u2060\ufeff]", "", text)
    out = []
    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        s = line.strip()
        if s.startswith(">"):
            continue
        if any(p.match(s) for p in QUOTE_START) or any(p.match(line.rstrip()) for p in SIGNATURE_START):
            break
        out.append(line.rstrip())
    body = "\n".join(out)
    # A two-line "On Tue, ... <x@y>\nwrote:" split by a hard wrap.
    body = re.split(r"\n\s*On [^\n]{1,200}\n[^\n]{0,200}wrote:\s*\n", body, maxsplit=1)[0]
    # HTML mail flattened to one line keeps its quote header mid-line:
    # "...How much is it? On Sep 9, 2025, at 8:45 AM, Name <a@b> wrote: ..."
    body = re.split(r"\s*\bOn [^\n]{0,40}\d{1,4}[^\n]{0,160}?\bwrote:", body, maxsplit=1)[0]
    body = re.split(r"\s*\bSent from my (iPhone|iPad|Android)\b", body, maxsplit=1)[0]
    body = re.sub(r"[ \t ]+", " ", body)
    body = re.sub(r"\n{3,}", "\n\n", body)
    return body.strip()


def clean_subject(s):
    s = (s or "").strip()
    while True:
        t = re.sub(r"^(re|fwd?|fw|aw|wg)\s*(\[\d+\])?\s*:\s*", "", s, flags=re.I)
        if t == s:
            return s
        s = t


def my_addresses(con, mailboxes):
    me = {a.strip().lower() for a in os.environ.get("CHEWBACCA_EMAIL_ME", "").split(",") if a.strip()}
    sent = [mid for mid, name in mailboxes.items() if SENT_MAILBOX.search(name)]
    if sent:
        marks = ",".join("?" * len(sent))
        q = f"""SELECT DISTINCT lower(a.address) addr FROM messages m JOIN addresses a ON a.ROWID = m.sender
                 WHERE m.mailbox IN ({marks})
                    OR m.ROWID IN (SELECT message_id FROM labels WHERE mailbox_id IN ({marks}))"""
        for r in con.execute(q, sent + sent):
            if r["addr"]:
                me.add(r["addr"])
    return me


def read(days, limit, root=MAIL_ROOT, all_history=False):
    con = connect(root)
    if con is None:
        return [], {"store": None, "rows": 0}
    mailboxes = {r["ROWID"]: mailbox_name(r["url"]) for r in con.execute("SELECT ROWID, url FROM mailboxes")}
    me = my_addresses(con, mailboxes)
    if not days and not all_history:
        days = FIRST_SYNC_DAYS
    since = 0 if not days else int(datetime.now().timestamp()) - days * 86400

    skip = [mid for mid, name in mailboxes.items() if SKIP_MAILBOX.search(name)]
    marks = ",".join("?" * len(skip)) or "NULL"
    q = f"""SELECT m.ROWID rid, m.date_sent, m.date_received, m.list_id_hash,
                   coalesce(m.subject_prefix, '') || s.subject subject,
                   lower(a.address) sender, a.comment sender_name, su.summary summary,
                   g.model_category category
              FROM messages m
              LEFT JOIN message_global_data g ON g.ROWID = m.global_message_id
              JOIN subjects s ON s.ROWID = m.subject
              LEFT JOIN addresses a ON a.ROWID = m.sender
              LEFT JOIN summaries su ON su.ROWID = m.summary
             WHERE m.deleted = 0 AND coalesce(m.date_sent, m.date_received) >= ?
               AND m.mailbox NOT IN ({marks})
             ORDER BY coalesce(m.date_sent, m.date_received)"""
    envelopes = list(con.execute(q, [since] + skip))
    recips = {}
    if envelopes:
        rq = """SELECT r.message, r.type, r.position, lower(a.address) addr, a.comment name
                  FROM recipients r JOIN addresses a ON a.ROWID = r.address
                 ORDER BY r.message, r.type, r.position"""
        for r in con.execute(rq):
            recips.setdefault(r["message"], []).append(r)
    paths = emlx_paths(root)
    # Everyone I have ever written to. Measured 2026-10-08: of 2,089 rows that
    # passed the header filters, 246 came from one department office and 177
    # from a spam digest, none of which named me in To or Cc. A blind-copied
    # blast is the one bulk shape that carries no bulk header, so an incoming
    # message must either name me directly or come from someone I have written to.
    correspondents = {r["addr"] for e in envelopes if (e["sender"] or "") in me
                      for r in recips.get(e["rid"], [])} - me

    seen, out, stats = set(), [], {"store": index_path(root), "envelopes": len(envelopes),
                                   "bulk": 0, "machine": 0, "blind_copy": 0,
                                   "no_counterpart": 0, "rows": 0}
    for e in envelopes:
        sender = e["sender"] or ""
        from_me = sender in me
        to = [r for r in recips.get(e["rid"], []) if r["type"] == 0]
        everyone = {sender} | {r["addr"] for r in recips.get(e["rid"], [])}
        everyone.discard("")
        if not from_me and (is_machine_address(sender) or e["list_id_hash"]):
            stats["machine"] += 1
            continue
        if not from_me and sender not in correspondents and \
                not any(r["addr"] in me for r in recips.get(e["rid"], [])):
            stats["blind_copy"] += 1
            continue
        # Mail.app's own classifier: 0 is Primary, 1 to 3 are Transactions,
        # Updates and Promotions. It is wrong often enough (a human professor's
        # replies landed in 2 and 3 on 2026-10-08) that it only decides for a
        # sender I have never written to.
        if not from_me and sender not in correspondents and e["category"] in (1, 2, 3):
            stats["machine"] += 1
            continue
        path = paths.get(e["rid"])
        msg = read_emlx(path) if path else None
        if is_bulk(msg):
            stats["bulk"] += 1
            continue
        if from_me:
            other = next((r for r in to if r["addr"] not in me), None) or \
                next((r for r in recips.get(e["rid"], []) if r["addr"] not in me), None)
            if other is None or is_machine_address(other["addr"]):
                stats["no_counterpart"] += 1
                continue
            handle, who = other["addr"], (other["name"] or "").strip() or other["addr"]
        else:
            handle, who = sender, (e["sender_name"] or "").strip() or sender

        mid = (msg.get("Message-ID") or "").strip().strip("<>") if msg is not None else ""
        key = mid or f"{sender}|{e['date_sent']}|{e['subject']}"
        if key in seen:
            continue
        seen.add(key)

        if msg is not None:
            raw_body, attached = body_of(msg)
            body = trim_reply(raw_body)
        else:
            # No .emlx on disk (Mail had not downloaded it): Mail's own preview
            # line is the only body there is.
            body, attached = trim_reply(e["summary"] or ""), False
        subject = (e["subject"] or "").strip()
        text = (subject + ("\n\n" + body if body else "")).strip()
        if len(text) > TEXT_CAP:
            text = text[: TEXT_CAP - 1].rstrip() + "…"
        room = (clean_subject(subject) or "(no subject)") if len(everyone) >= 3 else None
        out.append({
            "id": row_id(key),
            "at": local_minute(e["date_sent"] or e["date_received"]),
            "with": who,
            "room": room,
            "handle": handle,
            "from_me": from_me,
            "text": text,
            "reaction": False,
            "attachment_only": not body and attached,
            "source": "email",
        })
    out.sort(key=lambda r: r["at"])
    if limit:
        out = out[-limit:]
    stats["rows"] = len(out)
    stats["me"] = len(me)
    return out, stats


ADDRESS = re.compile(r"^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$")


def send(to, subject, text, dry_run=False, runner=subprocess.run):
    """Send through Mail.app via `mac mail send`. Returns (exit code, result)."""
    to = (to or "").strip()
    if not ADDRESS.match(to):
        return 2, {"ok": False, "error": f"not an email address: {to!r}"}
    if not (text or "").strip():
        return 2, {"ok": False, "error": "empty message"}
    argv = [MAC_BIN, "mail", "send", "--to", to, "--subject", subject or "", "--body", text, "--json"]
    sent_at = int(datetime.now().timestamp())
    key = f"sent|{to.lower()}|{sent_at}|{subject or ''}"
    if dry_run:
        return 0, {"ok": True, "dry_run": True, "id": row_id(key), "argv": argv[:3] + ["--to", to, "--subject", subject or "", "--body", f"<{len(text)} chars>"]}
    try:
        p = runner(argv, capture_output=True, text=True, timeout=60)
    except FileNotFoundError:
        return 1, {"ok": False, "error": f"{MAC_BIN} not found on PATH"}
    except subprocess.TimeoutExpired:
        return 1, {"ok": False, "error": "mac mail send timed out after 60s; check Mail.app Sent before retrying"}
    if p.returncode != 0:
        return 1, {"ok": False, "error": (p.stderr or p.stdout or f"exit {p.returncode}").strip()[:500]}
    try:
        reply = json.loads(p.stdout or "{}")
    except json.JSONDecodeError:
        reply = {}
    if isinstance(reply, dict) and reply.get("success") is False:
        return 1, {"ok": False, "error": str(reply.get("error") or "send failed")}
    return 0, {"ok": True, "id": row_id(key)}


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ["send"]:
        sp = argparse.ArgumentParser(prog="email_reader.py send")
        sp.add_argument("--to", required=True)
        sp.add_argument("--subject", default="")
        sp.add_argument("--text", required=True)
        sp.add_argument("--dry-run", action="store_true")
        a = sp.parse_args(argv[1:])
        code, result = send(a.to, a.subject, a.text, a.dry_run)
        print(json.dumps(result))
        return code
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--days", type=int, default=30, help=f"0 means the first-sync bound, {FIRST_SYNC_DAYS} days")
    ap.add_argument("--all", action="store_true", help="with --days 0, read every message in the store")
    ap.add_argument("--limit", type=int, default=0, help="0 means no row cap")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--sources", action="store_true", help="print which store was read and what was filtered")
    a = ap.parse_args(argv)
    rows, stats = read(a.days, a.limit, all_history=a.all)
    if a.sources:
        print(json.dumps(stats))
        return 0
    if a.json:
        json.dump(rows, sys.stdout, ensure_ascii=False)
        return 0
    for r in rows:
        arrow = "->" if r["from_me"] else "<-"
        print(f"{r['at']}  {r['with'][:20]:20} {arrow} {r['text'][:90].replace(chr(10), ' ')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
