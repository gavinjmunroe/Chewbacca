#!/usr/bin/env python3
"""Gmail, read through the Gmail API with gws, as rows in texts.py's shape.

`people texts sync` files these next to iMessage, WhatsApp and Slack. Mail.app
is not involved: Caleb, 2026-10-08, "We shouldn't be using the mail app".
gws (Google Workspace CLI) holds the OAuth token in the keychain; this script
never sees it.

What lands is human correspondence only, using the same filters as
email_reader.py (machine senders, list and bulk headers, blind-copied blasts)
plus Gmail's own Promotions, Social, Updates and Forums tabs.

Every fetched message is cached by Gmail id in ~/.chewbacca/gmail/cache.jsonl,
so a sync only fetches what is new. Measured 2026-10-08: one fetch is about
0.7s and the filtered mailbox is 1,768 messages, so the first sync is a few
minutes with 8 workers and every later one is seconds.

SENDER TRUST. A From line is whatever the sender typed. An incoming address
may file a message under a person only when Gmail's own verdict, the topmost
Authentication-Results header with authserv-id mx.google.com, says DKIM or SPF
passed and DMARC did not fail. A sender can add their own lower headers, but
not the one Google writes on top. My own messages are mine only when Gmail
filed them under SENT, a label nobody outside the account can set.

  gmail.py --json --days N     rows (0 = everything)
  gmail.py send --to A --subject S --text T [--dry-run]
"""
import argparse, base64, email, email.policy, hashlib, json, os, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from email.utils import getaddresses, parseaddr, parsedate_to_datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from email_reader import (TEXT_CAP, body_of, clean_subject, is_bulk,  # noqa: E402
                          is_machine_address, trim_reply)

GWS = os.environ.get("CHEWBACCA_GWS_BIN", "gws")
CACHE = os.path.expanduser(os.environ.get("CHEWBACCA_GMAIL_CACHE", "~/.chewbacca/gmail/cache.jsonl"))
# Each app owns its own trillion (see the ID_BASE note in whatsapp.py).
ID_BASE = 4_000_000_000_000
ID_BITS = 40
WORKERS = 8
SKIP_TABS = "-in:spam -in:trash -category:promotions -category:social -category:updates -category:forums"
TRUSTED_AUTHSERV = {"mx.google.com"}
AUTH_PASS = re.compile(r"\b(dkim|spf)\s*=\s*pass\b", re.I)
AUTH_FAIL = re.compile(r"\bdmarc\s*=\s*fail\b", re.I)


DEFAULT_CFG = os.path.expanduser("~/.config/gws")
EMAIL_HOME = os.path.expanduser(os.environ.get("CHEWBACCA_EMAIL_HOME", "~/.chewbacca/email"))
ACCOUNT = {"cfg": None}  # the gws config dir the current call runs against


def accounts():
    """Every signed-in inbox: gws's own default, plus each `chewbacca email add`."""
    if os.environ.get("CHEWBACCA_GWS_BIN"):  # tests: one fake account
        return [None]
    dirs = [DEFAULT_CFG] if os.path.isdir(DEFAULT_CFG) else []
    if os.path.isdir(EMAIL_HOME):
        dirs += sorted(os.path.join(EMAIL_HOME, d) for d in os.listdir(EMAIL_HOME)
                       if os.path.isdir(os.path.join(EMAIL_HOME, d)))
    return dirs


def gws(args, timeout=60):
    env = dict(os.environ)
    if ACCOUNT["cfg"]:
        env["GOOGLE_WORKSPACE_CLI_CONFIG_DIR"] = ACCOUNT["cfg"]
    p = subprocess.run([GWS] + args, capture_output=True, text=True, timeout=timeout, env=env)
    if p.returncode != 0:
        raise RuntimeError((p.stderr or p.stdout).strip().splitlines()[-1] if (p.stderr or p.stdout).strip() else "gws failed")
    return p.stdout


def api(method, params):
    out = gws(["gmail", "users", "messages", method, "--params", json.dumps(params)])
    return json.loads(out[out.index("{"):])


def row_id(key):
    return ID_BASE + int(hashlib.sha1(key.encode()).hexdigest()[: ID_BITS // 4], 16)


def sender_verified(msg):
    """Only the header Google wrote on top counts, and only from Google."""
    top = (msg.get_all("Authentication-Results") or [None])[0]
    if not top:
        return False
    authserv = str(top).split(";", 1)[0].strip().lower()
    return authserv in TRUSTED_AUTHSERV and bool(AUTH_PASS.search(str(top))) and not AUTH_FAIL.search(str(top))


def me_addresses():
    me = set()
    try:
        out = gws(["gmail", "users", "getProfile", "--params", json.dumps({"userId": "me"})])
        me.add(json.loads(out[out.index("{"):])["emailAddress"].lower())
    except Exception:
        pass
    for a in os.environ.get("CHEWBACCA_EMAIL_ME", "").split(","):
        if a.strip():
            me.add(a.strip().lower())
    return me


def list_ids(days):
    q = SKIP_TABS
    if days:
        q += f" newer_than:{int(days)}d"
    ids, token = [], None
    while True:
        params = {"userId": "me", "q": q, "maxResults": 500}
        if token:
            params["pageToken"] = token
        page = api("list", params)
        ids += [m["id"] for m in page.get("messages", [])]
        token = page.get("nextPageToken")
        if not token:
            return ids


def fetch(gid):
    d = api("get", {"userId": "me", "id": gid, "format": "raw"})
    raw = base64.urlsafe_b64decode(d["raw"] + "=" * (-len(d["raw"]) % 4))
    return gid, d.get("labelIds", []), int(d.get("internalDate", 0)) // 1000, raw


def to_row(gid, labels, ts, raw, me):
    """One cached message to one row, or None. Pure, so the cache can store it."""
    msg = email.message_from_bytes(raw, policy=email.policy.compat32)
    sender = parseaddr(msg.get("From", ""))[1].lower()
    sender_name = parseaddr(msg.get("From", ""))[0].strip()
    to = [(n, a.lower()) for n, a in getaddresses(msg.get_all("To", []))]
    cc = [(n, a.lower()) for n, a in getaddresses(msg.get_all("Cc", []))]
    everyone = {sender} | {a for _, a in to + cc}
    everyone.discard("")
    from_me = "SENT" in labels
    if not from_me and (is_machine_address(sender) or is_bulk(msg)):
        return None
    if not from_me and not any(a in me for _, a in to + cc):
        return "blind"  # resolved against correspondents once every row is known
    if from_me:
        other = next(((n, a) for n, a in to + cc if a not in me), None)
        if other is None or is_machine_address(other[1]):
            return None
        who, handle = (other[0] or other[1]), other[1]
    else:
        who, handle = (sender_name or sender), sender
        if not sender_verified(msg):
            handle = "unverified:" + sender
    body_raw, attached = body_of(msg)
    body = trim_reply(body_raw)
    subject = (msg.get("Subject") or "").strip()
    text = (subject + ("\n\n" + body if body else "")).strip()
    if len(text) > TEXT_CAP:
        text = text[: TEXT_CAP - 1].rstrip() + "…"
    mid = (msg.get("Message-ID") or "").strip().strip("<>") or gid
    try:
        at = parsedate_to_datetime(msg.get("Date")).astimezone()
    except Exception:
        at = datetime.fromtimestamp(ts)
    return {
        "id": row_id(mid),
        "at": at.strftime("%Y-%m-%dT%H:%M:%S"),
        "with": who,
        "room": (clean_subject(subject) or "(no subject)") if len(everyone) >= 3 else None,
        "handle": handle,
        "from_me": from_me,
        "text": text,
        "reaction": False,
        "attachment_only": not body and attached,
        "source": "email",
        "_sender": sender,
        "_recipients": sorted(a for _, a in to + cc),
    }


def load_cache():
    cache = {}
    try:
        with open(cache_path()) as f:
            for line in f:
                try:
                    r = json.loads(line)
                    cache[r["gid"]] = r
                except Exception:
                    continue
    except FileNotFoundError:
        pass
    return cache


def cache_path():
    if not ACCOUNT["cfg"] or ACCOUNT["cfg"] == DEFAULT_CFG:
        return CACHE
    return os.path.join(os.path.dirname(CACHE), os.path.basename(ACCOUNT["cfg"]) + ".jsonl")


def read(days, limit):
    # me is every connected inbox, so mail between two of my own accounts is
    # never filed as someone else.
    me = set()
    for cfg in accounts():
        ACCOUNT["cfg"] = cfg
        me |= me_addresses()
    out, seen = [], set()
    for cfg in accounts():
        ACCOUNT["cfg"] = cfg
        for r in read_one(days, me):
            if r["id"] not in seen:
                seen.add(r["id"])
                out.append(r)
    out.sort(key=lambda r: r["at"])
    return out[-limit:] if limit else out


def read_one(days, me):
    try:
        if not me:
            return []
        ids = list_ids(days)
    except Exception as err:
        print(f"gmail: skipped {ACCOUNT['cfg'] or 'default'}: {err}", file=sys.stderr)
        return []
    cache = load_cache()
    todo = [g for g in ids if g not in cache]
    if todo:
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        with open(cache_path(), "a") as f, ThreadPoolExecutor(WORKERS) as pool:
            for res in pool.map(lambda g: _safe_fetch(g, me), todo):
                if res is None:
                    continue
                f.write(json.dumps(res) + "\n")
                cache[res["gid"]] = res
    rows = [cache[g]["row"] for g in ids if g in cache and cache[g]["row"] not in (None,)]
    # A blind-copied message counts only from someone I have written to.
    correspondents = {a for r in rows if isinstance(r, dict) and r["from_me"] for a in r["_recipients"]} - me
    blind = {g for g in ids if g in cache and cache[g]["row"] == "blind"}
    out, seen = [], set()
    for g in ids:
        r = cache.get(g, {}).get("row")
        if r == "blind" and g in blind:
            r = cache[g].get("full")
            if not r or r["_sender"] not in correspondents:
                continue
        if not isinstance(r, dict) or r["id"] in seen:
            continue
        seen.add(r["id"])
        out.append({k: v for k, v in r.items() if not k.startswith("_")})
    return out


def _safe_fetch(gid, me):
    try:
        gid, labels, ts, raw = fetch(gid)
    except Exception as err:
        print(f"gmail: {gid}: {err}", file=sys.stderr)
        return None
    row = to_row(gid, labels, ts, raw, me)
    rec = {"gid": gid, "row": row}
    if row == "blind":
        # Keep the full row aside so a later correspondent can unlock it
        # without a refetch.
        rec["full"] = _blind_row(gid, labels, ts, raw, me)
    return rec


def _blind_row(gid, labels, ts, raw, me):
    msg = email.message_from_bytes(raw, policy=email.policy.compat32)
    fake_me = me | {a.lower() for _, a in getaddresses(msg.get_all("To", []) + msg.get_all("Cc", []))}
    r = to_row(gid, labels, ts, raw, fake_me)
    return r if isinstance(r, dict) else None


def sending_account(to):
    """The inbox whose latest mail with this address is newest. A reply goes
    out from the account the conversation lives in, not always the default."""
    best, best_at = None, ""
    for cfg in accounts():
        ACCOUNT["cfg"] = cfg
        for rec in load_cache().values():
            r = rec.get("row")
            if isinstance(r, dict) and r.get("handle") == to and r["at"] > best_at:
                best, best_at = cfg, r["at"]
    return best if best_at else (accounts() or [None])[0]


ADDRESS = re.compile(r"^[^@\s<>,]+@[^@\s<>,]+\.[^@\s<>,]+$")


def send(to, subject, text, dry_run=False):
    if not ADDRESS.match(to or ""):
        return {"ok": False, "error": f"not an email address: {to!r}"}
    args = ["gmail", "+send", "--to", to, "--subject", subject or "(no subject)", "--body", text]
    if dry_run:
        return {"ok": True, "dry_run": True, "to": to}
    if os.environ.get("CHEWBACCA_NO_SEND"):
        return {"ok": False, "error": "sending is disabled (CHEWBACCA_NO_SEND)"}
    ACCOUNT["cfg"] = sending_account(to)
    try:
        out = gws(args)
        j = json.loads(out[out.index("{"):])
        return {"ok": True, "id": j.get("id")}
    except Exception as err:
        return {"ok": False, "error": str(err)[:200]}


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv and argv[0] == "send":
        ap = argparse.ArgumentParser(prog="gmail.py send")
        ap.add_argument("--to", required=True)
        ap.add_argument("--subject", default="")
        ap.add_argument("--text", required=True)
        ap.add_argument("--dry-run", action="store_true")
        a = ap.parse_args(argv[1:])
        res = send(a.to, a.subject, a.text, a.dry_run)
        print(json.dumps(res))
        return 0 if res.get("ok") else 1
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--days", type=int, default=30, help="0 means everything")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    rows = read(a.days, a.limit)
    if a.json:
        json.dump(rows, sys.stdout, ensure_ascii=False)
    else:
        for r in rows:
            print(f"{r['at']}  {r['with'][:24]:24} {'->' if r['from_me'] else '<-'} {r['text'][:80]!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
