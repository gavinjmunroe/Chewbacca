#!/usr/bin/env python3
"""Bridged chats (Signal, Telegram, Discord, Instagram, Messenger, X, Google
Messages, Google Chat, Google Voice, LinkedIn, Bluesky) as rows in the shape
mac/lib/texts.py prints, read from the homeserver `chewbacca chat up` runs on
this Mac.

  matrix.py --json [--days N]                  rows for people texts sync
  matrix.py room --network signal --handle H   the room id a 1:1 thread lives in
  matrix.py send --to '!room:server' --text T [--dry-run]

The rows come from Caleb's own Matrix account on that homeserver (@me), which
every bridge invites into each portal room. The network is read off the room's
members, never off a name: each bridge's ghosts are `<network>_<id>` and its
bot is `<network>bot`, because `chewbacca chat up` writes exactly that
template into every bridge's config.

IDENTITY. A ghost's handle is the phone number the network itself verified
when the bridge exposes one (`com.beeper.bridge.identifiers`, tel:), else the
ghost's Matrix id. Never a display name: on Telegram and Discord the sender
picks it, so a stranger calling himself "Sagar" would otherwise be filed
under Sagar and `people send sagar` would reach him.

SENDING. Only to a room this account has joined and a reader run has seen
(rooms.json, written by the reader), and never with CHEWBACCA_NO_SEND set.
The homeserver must be loopback: the access token is never sent anywhere
else, whatever me.json says.
"""

import argparse, hashlib, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone
from ipaddress import ip_address

HOME = os.path.expanduser(os.environ.get("CHEWBACCA_MATRIX_DIR", "~/.chewbacca/matrix"))
SECRETS = os.path.join(HOME, "secrets", "me.json")
ROOMS = os.path.join(HOME, "rooms.json")

# Each app owns its own range in people.db's msg_id: iMessage ROWIDs, LinkedIn
# 1e10, WhatsApp 2e12, Slack 3e12, email 4e12 (whose 40 hash bits reach
# 5.1e12: 63 rows sat above 5e12 on 2026-10-10). Bridged chats start at 6e12,
# clear of all of them, and an event id is unique across every network.
ID_BASE = 6_000_000_000_000
ID_BITS = 40

# The networks the reader files rows under: the bridge ids in
# config/chat/networks.json. A room whose members match none is not a chat.
NETWORKS = ("signal", "telegram", "discord", "instagram", "messenger", "twitter",
            "gmessages", "googlechat", "gvoice", "linkedin", "bluesky")

# Per room, how far back one read pages. Guessed, never measured on a real
# account; a busy Discord group DM is the case that would hit it.
MAX_EVENTS_PER_ROOM = 2000
TIMEOUT = 20


def row_id(event_id):
    return ID_BASE + int(hashlib.sha1(event_id.encode()).hexdigest()[: ID_BITS // 4], 16)


def load_me():
    try:
        with open(SECRETS) as f:
            me = json.load(f)
    except (OSError, ValueError):
        return None
    if not me.get("access_token") or not me.get("user_id") or not loopback(me.get("homeserver", "")):
        return None
    return me


def loopback(url):
    try:
        host = urllib.parse.urlsplit(url).hostname or ""
    except ValueError:
        return False
    if host == "localhost":
        return True
    try:
        return ip_address(host).is_loopback
    except ValueError:
        return False


class Matrix:
    def __init__(self, me):
        self.base = me["homeserver"].rstrip("/")
        self.token = me["access_token"]
        self.user = me["user_id"]

    def call(self, method, path, body=None, query=None):
        url = self.base + "/_matrix/client/v3" + path
        if query:
            url += "?" + urllib.parse.urlencode(query)
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={
            "Authorization": "Bearer " + self.token, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            try:
                err = json.loads(e.read() or b"{}")
            except ValueError:
                err = {}
            raise RuntimeError(f"{method} {path.split('?')[0]}: {e.code} {err.get('errcode', '')}") from None

    def q(self, room):
        return urllib.parse.quote(room, safe="")


def localpart(mxid):
    return (mxid or "")[1:].split(":", 1)[0]


def network_of_member(mxid):
    """("signal", "ghost") for @signal_x, ("signal", "bot") for @signalbot."""
    lp = localpart(mxid)
    for net in NETWORKS:
        if lp == net + "bot":
            return net, "bot"
        if lp.startswith(net + "_"):
            return net, "ghost"
    return None, None


def phone_from(content):
    for ident in content.get("com.beeper.bridge.identifiers") or []:
        if isinstance(ident, str) and ident.startswith("tel:"):
            digits = re.sub(r"[^\d+]", "", ident[4:])
            if len(re.sub(r"\D", "", digits)) >= 8:
                return digits if digits.startswith("+") else "+" + digits
    return ""


def clean_name(v, limit=80):
    s = re.sub(r"[\x00-\x1f\x7f​-‏‪-‮⁦-⁩]", "", str(v or "")).strip()
    return s[:limit]


def describe(state, me_id):
    """What one room is: its network, whether it's a 1:1, its name, and who's
    in it. None for a room that isn't a bridged conversation (the management
    room with a bridge bot has a bot and no ghost)."""
    name, members, room_type = "", {}, ""
    for ev in state:
        t, c = ev.get("type"), ev.get("content") or {}
        if t == "m.room.name":
            name = clean_name(c.get("name"))
        elif t in ("m.bridge", "uk.half-shot.bridge"):
            room_type = room_type or str(c.get("com.beeper.room_type") or "")
        elif t == "m.room.member" and c.get("membership") in ("join", "invite"):
            members[ev.get("state_key")] = c
    nets = {}
    for mxid in members:
        net, role = network_of_member(mxid)
        if net and role == "ghost":
            nets.setdefault(net, []).append(mxid)
    if len(nets) != 1:
        return None  # no ghost: a management room; two networks: not a bridge portal
    net, ghosts = next(iter(nets.items()))
    # A 1:1: the bridge says so, or one ghost in a room with no name of its own.
    dm = room_type == "dm" or (room_type == "" and len(ghosts) == 1 and not name)
    people = {}
    for g in ghosts:
        c = members[g]
        people[g] = {"name": clean_name(c.get("displayname")) or localpart(g),
                     "handle": phone_from(c) or g}
    return {"network": net, "dm": dm, "name": name, "people": people}


def local_time(ms):
    return datetime.fromtimestamp(int(ms) / 1000).strftime("%Y-%m-%dT%H:%M:%S")


def words(content):
    """The text a message shows, or "" for an attachment."""
    if content.get("msgtype") in ("m.text", "m.notice", "m.emote"):
        return str(content.get("body") or "").strip()
    return ""


def read(days, client=None):
    me = load_me() if client is None else None
    if client is None:
        if not me:
            return [], {}
        client = Matrix(me)
    cutoff_ms = (time.time() - days * 86400) * 1000 if days else 0
    rows, rooms = [], {}
    for room in client.call("GET", "/joined_rooms").get("joined_rooms", []):
        try:
            state = client.call("GET", f"/rooms/{client.q(room)}/state")
        except RuntimeError:
            continue
        info = describe(state, client.user)
        if not info:
            continue
        net = info["network"]
        if info["dm"]:
            ghost = next(iter(info["people"].values()))
            rooms[f"{net}|{ghost['handle']}"] = room
            label, room_label = ghost["name"], None
        else:
            room_label = info["name"] or ", ".join(p["name"] for p in info["people"].values())[:60] or net + " group"
            rooms[f"{net}|{room}"] = room
            label = room_label
        token, seen = None, 0
        while seen < MAX_EVENTS_PER_ROOM:
            query = {"dir": "b", "limit": 100}
            if token:
                query["from"] = token
            page = client.call("GET", f"/rooms/{client.q(room)}/messages", query=query)
            chunk = page.get("chunk") or []
            if not chunk:
                break
            older = False
            for ev in chunk:
                seen += 1
                ts = ev.get("origin_server_ts") or 0
                if ts < cutoff_ms:
                    older = True
                    break
                if ev.get("type") != "m.room.message":
                    continue
                c = ev.get("content") or {}
                rel = (c.get("m.relates_to") or {}).get("rel_type")
                if rel == "m.replace":
                    continue  # an edit; the original row stands
                sender = ev.get("sender") or ""
                s_net, role = network_of_member(sender)
                if role == "bot":
                    continue  # bridge status lines are not the conversation
                from_me = sender == client.user
                text = words(c)
                if from_me:
                    who = label if info["dm"] else room_label
                    handle = (next(iter(info["people"].values()))["handle"] if info["dm"] else room)
                else:
                    p = info["people"].get(sender) or {"name": localpart(sender), "handle": sender}
                    who, handle = p["name"], p["handle"]
                rows.append({
                    "id": row_id(ev.get("event_id") or f"{room}{ts}"),
                    "at": local_time(ts),
                    "with": who,
                    "room": room_label,
                    "handle": handle,
                    "from_me": from_me,
                    "text": text,
                    "reaction": False,
                    "attachment_only": not text,
                    "source": net,
                })
            token = page.get("end")
            if older or not token:
                break
    rows.sort(key=lambda r: r["at"])
    return rows, rooms


def save_rooms(rooms):
    os.makedirs(HOME, mode=0o700, exist_ok=True)
    tmp = ROOMS + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(rooms, f, indent=1, sort_keys=True)
    os.replace(tmp, ROOMS)


def known_rooms():
    try:
        with open(ROOMS) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def room_for(network, handle):
    """The room a 1:1 (network|handle) or a group (network|!room) lives in."""
    rooms = known_rooms()
    if str(handle).startswith("!"):
        return handle if rooms.get(f"{network}|{handle}") == handle else None
    return rooms.get(f"{network}|{handle}")


def send(network, room, text, dry_run=False, client=None):
    """One message into one room. The room has to be one a reader run filed
    under this network; a room id typed by hand, or one from another network,
    is refused before anything leaves."""
    if not any(k.startswith(network + "|") and v == room for k, v in known_rooms().items()):
        return {"ok": False, "error": f"{room} is not a {network} room the reader has seen; run people texts sync"}
    if dry_run:
        return {"ok": True, "dry_run": True, "room": room, "network": network}
    if os.environ.get("CHEWBACCA_NO_SEND"):
        return {"ok": False, "error": "sending is disabled (CHEWBACCA_NO_SEND)"}
    if client is None:
        me = load_me()
        if not me:
            return {"ok": False, "error": "chewbacca chat is not set up (no account on the local homeserver)"}
        client = Matrix(me)
    joined = client.call("GET", "/joined_rooms").get("joined_rooms", [])
    if room not in joined:
        return {"ok": False, "error": f"not joined to {room}"}
    txn = "chewb" + hashlib.sha1(f"{room}{text}{time.time()}".encode()).hexdigest()[:16]
    out = client.call("PUT", f"/rooms/{client.q(room)}/send/m.room.message/{txn}",
                      {"msgtype": "m.text", "body": text})
    return {"ok": bool(out.get("event_id")), "event_id": out.get("event_id", "")}


def _chewbacca_verdicts():
    """tools/verdicts.py, the kit's verdict log, loaded by path so no module
    here can shadow it; None when it isn't there. `chewbacca why --verdicts`
    reads what it writes."""
    try:
        import importlib.util
        mod = sys.modules.get("chewbacca_verdicts")
        if mod is None:
            here = os.path.dirname(os.path.realpath(__file__))
            spec = importlib.util.spec_from_file_location(
                "chewbacca_verdicts", os.path.join(here, "../../tools", "verdicts.py"))
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            sys.modules["chewbacca_verdicts"] = mod
        return mod
    except Exception:
        return None


# One send row per call (sent, held by CHEWBACCA_NO_SEND, dry-run, failed).
if _chewbacca_verdicts():
    send = _chewbacca_verdicts().logged_send(
        "matrix send", send, who=lambda a, k: "%s %s" % (k.get("network", a[0] if a else ""),
                                                      k.get("room", a[1] if len(a) > 1 else "")))


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv and argv[0] == "room":
        ap = argparse.ArgumentParser(prog="matrix.py room")
        ap.add_argument("--network", required=True, choices=NETWORKS)
        ap.add_argument("--handle", required=True)
        a = ap.parse_args(argv[1:])
        r = room_for(a.network, a.handle)
        if not r:
            sys.exit(1)
        print(r)
        return
    if argv and argv[0] == "send":
        ap = argparse.ArgumentParser(prog="matrix.py send")
        ap.add_argument("--network", required=True, choices=NETWORKS)
        ap.add_argument("--to", required=True, help="the room id")
        ap.add_argument("--text", required=True)
        ap.add_argument("--dry-run", action="store_true")
        a = ap.parse_args(argv[1:])
        try:
            res = send(a.network, a.to, a.text, a.dry_run)
        except (RuntimeError, OSError) as e:
            res = {"ok": False, "error": str(e)}
        print(json.dumps(res))
        sys.exit(0 if res.get("ok") else 1)
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--days", type=int, default=30, help="0 means all history")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    try:
        rows, rooms = read(a.days)
    except (RuntimeError, OSError) as e:
        # The homeserver is down or not set up: no rows, and people texts sync
        # carries on with every other app.
        print(f"matrix: {e}", file=sys.stderr)
        rows, rooms = [], None
    if rooms is not None and load_me():
        save_rooms(rooms)
    if a.json:
        json.dump(rows, sys.stdout, ensure_ascii=False)
        return
    for r in rows:
        arrow = "->" if r["from_me"] else "<-"
        print(f"{r['at']}  [{r['source']}] {r['with'][:20]:20} {arrow} {r['text'][:90]}")


if __name__ == "__main__":
    main()
