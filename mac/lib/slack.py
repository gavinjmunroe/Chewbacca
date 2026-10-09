#!/usr/bin/env python3
"""Slack history as rows in the same shape mac/lib/texts.py prints.

`people texts sync` already files iMessage and WhatsApp rows against people.
This prints Slack in that exact JSON so the same code files all three.

The store is slacrawl (~/.slacrawl/slacrawl.db, or $SLACRAWL_DB), a local
SQLite mirror of Slack. `slacrawl sync --source desktop` fills it from the
Slack desktop app's own cache with no token at all, so reading needs nothing
but the app being signed in. It is opened read-only here and never written.

IDENTITY. The desktop cache carries no email addresses, so a person's handle
is their Slack user id unless a profile email is present. One person in an
Enterprise Grid (the USC workspaces) keeps one user id across all of them.

SENDING. slacrawl has no send command and keeps no usable token: the desktop
cache's xoxc tokens are redacted in its db. `send` posts through the Slack Web
API with a user token from the environment ($SLACK_USER_TOKEN, the same
variable slacrawl's [slack.user] block reads). The token is never printed,
logged, or put in a URL. `--dry-run` resolves the target from the local store
and touches no network.

Message bodies are private. Nothing here sends them anywhere except Slack
itself, and only on an explicit `send`.
"""

import argparse, shutil, subprocess, hashlib, html, json, os, re, sqlite3, sys, urllib.parse, urllib.request
from datetime import datetime

SLACRAWL_DB = os.path.expanduser(os.environ.get("SLACRAWL_DB", "~/.slacrawl/slacrawl.db"))
TOKEN_ENV = "SLACK_USER_TOKEN"
COOKIE_ENV = "SLACK_COOKIE_D"  # only an xoxc token needs it
API = "https://slack.com/api/"

# Each app owns its own trillion (see the ID_BASE note in whatsapp.py):
# WhatsApp 2e12, Slack 3e12, email 4e12, each plus 40 hash bits (1.1e12).
ID_BASE = 3_000_000_000_000
ID_BITS = 40

# Subtypes that are a person talking. Joins, archives, tombstones, huddles,
# drafts and bot posts are not, the same way whatsapp.py drops system rows.
TALK_SUBTYPES = {"", None, "thread_broadcast", "file_share", "me_message"}

DM_KINDS = {"desktop_im", "im"}
GROUP_DM_KINDS = {"desktop_mpim", "mpim"}


def row_id(workspace, channel, ts):
    key = f"{workspace}:{channel}:{ts}"
    h = int(hashlib.sha1(key.encode()).hexdigest()[: ID_BITS // 4], 16)
    return ID_BASE + h


def connect(path):
    if not os.path.exists(path):
        return None
    try:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
        con.row_factory = sqlite3.Row
        con.execute("SELECT 1 FROM messages LIMIT 1")
        return con
    except sqlite3.Error as err:
        print(f"slack: skipping {path}: {err}", file=sys.stderr)
        return None


def local_minute(ts):
    return datetime.fromtimestamp(float(ts)).strftime("%Y-%m-%dT%H:%M")


def loads(raw):
    try:
        val = json.loads(raw or "{}")
        return val if isinstance(val, dict) else {}
    except ValueError:
        return {}


def directory(con):
    """Users, channels and each workspace's own user id, from the store."""
    me = {}
    for r in con.execute("SELECT id, raw_json FROM workspaces"):
        uid = loads(r["raw_json"]).get("user_id")
        if uid:
            me[r["id"]] = uid
    users = {}
    for r in con.execute("SELECT id, name, real_name, display_name, is_bot, raw_json FROM users"):
        profile = loads(r["raw_json"]).get("profile") or {}
        name = (r["display_name"] or profile.get("display_name") or r["real_name"]
                or profile.get("real_name") or r["name"] or r["id"])
        users[r["id"]] = {"name": name, "email": profile.get("email") or None, "bot": bool(r["is_bot"])}
    channels = {}
    for r in con.execute("SELECT id, workspace_id, name, kind, raw_json FROM channels"):
        raw = loads(r["raw_json"])
        channels[r["id"]] = {"workspace": r["workspace_id"], "name": r["name"], "kind": r["kind"],
                             "user": raw.get("user"), "members": raw.get("members") or []}
    return me, users, channels


MENTION = re.compile(r"<([@#!])([^>|]+)(?:\|([^>]*))?>")
LINK = re.compile(r"<((?:https?|mailto):[^>|]+)(?:\|([^>]*))?>")


def plain(text, users):
    """Slack markup to what a person reads: <@U1> is @name, <url|label> is label."""
    def mention(m):
        sigil, target, label = m.groups()
        if sigil == "@":
            return "@" + (label or users.get(target, {}).get("name") or target)
        if sigil == "#":
            return "#" + (label or target)
        return "@" + (label or target.split("^")[0])
    text = MENTION.sub(mention, text or "")
    text = LINK.sub(lambda m: m.group(2) or m.group(1), text)
    return html.unescape(text).strip()


def person(uid, users):
    u = users.get(uid or "") or {}
    return u.get("name") or uid or "", u.get("email") or uid or ""


def group_dm_name(ch, me, users):
    names = [users.get(m, {}).get("name") or m for m in ch["members"] if m != me]
    return ", ".join(names) if names else ch["name"]


def read(days, limit, path=None):
    con = connect(path or SLACRAWL_DB)
    if not con:
        return [], []
    me, users, channels = directory(con)
    since = 0 if not days else datetime.now().timestamp() - days * 86400
    q = """SELECT channel_id, ts, workspace_id, user_id, subtype, text, raw_json
             FROM messages
            WHERE coalesce(deleted_ts, '') = '' AND ts NOT LIKE 'draft:%'
            ORDER BY ts"""
    out, n = [], 0
    for r in con.execute(q):
        try:
            ts = float(r["ts"])
        except ValueError:
            continue
        if ts < since:
            continue
        raw = loads(r["raw_json"])
        if r["subtype"] not in TALK_SUBTYPES or raw.get("hidden"):
            continue
        sender = r["user_id"] or raw.get("user") or ""
        if not sender or users.get(sender, {}).get("bot") or raw.get("bot_id"):
            continue
        n += 1
        ch = channels.get(r["channel_id"]) or {"workspace": r["workspace_id"], "name": r["channel_id"],
                                                "kind": "", "user": None, "members": []}
        mine = me.get(r["workspace_id"])
        from_me = bool(mine) and sender == mine
        text = plain(r["text"], users)
        if ch["kind"] in DM_KINDS:
            room = None
            other = ch["user"] or ("" if from_me else sender)
            who, handle = person(other, users)
            who, handle = who or r["channel_id"], handle or r["channel_id"]
        else:
            room = group_dm_name(ch, mine, users) if ch["kind"] in GROUP_DM_KINDS else ch["name"]
            if from_me:
                who, handle = room, r["channel_id"]
            else:
                who, handle = person(sender, users)
        out.append({
            "id": row_id(r["workspace_id"], r["channel_id"], r["ts"]),
            "at": local_minute(ts),
            "with": who,
            "room": room,
            "handle": handle,
            "from_me": from_me,
            "text": text,
            "reaction": False,
            "attachment_only": not text or bool(raw.get("files")),
            "source": "slack",
        })
    out.sort(key=lambda r: r["at"])
    if limit:
        out = out[-limit:]
    return out, [{"store": "slacrawl", "rows": n}]



def resolve(target, con):
    """What `target` names, from the local store only. No network.

    `lookup` names the API call still needed at send time, or says why the
    target cannot be used at all."""
    found = {"target": target, "workspace": None, "channel": None, "user": None, "lookup": None}
    if "@" in target:
        found["lookup"] = "users.lookupByEmail"
    elif target[:1] in "UW":
        found["user"], found["lookup"] = target, "conversations.open"
    elif target[:1] in "CGD":
        found["channel"] = target
    else:
        found["lookup"] = "unrecognized target"
        return found
    if not con:
        return found
    me, users, channels = directory(con)
    if found["channel"]:
        if target in channels:
            found["workspace"] = channels[target]["workspace"]
        return found
    if "@" in target:
        for uid, u in users.items():
            if (u["email"] or "").lower() == target.lower():
                found["user"], found["lookup"] = uid, "conversations.open"
                break
        else:
            return found
    uid = found["user"]
    row = con.execute("SELECT workspace_id FROM users WHERE id = ?", (uid,)).fetchone()
    if row:
        found["workspace"] = row["workspace_id"]
    for cid, ch in channels.items():
        if ch["kind"] in DM_KINDS and ch["user"] == uid:
            found["channel"], found["workspace"], found["lookup"] = cid, ch["workspace"], None
            break
    return found


def token_for(workspace):
    """The user token for this workspace, or the default one. Never echoed."""
    if workspace:
        tok = os.environ.get(f"{TOKEN_ENV}_{workspace}")
        if tok:
            return tok
    return os.environ.get(TOKEN_ENV) or ""


def call(method, token, **params):
    headers = {"Authorization": "Bearer " + token,
               "Content-Type": "application/x-www-form-urlencoded; charset=utf-8"}
    cookie = os.environ.get(COOKIE_ENV)
    if token.startswith("xoxc-") and cookie:
        headers["Cookie"] = "d=" + cookie
    body = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(API + method, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            reply = json.loads(resp.read().decode() or "{}")
    except (OSError, ValueError) as err:
        return {"ok": False, "error": f"{method}: {type(err).__name__}"}
    if not isinstance(reply, dict):
        return {"ok": False, "error": f"{method}: bad reply"}
    if not reply.get("ok"):
        return {"ok": False, "error": f"{method}: {reply.get('error') or 'failed'}"}
    return reply


SLACKCLI = os.environ.get("CHEWBACCA_SLACKCLI_BIN", "slackcli")


def send_slackcli(found, text):
    """Send through slackcli's saved session (shaharia-lab/slackcli, MIT).

    `slackcli auth login-auto` signs in once in a browser and keeps the
    session for every workspace on the account, so no Slack app or token is
    needed. It opens the DM itself when handed a user id.
    """
    to = found["channel"] or found["user"]
    if not to:
        return {"ok": False, "error": "no channel or user to send to"}
    args = [SLACKCLI, "messages", "send", "--recipient-id", to, "--message", text, "--json"]
    if found.get("workspace"):
        args += ["--workspace", found["workspace"]]
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as err:
        return {"ok": False, "error": f"slackcli: {type(err).__name__}"}
    if p.returncode != 0:
        tail = (p.stderr or p.stdout).strip().splitlines()
        return {"ok": False, "error": "slackcli: " + (tail[-1][:200] if tail else f"exit {p.returncode}")}
    try:
        j = json.loads(p.stdout[p.stdout.index("{"):])
    except ValueError:
        j = {}
    ts = j.get("ts") or (j.get("message") or {}).get("ts")
    channel = j.get("channel") or to
    return {"ok": True, "id": row_id(found.get("workspace") or "", channel, ts) if ts else None, "channel": channel}


def send(target, text, dry_run=False, path=None):
    if not text.strip():
        return {"ok": False, "error": "empty text"}
    con = connect(path or SLACRAWL_DB)
    found = resolve(target, con)
    if found["lookup"] == "unrecognized target":
        return {"ok": False, "error": "target must be an email, a U/W user id, or a C/G/D channel id"}
    if dry_run:
        return {"ok": True, "dry_run": True, "workspace": found["workspace"], "channel": found["channel"],
                "user": found["user"], "needs": found["lookup"], "text": text,
                "token": "present" if token_for(found["workspace"]) else "missing"}
    if os.environ.get("CHEWBACCA_NO_SEND"):
        return {"ok": False, "error": "sending is disabled (CHEWBACCA_NO_SEND)"}
    token = token_for(found["workspace"])
    if not token and shutil.which(SLACKCLI):
        return send_slackcli(found, text)
    if not token:
        return {"ok": False, "error": "Slack isn't signed in: run slackcli auth login-auto"}
    if found["lookup"] == "users.lookupByEmail":
        reply = call("users.lookupByEmail", token, email=target)
        if not reply["ok"]:
            return reply
        found["user"] = (reply.get("user") or {}).get("id")
        found["lookup"] = "conversations.open"
    channel = found["channel"]
    if not channel:
        reply = call("conversations.open", token, users=found["user"])
        if not reply["ok"]:
            return reply
        channel = (reply.get("channel") or {}).get("id")
    if not channel:
        return {"ok": False, "error": "could not open a conversation"}
    reply = call("chat.postMessage", token, channel=channel, text=text)
    if not reply["ok"]:
        return reply
    workspace = found["workspace"] or (reply.get("message") or {}).get("team")
    if not workspace:
        auth = call("auth.test", token)
        workspace = auth.get("team_id") if auth["ok"] else ""
    return {"ok": True, "id": row_id(workspace or "", reply.get("channel") or channel, reply.get("ts")),
            "channel": reply.get("channel") or channel}


def main():
    argv = sys.argv[1:]
    if argv[:1] == ["send"]:
        ap = argparse.ArgumentParser(prog="slack.py send", description="Send one Slack message as the user")
        ap.add_argument("--to", required=True, help="user email, user id, or channel id")
        ap.add_argument("--text", required=True)
        ap.add_argument("--dry-run", action="store_true", help="resolve and print, send nothing")
        a = ap.parse_args(argv[1:])
        result = send(a.to, a.text, a.dry_run)
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(0 if result.get("ok") else 1)
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--days", type=int, default=30, help="0 means all history")
    ap.add_argument("--limit", type=int, default=0, help="0 means no row cap")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--sources", action="store_true", help="print which stores were read")
    a = ap.parse_args(argv)
    rows, sources = read(a.days, a.limit)
    if a.sources:
        print(json.dumps(sources))
        return
    if a.json:
        json.dump(rows, sys.stdout, ensure_ascii=False)
        return
    for r in rows:
        arrow = "->" if r["from_me"] else "<-"
        print(f"{r['at']}  {r['with'][:20]:20} {arrow} {r['text'][:90]}")


if __name__ == "__main__":
    main()
