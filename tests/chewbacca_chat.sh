#!/usr/bin/env bash
# chewbacca chat: bridged networks must land in the people store as one
# person per address and be answerable in the thread's own room, without a
# single message leaving. Everything runs against tests/fixtures/fake_matrix.py
# on 127.0.0.1, a temp people store and a temp ~/.chewbacca/matrix, with
# CHEWBACCA_NO_SEND=1 throughout. Synthetic data and a fake token only.
#
# Pinned:
# - rows come from ghosts and Caleb, never from the bridge bot, an edit, or the
#   bot's management room; an attachment is not a conversation line
# - a Signal ghost is filed under the person whose card has that full number,
#   never under someone sharing its display name (no merge on a name)
# - a Telegram sender called "Alice" is not filed under a saved Alice
# - a Google Messages SMS that chat.db already holds is dropped, not doubled
# - people send --via signal resolves to the thread's room on a dry run, and
#   a real attempt stops at CHEWBACCA_NO_SEND; the fake server logs no PUT
# - matrix.py refuses a room the reader never filed, and a non-loopback
#   homeserver in me.json reads nothing (the token never leaves the Mac)
# - the network lists in apps.js, matrix.py, ingest_chats.py and
#   config/chat/networks.json agree, and status lists every network
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
command -v node >/dev/null 2>&1 || { echo "chewbacca chat: skipped, node not installed"; exit 0; }
T="$(mktemp -d)"
SRV=""
cleanup() { [ -n "$SRV" ] && { kill "$SRV"; wait "$SRV"; } 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT
export CHEWBACCA_NO_SEND=1 PEOPLE_DIR="$T/people" CHEWBACCA_MATRIX_DIR="$T/matrix" HOME="$T/home"
mkdir -p "$PEOPLE_DIR" "$CHEWBACCA_MATRIX_DIR/secrets" "$HOME"
P="$ROOT/bin/people"
DB="$PEOPLE_DIR/people.db"
fail() { echo "FAIL: $1" >&2; [ -n "${out:-}" ] && printf '%s\n' "$out" | tail -6 >&2; exit 1; }

python3 "$ROOT/tests/fixtures/fake_matrix.py" "$T/port" "$T/sent.log" &
SRV=$!
for _ in $(seq 1 50); do [ -s "$T/port" ] && break; sleep 0.1; done
[ -s "$T/port" ] || fail "fake homeserver did not start"
PORT="$(cat "$T/port")"
printf '{"user_id":"@me:chewbacca.localhost","access_token":"fake-token-not-real","homeserver":"http://127.0.0.1:%s"}' "$PORT" \
  > "$CHEWBACCA_MATRIX_DIR/secrets/me.json"

# The store: a card with Sig Friend's full number, a second card that only
# shares the display name, a saved Alice with no Telegram identity, and the
# iMessage copy of the Android SMS.
"$P" add "Sig Friend Real" >/dev/null 2>&1
"$P" set "sig friend real" --phone "+15551230000" >/dev/null 2>&1
"$P" add "Sig Friend" >/dev/null 2>&1
"$P" add "Alice" >/dev/null 2>&1
id() { sqlite3 "$DB" "SELECT id FROM people WHERE name='$1'"; }
REAL="$(id 'Sig Friend Real')"; NAMESAKE="$(id 'Sig Friend')"; ALICE="$(id 'Alice')"
[ -n "$REAL" ] && [ -n "$NAMESAKE" ] || fail "could not set up people"
AT="$(python3 -c 'import time,datetime;print(datetime.datetime.fromtimestamp(time.time()-7200).strftime("%Y-%m-%d %H:%M:%S"))')"
sqlite3 "$DB" "INSERT INTO messages (msg_id, person_id, who, handle, from_me, body, sent_at, source)
  VALUES (777001, NULL, 'Android Pal', '+15559870000', 0, 'same sms twice', '$AT', 'imessage');"

# ── reader ──
out="$(python3 "$ROOT/mac/lib/matrix.py" --json --days 30 2>&1)" || fail "reader failed"
python3 - "$out" <<'PY' || fail "reader rows wrong"
import json, sys
rows = json.loads(sys.argv[1])
bodies = [r["text"] for r in rows if r["text"]]
assert "can you send me the deck tonight?" in bodies, bodies
for bad in ("too old to sync", "Successfully logged in", "* edited", "Scan the QR code"):
    assert bad not in bodies, bad
img = [r for r in rows if r["id"] and r["attachment_only"]]
assert img, "the image row should be marked attachment_only"
dm = [r for r in rows if r["text"] == "can you send me the deck tonight?"][0]
assert dm["source"] == "signal" and dm["handle"] == "+15551230000" and dm["room"] is None, dm
g = [r for r in rows if r["source"] == "telegram"]
assert {r["room"] for r in g} == {"Den Group"}, g
mine = [r for r in g if r["from_me"]][0]
assert mine["handle"] == "!grp:t", mine
assert all(r["id"] >= 6_000_000_000_000 for r in rows), "ids must sit in the bridged range"
PY
grep -q '"signal|+15551230000": "!dm:t"' "$CHEWBACCA_MATRIX_DIR/rooms.json" || fail "rooms.json did not record the 1:1 room"
[ "$(stat -f %Lp "$CHEWBACCA_MATRIX_DIR/rooms.json")" = "600" ] || fail "rooms.json is not 0600"

# ── ingest ──
out="$(node --no-warnings "$ROOT/tests/fixtures/matrix_sync.js" 2>&1)" || fail "sync failed"
[ "$(sqlite3 "$DB" "SELECT person_id FROM messages WHERE body='can you send me the deck tonight?'")" = "$REAL" ] ||
  fail "Signal row not filed under the card with that full number"
[ "$(sqlite3 "$DB" "SELECT count(*) FROM messages WHERE person_id='$NAMESAKE'")" = "0" ] ||
  fail "a row was filed under a card that only shares the display name"
[ "$(sqlite3 "$DB" "SELECT count(*) FROM messages WHERE person_id='$ALICE'")" = "0" ] ||
  fail "a Telegram sender named Alice was filed under the saved Alice"
[ "$(sqlite3 "$DB" "SELECT count(*) FROM messages WHERE body='same sms twice'")" = "1" ] ||
  fail "the SMS chat.db already had was ingested again from gmessages"
[ "$(sqlite3 "$DB" "SELECT count(*) FROM messages WHERE body='only on gmessages' AND source='gmessages'")" = "1" ] ||
  fail "a gmessages-only row was dropped"
out="$(node --no-warnings "$ROOT/tests/fixtures/matrix_sync.js" 2>&1)"
[ "$out" = "0" ] || fail "a second sync added rows again ($out)"
out="$("$P" texts "sig friend real" 2>&1)"
grep -q "\[signal\]" <<<"$out" || fail "the person's log does not mark the Signal line"

# ── send ──
out="$("$P" send "sig friend real" "running late" --dry-run 2>&1)" || fail "dry run failed"
grep -q "via signal, !dm:t" <<<"$out" || fail "dry run did not resolve to the Signal room"
out="$("$P" send "sig friend real" "running late" --via signal --dry-run 2>&1)" || fail "--via signal dry run failed"
grep -q "!dm:t" <<<"$out" || fail "--via signal did not resolve the room"
out="$("$P" send "sig friend real" "running late" 2>&1)" && fail "a send went through with CHEWBACCA_NO_SEND set"
grep -q "CHEWBACCA_NO_SEND" <<<"$out" || fail "the send did not stop at CHEWBACCA_NO_SEND"
out="$("$P" send --room "Den Group" "friday works" --via telegram --dry-run 2>&1)" || fail "group dry run failed"
grep -q "group via telegram, !grp:t" <<<"$out" || fail "group dry run did not resolve the Telegram room"
out="$("$P" send "sig friend real" "x" --via fax 2>&1)" && fail "an unknown --via was accepted"
out="$("$P" texts owed --via signal 2>&1)" || fail "owed --via signal failed"
grep -q "can you send me the deck tonight" <<<"$out" || fail "a Signal question is not listed as owed"

out="$(python3 "$ROOT/mac/lib/matrix.py" send --network signal --to '!other:t' --text x --dry-run 2>&1)" &&
  fail "matrix.py accepted a room the reader never filed"
out="$(python3 "$ROOT/mac/lib/matrix.py" send --network telegram --to '!dm:t' --text x --dry-run 2>&1)" &&
  fail "matrix.py accepted a Signal room as a Telegram one"
out="$(python3 "$ROOT/mac/lib/matrix.py" send --network signal --to '!dm:t' --text x 2>&1)" &&
  fail "matrix.py sent with CHEWBACCA_NO_SEND set"
[ ! -s "$T/sent.log" ] || fail "the homeserver received a send: $(cat "$T/sent.log")"

# A homeserver that isn't this Mac never gets the token.
printf '{"user_id":"@me:x","access_token":"fake-token-not-real","homeserver":"http://example.com:%s"}' "$PORT" \
  > "$CHEWBACCA_MATRIX_DIR/secrets/me.json"
out="$(python3 "$ROOT/mac/lib/matrix.py" --json 2>&1)"
[ "$out" = "[]" ] || fail "a non-loopback homeserver was read"

# ── HUD graph ──
out="$(cd "$ROOT/bin/lib" && python3 - <<'PY' 2>&1
import os, sys, tempfile
from datetime import datetime
sys.path.insert(0, ".")
import osgraph, osgraph_ingest, osgraph_walks
class Ctx:
    env = os.environ
    home = __import__("pathlib").Path(os.environ["HOME"])
    def now(self): return datetime.now().astimezone()
g = osgraph.Graph(os.path.join(tempfile.mkdtemp(), "g.db"))
rep = osgraph_ingest.ingest_all(g, Ctx(), only=["chats"])
assert "error" not in rep["chats"], rep
rows = osgraph_walks.needs_you(g, Ctx().now())["rows"]
labels = [r.get("label") or r.get("title") or str(r) for r in rows]
assert any("Sig Friend Real" in str(r) for r in rows), labels
print("ok")
PY
)"
[ "$(printf '%s' "$out" | tail -1)" = "ok" ] || fail "the Signal question is not on needs-you"

# ── calls ──
# A call is filed on the card that owns the whole number, once; a number
# nobody owns is counted and skipped.
export CHEWBACCA_CALLS_DB="$T/CallHistory.storedata"
NOWAPPLE="$(python3 -c 'import time;print(time.time()-978307200-3600)')"
sqlite3 "$CHEWBACCA_CALLS_DB" "CREATE TABLE ZCALLRECORD (ZUNIQUE_ID VARCHAR, ZADDRESS VARCHAR, ZDATE TIMESTAMP,
  ZDURATION FLOAT, ZORIGINATED INTEGER, ZANSWERED INTEGER, ZCALLTYPE INTEGER);
  INSERT INTO ZCALLRECORD VALUES ('U1', '+15551230000', $NOWAPPLE, 245, 1, 1, 1),
                                 ('U2', '+15550009999', $NOWAPPLE, 0, 0, 0, 1),
                                 ('U3', '+15551230000', $NOWAPPLE, 0, 0, 0, 16);"
out="$("$P" calls sync --days 0 2>&1)" || fail "calls sync failed"
grep -q "1 from numbers nobody" <<<"$out" || fail "an unowned number was not counted as skipped"
[ "$(sqlite3 "$DB" "SELECT count(*) FROM interactions WHERE id LIKE 'call:%' AND person_id='$REAL'")" = "2" ] ||
  fail "calls were not filed on the card that owns the number"
"$P" calls sync --days 0 >/dev/null 2>&1
[ "$(sqlite3 "$DB" "SELECT count(*) FROM interactions WHERE id LIKE 'call:%'")" = "2" ] || fail "a second calls sync filed calls twice"
out="$("$P" calls "sig friend real" 2>&1)"
grep -q "outgoing phone call, 4 min" <<<"$out" || fail "the person's calls do not read back"
grep -q "missed facetime audio call" <<<"$out" || fail "a missed FaceTime call does not read back"

# ── registry ──
out="$(python3 - "$ROOT" <<'PY' 2>&1
import json, re, sys
root = sys.argv[1]
reg = json.load(open(f"{root}/config/chat/networks.json"))
bridged = [n["id"] for n in reg["networks"] if n["kind"] == "bridge"]
apps = re.search(r"const BRIDGED = \[(.*?)\];", open(f"{root}/bin/lib/people/apps.js").read(), re.S).group(1)
apps = re.findall(r'"([a-z]+)"', apps)
mx = re.findall(r'"([a-z]+)"', re.search(r"NETWORKS = \((.*?)\)", open(f"{root}/mac/lib/matrix.py").read(), re.S).group(1))
ic = re.findall(r'"([a-z]+)"', re.search(r"BRIDGED = \((.*?)\)", open(f"{root}/bin/lib/ingest_chats.py").read(), re.S).group(1))
assert sorted(bridged) == sorted(apps) == sorted(mx) == sorted(ic), (bridged, apps, mx, ic)
need = {"imessage", "whatsapp", "slack", "email", "signal", "telegram", "discord", "instagram", "messenger",
        "twitter", "gmessages", "googlechat", "gvoice", "linkedin", "groupme", "teams", "snapchat", "sms",
        "calls", "school", "bluesky", "line", "wechat"}
ids = {n["id"] for n in reg["networks"]}
assert need <= ids, need - ids
for n in reg["networks"]:
    assert n.get("verdict") and n.get("link"), n["id"]
    if n["kind"] == "bridge":
        assert re.search(r":v\d", n["image"]) and n["license"], n["id"]
print("ok")
PY
)"
[ "$out" = "ok" ] || fail "network lists disagree: $out"

out="$(CHEWBACCA_DOCKER=/usr/bin/false python3 "$ROOT/bin/chewbacca-chat" status --json 2>&1)" || fail "status failed"
python3 - "$out" <<'PY' || fail "status --json is missing networks or leaks a token"
import json, sys
s = json.loads(sys.argv[1])
assert len(s["networks"]) >= 23, len(s["networks"])
assert "fake-token-not-real" not in sys.argv[1]
sig = [n for n in s["networks"] if n["network"] == "signal"][0]
assert sig["running"] == "docker not running", sig
PY
grep -q "127.0.0.1:" <<<"$(python3 - "$ROOT" <<'PY'
import importlib.machinery, sys
m = importlib.machinery.SourceFileLoader("chat", sys.argv[1] + "/bin/chewbacca-chat").load_module()
print(open(m.compose_file([m.bridge("signal")])).read())
PY
)" || fail "the compose file does not bind the homeserver to 127.0.0.1"
exit 0
