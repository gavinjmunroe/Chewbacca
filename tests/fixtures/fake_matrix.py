#!/usr/bin/env python3
"""A stand-in Matrix homeserver for tests/chewbacca_chat.sh: the four client
API calls mac/lib/matrix.py makes, over rooms built from synthetic data.

  fake_matrix.py <port file> <send log>

Binds 127.0.0.1 on a free port, writes the port to <port file>, and appends
every send attempt to <send log>, so the test can prove nothing was sent.
"""
import json, sys, time, urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

D = "chewbacca.localhost"
ME = f"@me:{D}"
NOW = int(time.time() * 1000)
H = 3600 * 1000


def member(uid, name=None, extra=None):
    c = {"membership": "join", "displayname": name or uid}
    c.update(extra or {})
    return {"type": "m.room.member", "state_key": uid, "content": c}


def msg(eid, sender, body, ago, msgtype="m.text", extra=None):
    c = {"msgtype": msgtype, "body": body}
    c.update(extra or {})
    return {"type": "m.room.message", "event_id": eid, "sender": sender, "origin_server_ts": NOW - ago, "content": c}


ROOMS = {
    # A Signal 1:1. The ghost's number comes from the bridge's identifiers.
    "!dm:t": {
        "state": [member(ME), member(f"@signalbot:{D}", "Signal bridge bot"),
                  member(f"@signal_aaa:{D}", "Sig Friend", {"com.beeper.bridge.identifiers": ["tel:+15551230000"]}),
                  {"type": "m.bridge", "state_key": "x", "content": {"com.beeper.room_type": "dm"}}],
        "events": [
            msg("$old", f"@signal_aaa:{D}", "too old to sync", 400 * 24 * H),
            msg("$q", f"@signal_aaa:{D}", "can you send me the deck tonight?", 1 * H),
            msg("$img", f"@signal_aaa:{D}", "photo.jpg", int(0.9 * H), "m.image"),
            msg("$bot", f"@signalbot:{D}", "Successfully logged in", int(0.8 * H), "m.notice"),
            msg("$edit", f"@signal_aaa:{D}", "* edited", int(0.7 * H), extra={"m.relates_to": {"rel_type": "m.replace"}}),
        ],
    },
    # A Telegram group, two ghosts. "Alice" is a name the sender chose.
    "!grp:t": {
        "state": [member(ME), member(f"@telegram_1:{D}", "Alice"), member(f"@telegram_2:{D}", "Bob"),
                  {"type": "m.room.name", "state_key": "", "content": {"name": "Den Group"}}],
        "events": [msg("$g1", f"@telegram_1:{D}", "who's in for friday", 3 * H),
                   msg("$g2", ME, "me", 2 * H),
                   msg("$g3", f"@telegram_2:{D}", "same", int(1.5 * H))],
    },
    # The bridge bot's management room: no ghost, so no conversation.
    "!mgmt:t": {
        "state": [member(ME), member(f"@signalbot:{D}")],
        "events": [msg("$m1", f"@signalbot:{D}", "Scan the QR code", H)],
    },
    # A Google Messages 1:1 whose only message is an SMS chat.db already has.
    "!gm:t": {
        "state": [member(ME), member(f"@gmessages_z:{D}", "Android Pal", {"com.beeper.bridge.identifiers": ["tel:+15559870000"]})],
        "events": [msg("$sms", f"@gmessages_z:{D}", "same sms twice", 2 * H),
                   msg("$sms2", f"@gmessages_z:{D}", "only on gmessages", int(1.9 * H))],
    },
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def reply(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authed(self):
        if self.headers.get("Authorization") != "Bearer fake-token-not-real":
            self.reply({"errcode": "M_UNKNOWN_TOKEN"}, 401)
            return False
        return True

    def do_GET(self):
        if not self.authed():
            return
        path = urllib.parse.urlsplit(self.path).path
        base = "/_matrix/client/v3"
        if path == base + "/joined_rooms":
            return self.reply({"joined_rooms": list(ROOMS)})
        parts = path[len(base):].split("/")
        if len(parts) == 4 and parts[1] == "rooms":
            room = urllib.parse.unquote(parts[2])
            if room not in ROOMS:
                return self.reply({"errcode": "M_FORBIDDEN"}, 403)
            if parts[3] == "state":
                return self.reply(ROOMS[room]["state"])
            if parts[3] == "messages":
                evs = sorted(ROOMS[room]["events"], key=lambda e: -e["origin_server_ts"])
                return self.reply({"chunk": evs})
        self.reply({"errcode": "M_UNRECOGNIZED"}, 404)

    def do_PUT(self):
        if not self.authed():
            return
        with open(sys.argv[2], "a") as f:
            f.write(self.path + "\n")
        self.reply({"event_id": "$sent"})


srv = HTTPServer(("127.0.0.1", 0), Handler)
with open(sys.argv[1], "w") as f:
    f.write(str(srv.server_address[1]))
srv.serve_forever()
