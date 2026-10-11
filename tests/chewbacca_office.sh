#!/bin/bash
# chewbacca office signs in with Microsoft's own device-code flow through MSAL
# and reads Microsoft 365 through Graph with that token. Everything outside this
# machine is faked: MSAL is a fake module inside a fake venv, the keychain is a
# fake `security`, the browser is a fake `open`, and Graph is a loopback HTTP
# server. No network, no real keychain, synthetic data only.
#
# Covered: Microsoft's device-code message is printed exactly and its page
# opened; a tenant refusal prints the AADSTS error and stops; no token reaches
# stdout, stderr or a file; acquire_token_silent is what every command uses,
# and a refreshed cache is saved back; GET only, to the fixed path templates,
# with traversal ids, off-template, off-host and looping nextLinks and oversize
# responses all bounded; calls at least 1 s apart; 401, 403, 429 and redirects
# stop with no retry and point at `chewbacca office login`; a file download
# follows only the pre-authenticated redirect and never carries the token;
# logout removes the keychain item; terminal controls never reach plain output.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T="$(mktemp -d)"
SERVER_PID=""
trap '[ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null; rm -rf "$T"' EXIT
fail=0
no() { echo "FAIL: $*"; fail=1; }
OFF="${OFF_BIN:-$ROOT/bin/chewbacca-office}"
TOKEN="fakeGRAPHaccessSYNTHETIC.NOTREAL.0123456789abcdef"     # fake test token, secret-scan: allow
TOKEN2="fakeGRAPHrefreshedSYNTHETIC.NOTREAL.9876543210fedcba" # fake test token, secret-scan: allow
RTOK="fakeREFRESHtokenSYNTHETIC.NOTREAL.0123456789"          # fake test token, secret-scan: allow
mkdir -p "$T/home" "$T/fakemsal/msal" "$T/venv/bin"

# ── fake MSAL ────────────────────────────────────────────────────────────────
cat > "$T/fakemsal/msal/__init__.py" <<'PY'
# A stand-in for msal with the same names chewbacca-office calls. It logs what
# was asked for, never a token.
import json, os, time
D = os.environ["FAKE_DIR"]
def _log(**k):
    with open(os.path.join(D, "msal.log"), "a") as f:
        f.write(json.dumps(k) + "\n")
class SerializableTokenCache:
    def __init__(self):
        self._s = {}; self.has_state_changed = False
    def deserialize(self, s):
        self._s = json.loads(s) if s else {}; self.has_state_changed = False
    def serialize(self):
        self.has_state_changed = False
        return json.dumps(self._s)
class PublicClientApplication:
    def __init__(self, client_id, client_credential=None, authority=None, token_cache=None, **kw):
        _log(event="init", client_id=client_id, authority=authority)
        self.cache = token_cache
    def initiate_device_flow(self, scopes=None, **kw):
        if any(s.lower() in ("offline_access", "openid", "profile") for s in scopes or []):
            raise ValueError("You cannot use any scope value that is reserved.")
        _log(event="device_flow", scopes=scopes)
        if os.environ.get("FAKE_MSAL_MODE") == "blocked":
            return {"error": "invalid_client", "error_description":
                    "AADSTS700016: Application with identifier '14d82eec' was not found in the directory 'usc.edu'."}
        return {"user_code": "FAKECODE1", "device_code": "dc", "expires_in": 900,
                "verification_uri": os.environ.get("FAKE_VERIFY_URI", "https://microsoft.com/devicelogin"),
                "message": "To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code FAKECODE1 to authenticate."}
    def acquire_token_by_device_flow(self, flow, **kw):
        _log(event="by_device_flow")
        if os.environ.get("FAKE_MSAL_MODE") == "expired":
            return {"error": "authorization_pending", "error_description":
                    "AADSTS70016: OAuth 2.0 device flow error. Authorization is pending. Continue polling."}
        if os.environ.get("FAKE_MSAL_MODE") == "consent":
            return {"error": "invalid_grant", "error_description":
                    "AADSTS65001: The user or administrator has not consented to use the application."}
        self.cache._s = {"Account": {"a": {"username": "tommy.trojan@usc.edu"}},
                         "AccessToken": {"t": {"secret": os.environ["FAKE_TOKEN"], "expires_on": time.time() + 3600}},
                         "RefreshToken": {"r": {"secret": os.environ["FAKE_RT"]}}}
        self.cache.has_state_changed = True
        return {"access_token": os.environ["FAKE_TOKEN"], "refresh_token": os.environ["FAKE_RT"],
                "id_token_claims": {"preferred_username": "tommy.trojan@usc.edu"}}
    def get_accounts(self, username=None):
        return list(((self.cache._s or {}).get("Account") or {}).values())
    def acquire_token_silent(self, scopes, account, **kw):
        _log(event="silent", scopes=scopes, account=account.get("username"))
        if os.environ.get("FAKE_SILENT") == "fail":
            return None
        at = self.cache._s["AccessToken"]["t"]
        if os.environ.get("FAKE_SILENT") == "raise":
            # An MSAL error that carries the token response, the worst case.
            raise RuntimeError("token endpoint said refresh_token=" + self.cache._s["RefreshToken"]["r"]["secret"]
                               + " access_token=" + at["secret"])
        if at["expires_on"] < time.time():
            at["secret"] = os.environ["FAKE_TOKEN2"]; at["expires_on"] = time.time() + 3600
            self.cache.has_state_changed = True
            _log(event="refreshed")
        return {"access_token": at["secret"]}
PY
# The venv's python: real python3 with the fake msal on its path.
cat > "$T/venv/bin/python" <<SH
#!/bin/sh
PYTHONPATH="$T/fakemsal" exec python3 "\$@"
SH
chmod +x "$T/venv/bin/python"

# ── fake keyring and security over one JSON "keychain" ───────────────────────
mkdir -p "$T/fakemsal/keyring"
cat > "$T/fakemsal/keyring/errors.py" <<'PY'
class KeyringError(Exception): pass
class PasswordSetError(KeyringError): pass
class PasswordDeleteError(KeyringError): pass
PY
cat > "$T/fakemsal/keyring/__init__.py" <<'PY'
# A stand-in for keyring. It logs which call was made and for whom, never the
# password. FAKE_KEYRING_FAIL=set raises an error that echoes the password, the
# way a careless backend might.
import json, os
from . import errors
D = os.environ["FAKE_DIR"]; STORE = os.path.join(D, "keychain.json")
def _load():
    try: return json.load(open(STORE))
    except Exception: return {}
def _log(*a):
    with open(os.path.join(D, "keyring.log"), "a") as f: f.write(" ".join(a) + "\n")
def set_password(service, username, password):
    _log("set_password", service, username)
    if os.environ.get("FAKE_KEYRING_FAIL") == "set":
        raise errors.PasswordSetError("Can't store password on keychain: " + password)
    kc = _load(); kc[service] = {"acct": username, "pw": password}; json.dump(kc, open(STORE, "w"))
def get_password(service, username):
    _log("get_password", service, username)
    it = _load().get(service)
    return it["pw"] if it and it["acct"] == username else None
def delete_password(service, username):
    _log("delete_password", service, username)
    kc = _load()
    if service not in kc or kc[service]["acct"] != username: raise errors.PasswordDeleteError("not found")
    del kc[service]; json.dump(kc, open(STORE, "w"))
PY
cat > "$T/security" <<'PY'
#!/usr/bin/env python3
# A stand-in for /usr/bin/security over the same JSON file. It logs its FULL
# argv, unredacted, so the test can prove no token or cache text is ever on a
# command line.
import json, os, sys
D = os.environ["FAKE_DIR"]; store = os.path.join(D, "keychain.json")
a = sys.argv[1:]
with open(os.path.join(D, "security.log"), "a") as f:
    f.write(json.dumps(a) + "\n")
try: kc = json.load(open(store))
except Exception: kc = {}
def opt(k): return a[a.index(k) + 1] if k in a else None
svc = opt("-s")
if a[0] == "add-generic-password":
    if svc in kc and "-U" not in a: sys.exit(45)
    kc[svc] = {"acct": opt("-a"), "pw": opt("-w")}
elif a[0] == "find-generic-password":
    if svc not in kc: sys.exit(44)
    if "-w" in a: print(kc[svc]["pw"])
    else: print('keychain: "login.keychain-db"\nattributes:\n    "acct"<blob>="%s"\n    "svce"<blob>="%s"' % (kc[svc]["acct"], svc))
elif a[0] == "delete-generic-password":
    if svc not in kc: sys.exit(44)
    del kc[svc]
json.dump(kc, open(store, "w"))
PY
chmod +x "$T/security"
cat > "$T/open" <<'SH'
#!/bin/sh
echo "$1" >> "$FAKE_DIR/open.log"
SH
chmod +x "$T/open"

# ── fake Graph on loopback ───────────────────────────────────────────────────
# Behavior per request comes from ctl.json, so one server serves every case.
cat > "$T/graph.py" <<'PY'
import base64, io, json, os, sys, time, urllib.parse, zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
D = os.environ["FAKE_DIR"]; TOKS = (os.environ["FAKE_TOKEN"], os.environ["FAKE_TOKEN2"])
NASTY = "\x1b[31mred\x1b[0m \x1b]8;;https://evil.example\x07click\x1b]8;;\x07\roverwrite ‮gnp.exe \x9bc1"
def docx():
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", "<w:document><w:body><w:p><w:r><w:t>Hello from Word</w:t></w:r></w:p>"
                   "<w:p><w:r><w:t>second line</w:t></w:r></w:p></w:body></w:document>")
    return b.getvalue()
def pptx():
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("ppt/slides/slide1.xml", "<p:sld><a:p><a:r><a:t>Slide one title</a:t></a:r></a:p></p:sld>")
        z.writestr("ppt/slides/slide2.xml", "<p:sld><a:p><a:r><a:t>Slide two body</a:t></a:r></a:p></p:sld>")
    return b.getvalue()
def addr(n, a): return {"emailAddress": {"name": n, "address": a}}
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _any(self):
        try: ctl = json.load(open(os.path.join(D, "ctl.json")))
        except Exception: ctl = {}
        sp = urllib.parse.urlsplit(self.path); q = dict(urllib.parse.parse_qsl(sp.query))
        auth = self.headers.get("Authorization") or ""
        with open(os.path.join(D, "calls.log"), "a") as f:
            f.write(json.dumps({"t": time.monotonic(), "method": self.command, "path": sp.path, "query": sp.query,
                                "bearer": auth in ("Bearer " + TOKS[0], "Bearer " + TOKS[1]),
                                "bearer2": auth == "Bearer " + TOKS[1], "auth": bool(auth)}) + "\n")
        if self.command != "GET":
            return self._send(405, b"")
        if sp.path.startswith("/download/"):
            data = pptx() if sp.path.endswith("pptx") else docx()
            return self._send(200, data, "application/octet-stream")
        if ctl.get("status"):
            return self._send(int(ctl["status"]), json.dumps({"error": {"code": "x", "message": "bad token " + auth}}).encode())
        if ctl.get("redirect"):
            return self._send(302, b"", loc=ctl["redirect"])
        path = sp.path[len("/v1.0"):] if sp.path.startswith("/v1.0") else None
        body = None
        if path == "/me/messages":
            filt = q.get("$filter", ""); nxt = ctl.get("next", ""); p = int(q.get("_p", "0"))
            msgs = [
                {"id": "AAA1", "subject": "Midterm review " + NASTY, "from": addr("Prof " + NASTY, "prof@usc.edu"),
                 "receivedDateTime": "2026-10-08T17:00:00Z", "isRead": False, "hasAttachments": True,
                 "bodyPreview": "see you " + NASTY},
                {"id": "AAA2", "subject": "Read already", "from": addr("Ada Lovelace", "ada@usc.edu"),
                 "receivedDateTime": "2026-10-07T12:00:00Z", "isRead": True, "hasAttachments": False, "bodyPreview": "hi"}]
            if "isRead eq false" in filt: msgs = [m for m in msgs if not m["isRead"]]
            if "from/emailAddress/address eq 'ada@usc.edu'" in filt: msgs = [m for m in msgs if m["id"] == "AAA2"]
            G = "https://graph.microsoft.com/v1.0"
            if nxt == "offtemplate": body = {"value": msgs[:1], "@odata.nextLink": G + "/me/sendMail?%24skiptoken=x"}
            elif nxt == "offhost": body = {"value": msgs[:1], "@odata.nextLink": "https://evil.example/v1.0/me/messages?%24skiptoken=x"}
            elif nxt == "loop": body = {"value": msgs[:1], "@odata.nextLink": G + "/me/messages?%24skiptoken=SAME"}
            elif nxt == "grow": body = {"value": msgs[:1], "@odata.nextLink": f"{G}/me/messages?_p={p+1}&%24skiptoken=S{p+1}"}
            elif p == 0 and not filt: body = {"value": msgs[:1], "@odata.nextLink": G + "/me/messages?_p=1&%24top=25"}
            elif p == 1: body = {"value": msgs[1:]}
            else: body = {"value": msgs}
            if ctl.get("oversize"): body["pad"] = "x" * 4000
        elif path and path.startswith("/me/messages/"):
            body = {"subject": "Midterm review", "from": addr("Prof Plum", "prof@usc.edu"),
                    "toRecipients": [addr("Caleb", "c@usc.edu")], "receivedDateTime": "2026-10-08T17:00:00Z",
                    "isRead": False, "body": {"contentType": "html",
                    "content": "<p>Hello <b>Caleb</b></p><script>x</script>" + NASTY}}
        elif path == "/me/calendarView":
            assert "startDateTime" in q and "endDateTime" in q, q
            body = {"value": [{"subject": "Lecture " + NASTY, "start": {"dateTime": "2026-10-10T18:00:00Z"},
                    "end": {"dateTime": "2026-10-10T19:30:00Z"}, "location": {"displayName": "SAL 101"},
                    "organizer": addr("Dr. Who", "who@usc.edu")}]}
        elif path == "/me/drive/recent":
            body = {"value": [
                {"id": "FILE_XLSX", "name": "budget.xlsx", "file": {"mimeType": "application/vnd.ms-excel"},
                 "lastModifiedDateTime": "2026-10-05T09:00:00Z", "size": 2048, "webUrl": "https://usc-my.sharepoint.com/x"},
                {"id": "FILE_DOCX", "name": "paper " + NASTY + ".docx", "file": {"mimeType": "application/msword"},
                 "lastModifiedDateTime": "2026-10-04T09:00:00Z", "size": 1024, "webUrl": "https://usc-my.sharepoint.com/d"},
                {"remoteItem": {"id": "SHARED1", "name": "shared.pptx", "webUrl": "https://usc-my.sharepoint.com/s"},
                 "name": "shared.pptx", "lastModifiedDateTime": "2026-10-03T09:00:00Z"}]}
        elif path and path.startswith("/me/drive/root/search"):
            body = {"value": [{"id": "FILE_XLSX", "name": "budget.xlsx", "file": {"mimeType": "x"},
                    "lastModifiedDateTime": "2026-10-05T09:00:00Z", "webUrl": "https://usc-my.sharepoint.com/x"}]} \
                if "budget" in path else {"value": []}
        elif path and path.startswith("/me/drive/items/"):
            rest = path[len("/me/drive/items/"):]; item = rest.split("/")[0]
            if rest.endswith("/content"):
                base = "http://" + self.headers["Host"]
                where = ctl.get("download_to") or (base + "/download/" + ("pptx" if item == "SHARED1" else "docx"))
                return self._send(302, b"", loc=where)
            elif rest.endswith("/workbook/worksheets"):
                body = {"value": [{"id": "s1", "name": "Sheet1", "position": 0}, {"id": "s2", "name": "Totals", "position": 1}]}
            elif "/usedRange" in rest:
                sid = rest.split("worksheets('")[1].split("')")[0]
                body = {"text": [["a", "b"], ["1", "2"]] if sid == "s1" else [["total"], ["3"]]}
            else:
                name = {"FILE_XLSX": "budget.xlsx", "SHARED1": "shared.pptx"}.get(item, "paper.docx")
                body = {"name": name, "file": {"mimeType": "application/octet-stream"}, "size": 1024}
        elif path == "/me/chats":
            body = {"value": [{"id": "19:chat1@thread.v2", "topic": "Group Project " + NASTY, "chatType": "group",
                    "lastUpdatedDateTime": "2026-10-08T20:00:00Z"}]}
        if body is None:
            return self._send(404, b'{"error":{"code":"NotFound","message":"nope"}}')
        self._send(200, json.dumps(body).encode())
    def _send(self, status, data, ctype="application/json", loc=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(data)))
        if loc: self.send_header("Location", loc)
        self.end_headers(); self.wfile.write(data)
    do_GET = do_POST = do_PATCH = do_DELETE = do_PUT = _any
srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
open(os.path.join(D, "port"), "w").write(str(srv.server_address[1]))
srv.serve_forever()
PY

export FAKE_DIR="$T" FAKE_TOKEN="$TOKEN" FAKE_TOKEN2="$TOKEN2" FAKE_RT="$RTOK" HOME="$T/home" \
       CHEWBACCA_OFFICE_VENV="$T/venv" CHEWBACCA_OFFICE_SECURITY="$T/security" CHEWBACCA_OFFICE_OPEN="$T/open" \
       NO_PROXY="127.0.0.1" no_proxy="127.0.0.1"
unset CHEWBACCA_OFFICE_IN_VENV http_proxy https_proxy HTTP_PROXY HTTPS_PROXY 2>/dev/null
python3 "$T/graph.py" & SERVER_PID=$!; disown "$SERVER_PID" 2>/dev/null
for _ in $(seq 1 100); do [ -s "$T/port" ] && break; sleep 0.05; done
[ -s "$T/port" ] || { echo "FAIL: the fake Graph server did not start"; exit 1; }
export CHEWBACCA_OFFICE_GRAPH_BASE="http://127.0.0.1:$(cat "$T/port")"
BASE="$CHEWBACCA_OFFICE_GRAPH_BASE"

ctl() { python3 -c 'import json,sys; print(json.dumps(dict(a.split("=",1) for a in sys.argv[1:])))' "$@" > "$T/ctl.json"; }
off() { : > "$T/calls.log"; python3 "$OFF" "$@"; }
calls() { grep -c . "$T/calls.log"; }
items() { python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["items"]))'; }
has_item() { [ -s "$T/keychain.json" ] && python3 -c 'import json,sys; sys.exit(0 if "chewbacca-office" in json.load(open(sys.argv[1])) else 1)' "$T/keychain.json"; }
ctl

# The verb is wired, and help names login.
bash "$ROOT/bin/chewbacca" office help 2>&1 | grep -q "chewbacca office login" || no "chewbacca office help is not wired or lost login"

# ── not signed in: stop before any request, pointing at login ───────────────
out="$(off mail 2>&1)"; rc=$?
[ "$rc" = 4 ] || no "mail with no sign-in exited $rc, want 4: $out"
printf '%s' "$out" | grep -q "chewbacca office login" || no "mail with no sign-in did not point at login: $out"
[ "$(calls)" = 0 ] || no "mail with no sign-in made a Graph request"

# ── login: tenant refuses the app ────────────────────────────────────────────
: > "$T/open.log"
out="$(FAKE_MSAL_MODE=blocked off login 2>&1)"; rc=$?
[ "$rc" = 4 ] || no "a blocked app did not stop with 4 (rc $rc): $out"
printf '%s' "$out" | grep -q "AADSTS700016" || no "a blocked app did not print the exact AADSTS error: $out"
printf '%s' "$out" | grep -q "BLOCKED" || no "a blocked app was not reported BLOCKED: $out"
[ -s "$T/open.log" ] && no "a blocked app still opened a browser page"
has_item && no "a blocked login wrote a keychain item"
# Once the tenant has refused, a second login stops before asking Microsoft
# for a code or opening a page: no sign-in page keeps reappearing for a login
# that cannot succeed. --retry clears the hold.
[ -s "$T/home/.chewbacca/office-hold" ] || no "a refused sign-in did not leave a hold"
: > "$T/open.log"; : > "$T/msal.log"
out="$(off login 2>&1)"; rc=$?
[ "$rc" = 4 ] || no "login under a hold exited $rc, want 4: $out"
printf '%s' "$out" | grep -q "AADSTS700016" || no "login under a hold did not say why: $out"
[ -s "$T/open.log" ] && no "login under a hold opened a browser page"
[ -s "$T/msal.log" ] && no "login under a hold asked Microsoft for a device code"
out="$(FAKE_MSAL_MODE=consent off login --retry 2>&1)"; rc=$?
[ "$rc" = 4 ] && printf '%s' "$out" | grep -q "AADSTS65001" || no "admin consent required did not print AADSTS65001 and stop: $out"
has_item && no "a login that needed consent wrote a keychain item"
out="$(FAKE_MSAL_MODE=expired off login --retry 2>&1)"; rc=$?
[ "$rc" = 4 ] || no "an expired code did not stop with 4 (rc $rc): $out"
printf '%s' "$out" | grep -q "code expired" || no "an expired code was not reported as expired: $out"
printf '%s' "$out" | grep -q "Continue polling" && no "an expired code still printed MSAL's 'Continue polling': $out"
has_item && no "an expired login wrote a keychain item"

# ── login: the device-code message, exactly, and the page opened ────────────
: > "$T/open.log"; : > "$T/msal.log"
off login --retry > "$T/login.out" 2> "$T/login.err"; rc=$?
[ "$rc" = 0 ] || no "login exited $rc: $(cat "$T/login.out" "$T/login.err")"
grep -qxF "To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code FAKECODE1 to authenticate." "$T/login.out" \
  || no "login did not print Microsoft's device-code message exactly: $(cat "$T/login.out")"
[ "$(cat "$T/open.log")" = "https://microsoft.com/devicelogin" ] || no "login did not open https://microsoft.com/devicelogin: $(cat "$T/open.log")"
python3 - "$T/msal.log" <<'PY' || no "login used the wrong client, authority or scopes"
import json, sys
ev = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
init = [e for e in ev if e["event"] == "init"][0]
assert init["client_id"] == "14d82eec-204b-4c2f-b7e8-296a70dab67e", init
assert init["authority"] == "https://login.microsoftonline.com/organizations", init
sc = {s.rsplit("/", 1)[-1] for s in [e for e in ev if e["event"] == "device_flow"][0]["scopes"]}
assert sc == {"Mail.ReadWrite", "Mail.Send", "Calendars.ReadWrite", "Files.ReadWrite.All", "Chat.ReadWrite", "User.Read"}, sc
PY
has_item || no "login did not save the cache to the keychain"
python3 - "$T/keychain.json" <<'PY' || no "the keychain item is not the MSAL cache under the UPN"
import json, sys
it = json.load(open(sys.argv[1]))["chewbacca-office"]
assert it["acct"] == "tommy.trojan@usc.edu", it["acct"]
assert json.loads(it["pw"])["Account"]["a"]["username"] == "tommy.trojan@usc.edu"
PY
grep -q "set_password chewbacca-office tommy.trojan@usc.edu" "$T/keyring.log" \
  || no "login did not store the cache through keyring: $(cat "$T/keyring.log" 2>/dev/null)"
# A verification URI that is not Microsoft's is never opened.
: > "$T/open.log"; FAKE_VERIFY_URI="https://evil.example/devicelogin" off login >/dev/null 2>&1
[ -s "$T/open.log" ] && no "login opened a non-Microsoft verification page"

# ── mail: silent token, Bearer header, nextLink paging, throttle ────────────
: > "$T/msal.log"
out="$(off mail --json 2>&1)"
printf '%s' "$out" | python3 -c '
import json,sys; d=json.load(sys.stdin); m=d["items"]
assert d["truncated"] is False, d
assert [x["id"] for x in m] == ["AAA1","AAA2"], m
assert m[0]["unread"] and m[0]["has_attachments"] and m[0]["subject"].startswith("Midterm review"), m[0]
assert not m[1]["unread"], m[1]' || no "mail did not parse or page: $out"
[ "$(calls)" = 2 ] || no "mail made $(calls) calls, want 2 (one page + nextLink)"
python3 - "$T/calls.log" <<'PY' || no "a mail request did not carry the Bearer token"
import json, sys
assert all(json.loads(l)["bearer"] for l in open(sys.argv[1]) if l.strip())
PY
grep -q '"event": "silent"' "$T/msal.log" || no "mail did not get its token through acquire_token_silent"
python3 - "$T/calls.log" <<'PY' || no "two Graph calls landed under 1 s apart"
import json, sys
t = [json.loads(l)["t"] for l in open(sys.argv[1]) if l.strip()]
# The client spaces sends 1 s apart; the server sees arrivals, and the first
# request's connect can lag the second's, so allow 0.2 s of skew. With no
# throttle the gap is a few milliseconds, so 0.8 still catches it.
assert all(b - a >= 0.8 for a, b in zip(t, t[1:])), t
PY

# ── silent refresh: an expired access token is refreshed and saved back ─────
python3 - "$T/keychain.json" <<'PY'
import json, sys
kc = json.load(open(sys.argv[1])); it = kc["chewbacca-office"]
c = json.loads(it["pw"]); c["AccessToken"]["t"]["expires_on"] = 0
it["pw"] = json.dumps(c); json.dump(kc, open(sys.argv[1], "w"))
PY
: > "$T/msal.log"
off calendar --json >/dev/null 2>&1
grep -q '"event": "refreshed"' "$T/msal.log" || no "an expired token was not refreshed through acquire_token_silent"
grep -q '"bearer2": true' "$T/calls.log" || no "the refreshed token was not the one sent"
python3 - "$T/keychain.json" "$TOKEN2" <<'PY' || no "the refreshed cache was not saved back to the keychain"
import json, sys
at = json.loads(json.load(open(sys.argv[1]))["chewbacca-office"]["pw"])["AccessToken"]["t"]
assert at["secret"] == sys.argv[2] and at["expires_on"] > 0, at
PY
out="$(FAKE_SILENT=fail off mail 2>&1)"; rc=$?
[ "$rc" = 4 ] && printf '%s' "$out" | grep -q "chewbacca office login" || no "a failed silent refresh did not stop and point at login: $out"
[ "$(calls)" = 0 ] || no "a failed silent refresh still made a Graph request"

# --unread and --from narrow the Graph $filter.
off mail --unread --json >/dev/null 2>&1
grep -q 'isRead%20eq%20false' "$T/calls.log" || no "--unread did not add an isRead filter"
off mail --from ada@usc.edu --json | items > "$T/fromout.json" 2>&1
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert [m["id"] for m in d]==["AAA2"], d' "$T/fromout.json" || no "--from did not filter"

# read: GET only (never a PATCH, so never marks read), HTML stripped.
out="$(off read AAA1 --json 2>&1)"
printf '%s' "$out" | python3 -c '
import json,sys; d=json.load(sys.stdin)
assert d["subject"] == "Midterm review" and "Caleb" in d["text"], d
assert "<p>" not in d["text"] and "<script>" not in d["text"], d
assert d["was_unread"] is True, d' || no "read did not parse or strip html: $out"

# calendar, files, doc, teams parse into the promised fields.
out="$(off calendar --days 3 --json 2>&1)"
printf '%s' "$out" | python3 -c '
import json,sys; m=json.load(sys.stdin)["items"]
assert m[0]["subject"].startswith("Lecture") and m[0]["location"]=="SAL 101" and m[0]["organizer"]=="Dr. Who", m
assert m[0]["start"] and m[0]["end"]' || no "calendar did not parse: $out"
out="$(off files --json 2>&1)"
printf '%s' "$out" | python3 -c '
import json,sys; m=json.load(sys.stdin)["items"]
names=[f["name"] for f in m]; assert "budget.xlsx" in names and "shared.pptx" in names, names
assert any(f["id"]=="SHARED1" for f in m) and all("webUrl" in f for f in m), m' || no "files --recent did not parse: $out"
off files --search budget --json | items | python3 -c 'import json,sys; d=json.load(sys.stdin); assert [f["name"] for f in d]==["budget.xlsx"], d' || no "files --search did not filter"
out="$(off doc FILE_XLSX --json 2>&1)"
printf '%s' "$out" | python3 -c '
import json,sys; d=json.load(sys.stdin)
assert d["type"]=="excel" and [s["name"] for s in d["sheets"]]==["Sheet1","Totals"], d
assert d["sheets"][0]["text"]=="a\tb\n1\t2" and d["sheets"][1]["text"]=="total\n3", d' || no "doc excel did not use the range API for all sheets: $out"

# doc (Word, PowerPoint): /content answers 302 to a pre-authenticated download,
# which is followed WITHOUT the token.
out="$(off doc FILE_DOCX --json 2>&1)"
printf '%s' "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert "Hello from Word" in d["text"] and "second line" in d["text"], d' || no "doc word did not extract text: $out"
python3 - "$T/calls.log" <<'PY' || no "the file download did not happen, or carried an Authorization header"
import json, sys
dl = [json.loads(l) for l in open(sys.argv[1]) if '"/download/' in l]
assert dl and not any(r["auth"] for r in dl), dl
PY
out="$(off doc SHARED1 --json 2>&1)"
printf '%s' "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert "Slide one title" in d["text"] and "Slide two body" in d["text"], d' || no "doc pptx did not extract slide text: $out"
# A /content redirect anywhere else is not followed.
ctl download_to="$BASE/evil/steal"
out="$(off doc FILE_DOCX 2>&1)"; rc=$?
[ "$rc" = 4 ] || no "a download redirect off the allowed hosts was followed (rc $rc): $out"
grep -q '/evil/' "$T/calls.log" && no "a request went to an off-allowlist download URL"
ctl

out="$(off teams --json 2>&1)"
printf '%s' "$out" | python3 -c 'import json,sys; m=json.load(sys.stdin)["items"]; assert m[0]["id"]=="19:chat1@thread.v2" and m[0]["topic"].startswith("Group Project"), m' || no "teams did not parse: $out"
grep -q 'lastMessagePreview' "$T/calls.log" && no "teams expanded lastMessagePreview, which Chat.ReadBasic does not cover"

# GET only, every request so far, and only under /v1.0/ or the download path.
python3 - "$T/calls.log" <<'PY' || no "a request was not a GET to /v1.0"
import json, sys
for l in open(sys.argv[1]):
    if not l.strip(): continue
    r = json.loads(l)
    assert r["method"] == "GET" and (r["path"].startswith("/v1.0/") or r["path"].startswith("/download/")), r
PY

# Terminal controls from other people's mail, events, files and chats never
# reach plain output; --json keeps the raw text, escaped.
{ off mail; off calendar; off files; off teams; off read AAA1; } > "$T/plain.out" 2>&1
python3 - "$T/plain.out" <<'PY2' || no "a terminal control sequence reached plain output"
import re, sys
out = open(sys.argv[1], encoding="utf-8", newline="").read()
assert "Midterm review" in out and "Lecture" in out and "Group Project" in out and "paper" in out, out
assert not re.search("[\x00-\x08\x0b-\x1f\x7f-\x9f‪-‮⁦-⁩]", out), repr(out[:400])
PY2
off mail --json | python3 -c 'import json,sys; m=json.load(sys.stdin)["items"]; assert "\x1b[31m" in m[0]["subject"], m[0]' || no "--json no longer carries the raw text"

# ── path rules ───────────────────────────────────────────────────────────────
# A path outside its template is refused before any request.
: > "$T/calls.log"
out="$(CHEWBACCA_OFFICE_IN_VENV=1 PYTHONPATH="$T/fakemsal" python3 - "$OFF" 2>&1 <<'PY'
import sys, types
m = types.ModuleType("off"); m.__dict__["__file__"] = sys.argv[1]
exec(open(sys.argv[1]).read().replace('if __name__ == "__main__"', 'if False'), m.__dict__)
g = m.Graph(lambda: "unused")
g.get("/me/sendMail", m.template_regex("/me/messages"))
PY
)"
printf '%s' "$out" | grep -q "refused" && [ ! -s "$T/calls.log" ] || no "a non-template path was requested: $out"

# Traversal ids are rejected by the strict id charset, and no request is made.
for bad in ".." "a/b" 'a\b' "..%2f..%2fsendMail" "x%2e%2e" "a b"; do
  out="$(off read "$bad" 2>&1)"; rc=$?
  [ "$rc" != 0 ] || no "traversal id '$bad' was accepted"
  [ -s "$T/calls.log" ] && no "traversal id '$bad' reached a request"
done

# An @odata.nextLink off-template or off-host is never followed.
ctl next=offtemplate
out="$(off mail --json 2>&1)"
printf '%s' "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["truncated"] is True and len(d["items"])==1, d' || no "an off-template nextLink was not stopped: $out"
grep -q "sendMail" "$T/calls.log" && no "a request was made to an off-template nextLink path"
ctl next=offhost
out="$(off mail --json 2>&1)"
printf '%s' "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["truncated"] is True, d' || no "an off-host nextLink was not stopped: $out"
[ "$(calls)" = 1 ] || no "an off-host nextLink was followed ($(calls) calls)"
# A nextLink that repeats itself is a cycle, caught on the repeat.
ctl next=loop
out="$(off mail --json 2>&1)"
printf '%s' "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["truncated"] is True, d' || no "a nextLink cycle was not reported truncated: $out"
[ "$(calls)" = 2 ] || no "a nextLink cycle made $(calls) calls, want 2"
# Ever-changing nextLinks stop at the page cap.
ctl next=grow
out="$(CHEWBACCA_OFFICE_MAXPAGES=3 off mail --json 2>&1)"
printf '%s' "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["truncated"] is True, d' || no "growing nextLinks did not report truncated: $out"
[ "$(calls)" = 3 ] || no "growing nextLinks made $(calls) calls, want 3 (the page cap)"
# A response over the byte cap is refused whole.
ctl oversize=1
out="$(CHEWBACCA_OFFICE_MAXBYTES=500 off mail 2>&1)"; rc=$?
[ "$rc" != 0 ] && printf '%s' "$out" | grep -qi "cap" || no "an oversize response was not refused with a cap message (rc $rc): $out"
ctl

# ── pushback: stop on the first answer, no retry, point at login ────────────
for case in "status=401" "status=403" "status=429" "redirect=https://login.microsoftonline.com/common/oauth2/v2.0/authorize"; do
  ctl "$case"
  out="$(off mail --limit 5 2>&1)"; rc=$?
  [ "$rc" = 4 ] || no "$case: exit $rc, want 4: $out"
  printf '%s' "$out" | grep -q "STOPPED" || no "$case: no STOPPED line: $out"
  [ "$(calls)" = 1 ] || no "$case: made $(calls) calls after pushback, want 1"
  case "$case" in status=*) printf '%s' "$out" | grep -q "chewbacca office login" || no "$case: no pointer to chewbacca office login: $out";; esac
done
ctl
grep -q "login.microsoftonline.com" "$T/calls.log" && no "a redirect to a sign-in page was followed"

# The Graph base override takes loopback only, so it can never carry the token away.
out="$(CHEWBACCA_OFFICE_GRAPH_BASE=https://evil.example off mail 2>&1)"; rc=$?
[ "$rc" != 0 ] && printf '%s' "$out" | grep -q "refused" || no "a non-loopback Graph base was accepted: $out"

# ── no token or cache anywhere but the keychain ─────────────────────────────
# Every output above went through $T or a variable. HOME is $T/home.
{ off mail --json; off calendar; off login; off read AAA1; } > "$T/leak.out" 2>&1

# Forced failures print nothing secret, even when the failure's own message
# carries the token: Graph errors that echo the bearer, MSAL raising with the
# token response in its message, and a keychain write error that echoes the
# cache. None may print a traceback either.
for case in "status=401" "status=400" "status=403"; do
  ctl "$case"; off mail > "$T/fail-$case.out" 2>&1 && no "$case: mail exited 0"
done
ctl
out="$(FAKE_SILENT=raise off mail 2>&1)"; rc=$?
printf '%s\n' "$out" > "$T/fail-msal-raise.out"
[ "$rc" != 0 ] || no "an MSAL exception did not fail the command"
printf '%s' "$out" | grep -q "Traceback" && no "an MSAL exception printed a traceback: $out"
out="$(FAKE_KEYRING_FAIL=set off login 2>&1)"; rc=$?
printf '%s\n' "$out" > "$T/fail-keyring-set.out"
[ "$rc" != 0 ] || no "a keychain write failure did not fail login"
printf '%s' "$out" | grep -q "Traceback" && no "a keychain write failure printed a traceback: $out"
off login >/dev/null 2>&1 || no "login did not recover after a keychain write failure"

# The keychain stand-in is the one place the cache may be; anywhere else under
# $T (outputs, logs, the fake security's argv log) is a leak.
grep -rl -e "$TOKEN" -e "$TOKEN2" -e "$RTOK" "$T" 2>/dev/null | grep -v -e "/fakemsal/" -e "/keychain.json$" > "$T/leaks" || true
[ -s "$T/leaks" ] && no "a token or refresh token reached a file or output: $(cat "$T/leaks")"
[ -z "$(find "$T/home" -type f 2>/dev/null)" ] || no "a file was written under HOME: $(find "$T/home" -type f)"
# Nothing secret on any command line: the fake security logged every argv.
python3 - "$T/security.log" "$T/keychain.json" "$TOKEN" "$TOKEN2" "$RTOK" <<'PY' || no "a token or the cache was passed on a command line"
import json, sys
log, kc, toks = sys.argv[1], sys.argv[2], sys.argv[3:]
argvs = [json.loads(l) for l in open(log) if l.strip()]
assert argvs, "security was never called"
cache = json.load(open(kc)).get("chewbacca-office", {}).get("pw", "")
for a in argvs:
    joined = " ".join(a)
    assert not any(t in joined for t in toks), a
    assert "-w" not in a and "-g" not in a, a
    assert not cache or cache not in joined, a
PY

# ── logout removes the keychain item ─────────────────────────────────────────
has_item || no "precondition: no keychain item before logout"
out="$(off logout 2>&1)"; rc=$?
[ "$rc" = 0 ] || no "logout exited $rc: $out"
has_item && no "logout left the keychain item in place"
grep -q "delete_password chewbacca-office tommy.trojan@usc.edu" "$T/keyring.log" || no "logout did not delete through keyring"
out="$(off mail 2>&1)"; rc=$?
[ "$rc" = 4 ] && printf '%s' "$out" | grep -q "chewbacca office login" || no "after logout, mail did not point at login: $out"

grep -q 'PAUSE = max(1.0' "$OFF" || no "the 1 s throttle floor is gone"
grep -q 'GRAPH = "https://graph.microsoft.com/v1.0"' "$OFF" || no "the fixed Graph origin changed"
grep -q 'MAX_DOC_CHARS' "$OFF" || no "the per-document character cap is gone"

[ "$fail" -eq 0 ] && echo "chewbacca office: ok"
exit "$fail"
