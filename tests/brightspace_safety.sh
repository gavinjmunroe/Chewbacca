#!/bin/bash
# What a hostile or careless Brightspace response must never do to a student
# (security review, 2026-10-28): carry their session cookie to another host on
# a redirect, or put terminal escape sequences from course text on their screen.
# No pipefail: `printf | grep -q` fails at random under it when grep quits before printf finishes.
set -u
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0; ok() { echo "  ok   $1"; }; no() { echo "  FAIL $1"; fail=1; }
PY=/usr/bin/python3
export HOME="$T/home" BRIGHTSPACE_STATE="$T/state" BRIGHTSPACE_DELAY=0,0 CHEWBACCA_NO_OPEN=1
unset BRIGHTSPACE_FIXTURE
mkdir -p "$HOME"

# Two local servers on two host names: 127.0.0.1 redirects, localhost records
# the Cookie header it was sent. Same-host redirects keep the cookie.
out="$($PY - "$ROOT/bin/brightspace-sync" <<'PY' 2>&1
import http.server, importlib.machinery, importlib.util, sys, threading
seen = {}
class Far(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        seen[self.path] = self.headers.get("Cookie")
        self.send_response(200); self.end_headers(); self.wfile.write(b"ok")
    def log_message(self, *a): pass
far = http.server.HTTPServer(("127.0.0.1", 0), Far)
fport = far.server_address[1]
class Near(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        to = f"http://localhost:{fport}/stolen" if self.path == "/away" else f"http://127.0.0.1:{self.server.server_address[1]}/home"
        if self.path == "/home":
            seen["/home"] = self.headers.get("Cookie")
            self.send_response(200); self.end_headers(); self.wfile.write(b"ok"); return
        self.send_response(302); self.send_header("Location", to); self.end_headers()
    def log_message(self, *a): pass
near = http.server.HTTPServer(("127.0.0.1", 0), Near)
for s in (far, near):
    threading.Thread(target=s.serve_forever, daemon=True).start()
l = importlib.machinery.SourceFileLoader("bss", sys.argv[1])
m = importlib.util.module_from_spec(importlib.util.spec_from_loader("bss", l)); l.exec_module(m)
c = object.__new__(m.Client); c.fixture = None; c.cookie = "d2lSessionVal=secret"; c.last = 0.0
base = f"http://127.0.0.1:{near.server_address[1]}"
c.open(base + "/away").read(); c.open(base + "/stay").read()
print("away", seen.get("/stolen")); print("stay", seen.get("/home"))
PY
)"
printf '%s' "$out" | grep -qx "away None" && ok "a redirect to another host gets no session cookie" || no "cross-host redirect: $out"
printf '%s' "$out" | grep -qx "stay d2lSessionVal=secret" && ok "a same-host redirect still carries the session" || no "same-host redirect: $out"

# The redirect rule itself, for what local http servers can't show: a downgrade
# to http, another port, and the real host staying on https.
out="$($PY - "$ROOT/bin/brightspace-sync" <<'PY' 2>&1
import importlib.machinery, importlib.util, sys, urllib.request
l = importlib.machinery.SourceFileLoader("bss", sys.argv[1])
m = importlib.util.module_from_spec(importlib.util.spec_from_loader("bss", l)); l.exec_module(m)
h = m.SameHostCookies()
for to in ("http://brightspace.usc.edu/x", "https://brightspace.usc.edu:8443/x", "https://brightspace.usc.edu/x"):
    req = urllib.request.Request("https://brightspace.usc.edu/d2l/api/f", headers={"Cookie": "s=1"})
    new = h.redirect_request(req, None, 302, "Found", {}, to)
    print(to, "cookie" if new.has_header("Cookie") else "none")
PY
)"
printf '%s\n' "$out" | grep -qx "http://brightspace.usc.edu/x none" && printf '%s\n' "$out" | grep -qx "https://brightspace.usc.edu:8443/x none" \
  && printf '%s\n' "$out" | grep -qx "https://brightspace.usc.edu/x cookie" \
  && ok "the cookie follows only the same scheme, host and port, never a downgrade to http" || no "redirect rule: $out"

# Course text with an escape sequence that would clear the screen and retitle the window.
$PY - "$T/fx.json" <<'PY'
import datetime as d, json, sys
now = d.datetime.now(d.timezone.utc)
iso = lambda days: (now + d.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
E = {"Items": [{"OrgUnit": {"Id": 705, "Name": "20263_52300 PSYC-100: Intro Psych", "Code": "PSYC-100"},
                "Access": {"IsActive": True}}], "PagingInfo": {"HasMoreItems": False}}
bad = "\x1b[2J\x1b]0;pwned\x07"
json.dump({"/lp/1.63/enrollments/myenrollments/": E,
           "/lp/1.43/enrollments/myenrollments/?orgUnitTypeId=3&pageSize=100": E,
           "/le/1.99/705/news/": [{"Title": bad + "Room change", "Body": {"Text": bad + "SGM 123", "Html": ""},
                                   "StartDate": iso(-1), "IsPublished": True}],
           "/le/1.99/705/dropbox/folders/": [{"Id": 9, "Name": bad + "Essay 2", "DueDate": iso(2)}],
           "/le/1.99/705/dropbox/folders/9/submissions/": [],
           "/le/1.99/705/quizzes/": {"Objects": [], "Next": None}}, open(sys.argv[1], "w"))
PY
nw="$(BRIGHTSPACE_FIXTURE="$T/fx.json" $PY "$ROOT/bin/brightspace" news --days 7 2>&1)"
printf '%s' "$nw" | grep -q "Room change" && printf '%s' "$nw" | grep -q "SGM 123" && ! printf '%s' "$nw" | LC_ALL=C grep -q $'\x1b' \
  && ok "announcement text prints with its escape sequences stripped" || no "news output kept control bytes: $(printf '%s' "$nw" | od -c | head -3)"
du="$(BRIGHTSPACE_FIXTURE="$T/fx.json" $PY "$ROOT/bin/brightspace" due --days 7 2>&1)"
printf '%s' "$du" | grep -q "Essay 2" && ! printf '%s' "$du" | LC_ALL=C grep -q $'\x1b' \
  && ok "a dropbox name prints with its escape sequences stripped" || no "due output: $(printf '%s' "$du" | od -c | head -4)"

# Links in an instructor's HTML: entities decode before control bytes come off,
# both quote styles parse, and a hostile body can't hang the parser.
out="$($PY - "$ROOT/bin/brightspace" <<'PY' 2>&1
import importlib.machinery, importlib.util, sys, time
sys.dont_write_bytecode = True
l = importlib.machinery.SourceFileLoader("bs", sys.argv[1])
m = importlib.util.module_from_spec(importlib.util.spec_from_loader("bs", l)); l.exec_module(m)
assert m.links_of('<a href="https://x.test/a">Spec</a>') == [("Spec", "https://x.test/a")]
assert m.links_of("<a class='c' href='https://x.test/b'>B <b>doc</b></a>") == [("B doc", "https://x.test/b")]
assert m.links_of('<a href="https://x.test/a?x=1&amp;y=2"></a>') == [("https://x.test/a?x=1&y=2", "https://x.test/a?x=1&y=2")]
hostile = m.links_of('<a href="https://x.test/&#27;]52;c;AA&#7;">Sp&#27;[2Jec</a>')
assert "\x1b" not in repr(hostile) and "\\x1b" not in repr(hostile) and "\\x07" not in repr(hostile), hostile
assert m.links_of("") == [] and m.links_of(None) == []
start = time.time()
m.links_of("<a " * 200000 + 'href="x" ' * 200000 + "<a href=x>" * 100000)
assert time.time() - start < 20, time.time() - start
print("fine")
PY
)"
[ "$out" = fine ] && ok "links parse both quote styles, drop control bytes after decoding, and can't hang" || no "links_of: $out"
exit "$fail"
