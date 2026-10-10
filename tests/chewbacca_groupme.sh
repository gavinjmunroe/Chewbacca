#!/bin/bash
# chewbacca groupme must read GroupMe through the user's own web.groupme.com
# tab and never let the access token out of the page: the real in-page script
# runs here under node against a mock page (location, localStorage, fetch), so
# the GET-only, fixed-origin, origin-guard and token-scrub checks are executed,
# not grepped. Responses parse into the fields each command promises, messages
# page with before_id, calls sit at least 1 s apart, and the first 401, 429 or
# sign-in redirect stops the command with no retry. Synthetic data only.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
if ! command -v node >/dev/null 2>&1; then echo "chewbacca groupme: skipped, node not installed"; exit 0; fi
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
no() { echo "FAIL: $*"; fail=1; }
GM="${GM_BIN:-$ROOT/bin/chewbacca-groupme}"
TOKEN="fakeTOKENsyntheticNOTREAL0123456789abcd"

# The page. Runs one script with window state carried in state.json, the way
# a real tab keeps window.__chewGm between chrome-js calls.
cat > "$T/page.js" <<'JS'
const fs = require('fs'), cp = require('child_process');
const [script, stateFile] = process.argv.slice(2);
const d = process.env.FAKE_DIR;
globalThis.window = globalThis;
try { window.__chewGm = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (e) {}
globalThis.location = { origin: process.env.FAKE_ORIGIN || 'https://web.groupme.com', href: process.env.FAKE_PAGE };
const tok = process.env.FAKE_TOKEN;
globalThis.localStorage = { getItem: k => (k === 'access_token' && tok) ? tok : null };
globalThis.fetch = async (url, opts) => {
  fs.appendFileSync(d + '/fetch.log', JSON.stringify({url, method: opts.method,
    hasToken: (opts.headers || {})['X-Access-Token'] === tok}) + '\n');
  const r = JSON.parse(cp.execFileSync('python3', [d + '/api.py', url]).toString());
  return { status: r.status, url: r.url || url, redirected: !!r.url, text: async () => r.body };
};
// eval on purpose: this runs the exact in-page script chrome-js would, from a
// file this test generated, inside a throwaway mock page.
const out = eval(fs.readFileSync(script, 'utf8'));
setTimeout(() => {
  fs.writeFileSync(stateFile, JSON.stringify(window.__chewGm || {}));
  process.stdout.write(String(out));
}, 20);
JS

# The API. Synthetic groups and DMs; group 101 holds 250 messages, one a day.
cat > "$T/api.py" <<'PY'
import json, os, sys, time, urllib.parse
d, tok = os.environ["FAKE_DIR"], os.environ.get("FAKE_TOKEN", "")
sp = urllib.parse.urlsplit(sys.argv[1]); q = dict(urllib.parse.parse_qsl(sp.query))
path = sp.path[len("/v3"):]
with open(os.path.join(d, "calls.log"), "a") as f:
    f.write(f"{time.monotonic()} {path}?{sp.query}\n")
status = int(os.environ.get("FAKE_STATUS", "200"))
BASE = 1760000000
def msg(i, gid="101"):
    return {"id": str(i), "group_id": gid, "name": "Tommy Trojan" if i % 2 else "Ada Lovelace",
            "created_at": BASE - (2000 - i) * 86400, "text": f"note {i}" + (" midterm review" if i % 50 == 0 else ""),
            "attachments": [{"type": "image", "url": f"https://i.groupme.com/{i}.png"}, {"type": "mentions", "user_ids": ["1"]}]
                           + ([{"type": "location", "lat": "34.02", "lng": "-118.28", "name": "Leavey"}] if i == 2000 else []),
            "favorited_by": ["1", "2"] if i == 2000 else []} if gid != "202" or i != 5 else {
            "id": "5", "created_at": BASE, "name": "\x1b[2JMallory", "attachments": [], "favorited_by": [],
            "text": "\x1b[31mred\x1b[0m \x1b]8;;https://evil.example\x07click\x1b]8;;\x07 safe\roverwrite \u202egnp.exe \x9bc1"}
if path == "/groups":
    body = [{"id": "101", "name": "Study Group A", "members_count": 42, "members": [],
             "description": "token " + tok,
             "messages": {"last_message_created_at": BASE, "preview": {"nickname": "Tommy Trojan", "text": "see you there"}}},
            {"id": "202", "name": "Study Group B", "members_count": 7,
             "messages": {"last_message_created_at": BASE - 99999, "preview": {"nickname": "Ada Lovelace", "text": "", "attachments": [{"type": "image"}]}}}
           ] if q.get("page") == "1" else []
elif path.startswith("/groups/") and path.endswith("/messages"):
    gid = path.split("/")[2]
    ids = list(range(2000, 1750, -1)) if gid == "101" else [5, 4]
    before = int(q.get("before_id") or 10**9)
    page = [msg(i, gid) for i in ids if i < before][: int(q.get("limit", 20))]
    body = {"count": len(ids), "messages": page}
    if not page:
        status = 304
elif path == "/chats":
    body = [{"other_user": {"id": "555", "name": "Tommy Trojan"}, "messages_count": 3, "updated_at": BASE,
             "last_message": {"name": "Tommy Trojan", "text": "lunch friday", "created_at": BASE}}] if q.get("page") == "1" else []
elif path == "/direct_messages":
    assert q.get("other_user_id") == "555", q
    before = int(q.get("before_id") or 10**9)
    body = {"count": 3, "direct_messages": [msg(i) for i in (3, 2, 1) if i < before][: int(q.get("limit", 20))]}
else:
    body = None; status = 404
print(json.dumps({"status": status, "url": os.environ.get("FAKE_URL", ""),
                  "body": json.dumps({"response": body, "meta": {"code": status}})}))
PY

cat > "$T/chrome-js" <<'PY'
#!/usr/bin/env python3
# Fake chrome-js. --list prints the tabs; anything else runs the real script
# in page.js and logs what came back.
import os, subprocess, sys
d = os.environ["FAKE_DIR"]
args = sys.argv[1:]
assert args[0] == "--real", "chewbacca groupme must target the real Chrome"
tabs = os.environ.get("FAKE_TABS", "https://web.groupme.com/chats").split("|")
if "--list" in args:
    print("\n".join(tabs)); sys.exit(0)
if "--open" in args:
    with open(os.path.join(d, "open.log"), "a") as f:
        f.write(args[args.index("--open") + 1] + "\n")
    sys.exit(0)
# Only exact targeting is accepted: a substring --match is what let a decoy in.
assert "--url" in args and "--match" not in args, "tab must be targeted by exact --url"
target = args[args.index("--url") + 1]
if target not in tabs:
    print("NO_TAB_MATCHING: " + target); sys.exit(0)
with open(os.path.join(d, "targets.log"), "a") as f:
    f.write(target + "\n")
src = args[args.index("--file") + 1]
out = subprocess.run(["node", os.path.join(d, "page.js"), src, os.path.join(d, "state.json")],
                     capture_output=True, text=True, env={**os.environ, "FAKE_PAGE": target})
with open(os.path.join(d, "returned.log"), "a") as f:
    f.write(out.stdout + out.stderr + "\n")
print(out.stdout)
PY
chmod +x "$T/chrome-js"

export FAKE_DIR="$T" FAKE_TOKEN="$TOKEN" CHEWBACCA_CHROME_JS="$T/chrome-js" CHEWBACCA_GROUPME_POLL=0.01 \
       CHEWBACCA_CHROME_DIR="$T/no-chrome"
gm() { : > "$T/calls.log"; : > "$T/fetch.log"; python3 "$GM" "$@"; }
calls() { grep -c . "$T/calls.log"; }

# The verb is wired.
bash "$ROOT/bin/chewbacca" groupme help 2>&1 | grep -q "no server-side search" || no "chewbacca groupme help is not wired or lost the search note"

out="$(gm groups --json 2>&1)"
printf '%s' "$out" | python3 -c '
import json,sys; d=json.load(sys.stdin)
assert [r["id"] for r in d] == ["101","202"], d
assert d[0]["members"] == 42 and d[0]["preview"] == "Tommy Trojan: see you there" and d[0]["last_message"], d[0]
assert d[1]["preview"] == "Ada Lovelace: [attachment]", d[1]' || no "groups did not parse: $out"
grep -q '"hasToken":true' "$T/fetch.log" || no "the in-page fetch did not carry X-Access-Token"

# Paging: 230 messages is three pages, chained on before_id, 1 s apart.
out="$(gm messages "study group a" --limit 230 --json 2>&1)"
printf '%s' "$out" | python3 -c '
import json,sys; d=json.load(sys.stdin)
assert len(d) == 230 and [m["id"] for m in d] == [str(i) for i in range(2000, 1770, -1)], len(d)
m = d[0]
assert m["sender"] == "Ada Lovelace" and m["text"] == "note 2000 midterm review" and m["likes"] == 2, m
assert m["attachments"] == ["https://i.groupme.com/2000.png", "https://maps.google.com/?q=34.02,-118.28"], m' \
  || no "messages did not page or parse: $(printf '%s' "$out" | head -c 300)"
[ "$(calls)" = 4 ] || no "messages --limit 230 made $(calls) calls, want 4 (groups + 3 pages)"
grep -q "before_id=1901" "$T/calls.log" && grep -q "before_id=1801" "$T/calls.log" || no "messages did not page with before_id"
awk 'NR>1 && $1-a < 1.0 {bad=1} {a=$1} END{exit bad}' "$T/calls.log" || no "API calls inside one command were under 1 s apart"

# --since stops paging at the first older message.
out="$(gm messages 101 --since "$(python3 -c 'import time; print(time.strftime("%Y-%m-%d", time.localtime(1760000000 - 9*86400)))')" --json 2>&1)"
printf '%s' "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert 9 <= len(d) <= 10, len(d)' || no "--since did not cut off: $out"

out="$(gm dms --json 2>&1)"
printf '%s' "$out" | python3 -c '
import json,sys; d=json.load(sys.stdin)
assert d == [{"person":"Tommy Trojan","user_id":"555","messages":3,"last_message":d[0]["last_message"],"preview":"Tommy Trojan: lunch friday"}], d' \
  || no "dms did not parse: $out"

out="$(gm dm tommy --limit 2 --json 2>&1)"
printf '%s' "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert [m["id"] for m in d] == ["3","2"], d' \
  || no "dm did not resolve the person or page: $out"

out="$(gm search midterm --group 101 --limit 250 --json 2>&1)"
printf '%s' "$out" | python3 -c '
import json,sys; d=json.load(sys.stdin)
assert [m["id"] for m in d] == ["2000","1950","1900","1850","1800"] and d[0]["group"] == "Study Group A", d' \
  || no "search did not filter client-side: $(printf '%s' "$out" | head -c 300)"

# Text from other people reaches plain output with no terminal controls: no
# ANSI color, OSC 8 link, BEL, CR overwrite, C1 byte or bidi override. --json
# keeps the raw text, escaped.
gm messages 202 > "$T/plain.out" 2>&1
python3 - "$T/plain.out" <<'PY2' || no "a terminal control sequence reached plain output"
import re, sys
out = open(sys.argv[1], encoding="utf-8", newline="").read()
assert "red" in out and "overwrite" in out and "Mallory" in out, out
assert not re.search("[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]", out), repr(out)
PY2
gm messages 202 --json | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d[0]["text"].startswith("\x1b[31m") and "\r" in d[0]["text"], d' \
  || no "--json no longer carries the raw text"

# GET only, and only to the fixed API origin, across every command above.
python3 - "$T/fetch.log" <<'PY' || no "a request was not a GET to https://api.groupme.com/v3"
import json, sys
for line in open(sys.argv[1]):
    r = json.loads(line)
    assert r["method"] == "GET" and r["url"].startswith("https://api.groupme.com/v3/"), r
PY

# The token never leaves the page: not in what the page returns, not in output.
cat "$T/returned.log" > "$T/all.out"; for c in groups dms; do gm $c --json >> "$T/all.out" 2>&1; done
grep -q "$TOKEN" "$T/all.out" && no "the access token left the page"
grep -q "token \[redacted\]" "$T/returned.log" || no "a token echoed in a response body was not scrubbed in the page"

# The in-page script refuses a path outside the read paths, before any fetch.
: > "$T/fetch.log"
python3 - "$GM" "$T/bad.js" <<'PY'
import sys, types, json
m = types.ModuleType("gm"); m.__dict__["__file__"] = sys.argv[1]
exec(open(sys.argv[1]).read().replace('if __name__ == "__main__"', 'if False'), m.__dict__)
open(sys.argv[2], "w").write(m.START_JS % {"guard": m.GUARD, "api": json.dumps(m.API),
    "path": json.dumps("/groups/101/messages/2000/like"), "key": json.dumps("x"),
    "read": json.dumps(m.READ)})
PY
out="$(FAKE_PAGE=https://web.groupme.com/chats node "$T/page.js" "$T/bad.js" "$T/bad-state.json" 2>&1)"
printf '%s' "$out" | grep -q "refused" && [ ! -s "$T/fetch.log" ] || no "the in-page script fetched a non-read path: $out"

# Pushback stops on the first answer, with no retry and no second call.
for case in "FAKE_STATUS=401" "FAKE_STATUS=429" "FAKE_URL=https://web.groupme.com/signin" \
            "FAKE_URL=https://login.microsoftonline.com/common/oauth2/authorize"; do
  : > "$T/calls.log"
  out="$(env "$case" python3 "$GM" messages 101 --limit 5 2>&1)"; rc=$?
  [ "$rc" = 4 ] || no "$case: exit $rc, want 4: $out"
  printf '%s' "$out" | grep -q "STOPPED" || no "$case: no STOPPED line: $out"
  [ "$(calls)" = 1 ] || no "$case: made $(calls) calls after pushback, want 1"
done
# Signed out (no token in the page): stopped before any request.
out="$(FAKE_TOKEN= gm groups 2>&1)"; rc=$?
[ "$rc" = 4 ] && [ ! -s "$T/fetch.log" ] || no "a signed-out page was not stopped before fetching (rc $rc)"
# A tab already on the sign-in page is refused before any call.
out="$(FAKE_TABS=https://web.groupme.com/signin gm groups 2>&1)"; rc=$?
[ "$rc" = 4 ] && [ "$(calls)" = 0 ] || no "a /signin tab was not refused before calling (rc $rc, $(calls) calls)"

# Decoy tabs. Only https with a host of exactly web.groupme.com counts; GroupMe
# in a query, path, lookalike host, userinfo or port is a decoy, and no script
# may run in it. With no real tab, the real one is opened at /chats.
for decoy in "https://evil.example/?next=web.groupme.com" "https://evil.example/web.groupme.com/chats" \
             "https://web.groupme.com.evil.example/chats" "https://evilweb.groupme.com/chats" \
             "http://web.groupme.com/chats" "https://web.groupme.com@evil.example/chats" \
             "https://web.groupme.com:8443/chats"; do
  : > "$T/targets.log"; : > "$T/open.log"
  out="$(FAKE_TABS="$decoy" gm groups 2>&1)"; rc=$?
  [ "$rc" != 0 ] || no "decoy tab $decoy was accepted"
  [ -s "$T/targets.log" ] && no "a script ran in decoy tab $decoy"
  [ "$(cat "$T/open.log")" = "https://web.groupme.com/chats" ] || no "with only decoy $decoy, GroupMe web was not opened at /chats"
done
: > "$T/targets.log"
FAKE_TABS="https://evil.example/?web.groupme.com|https://web.groupme.com/chats" gm groups >/dev/null 2>&1 \
  || no "the real GroupMe tab behind a decoy was not used"
grep -qv '^https://web.groupme.com/chats$' "$T/targets.log" && no "a script was sent to a tab other than the exact GroupMe one"

# The page reports a different origin: the in-page guard fetches nothing, and
# the Python side refuses the answer.
out="$(FAKE_ORIGIN=https://evil.example gm groups 2>&1)"; rc=$?
[ "$rc" = 5 ] || no "an answer from origin https://evil.example was accepted (rc $rc): $out"
[ -s "$T/fetch.log" ] && no "the in-page script fetched from a page whose origin is not web.groupme.com"

grep -q 'PAUSE = max(1.0' "$GM" || no "the 1 s throttle floor is gone"

[ "$fail" -eq 0 ] && echo "chewbacca groupme: ok"
exit "$fail"
