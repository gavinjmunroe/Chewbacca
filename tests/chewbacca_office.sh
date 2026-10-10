#!/bin/bash
# chewbacca office must read Microsoft 365 through the user's own signed-in
# Office tab and never let the Graph access token out of the page: the real
# in-page script runs here under node against a mock page (allowed origins,
# localStorage MSAL cache, fetch), so the GET-only, fixed-Graph-origin,
# origin-guard, path-template, URL-normalization and token-scrub checks are
# executed, not grepped. Graph responses parse into the fields each command
# promises, lists page with @odata.nextLink, calls sit at least 1 s apart, and
# the first 401, 403, 429 or sign-in redirect stops the command with no retry.
# A `read` is a GET and never a PATCH, so it can never mark a message read. An
# encrypted-only or absent Graph token stops with BLOCKED and no request.
# Traversal ids, off-template or looping nextLinks and oversize responses are
# all bounded. Synthetic data only.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
if ! command -v node >/dev/null 2>&1; then echo "chewbacca office: skipped, node not installed"; exit 0; fi
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
no() { echo "FAIL: $*"; fail=1; }
OFF="${OFF_BIN:-$ROOT/bin/chewbacca-office}"
TOKEN="fakeGRAPHtokenSYNTHETIC.NOTREAL.0123456789abcdefABCDEF"

# A real (tiny) .docx and .pptx so the OOXML text path is exercised for real,
# not mocked. The Word body carries the token too, to prove the scrub.
python3 - "$T" "$TOKEN" <<'PY'
import base64, io, sys, zipfile
T, tok = sys.argv[1], sys.argv[2]
def docx(xml):
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml",
                   "<w:document><w:body><w:p><w:r><w:t>" + xml + "</w:t></w:r></w:p>"
                   "<w:p><w:r><w:t>second line " + tok + "</w:t></w:r></w:p></w:body></w:document>")
    return b.getvalue()
def pptx():
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("ppt/slides/slide1.xml", "<p:sld><a:p><a:r><a:t>Slide one title</a:t></a:r></a:p></p:sld>")
        z.writestr("ppt/slides/slide2.xml", "<p:sld><a:p><a:r><a:t>Slide two body</a:t></a:r></a:p></p:sld>")
    return b.getvalue()
open(T + "/docx.b64", "w").write(base64.b64encode(docx("Hello from Word")).decode())
open(T + "/pptx.b64", "w").write(base64.b64encode(pptx()).decode())
PY

# The page. Runs one script with window state carried in state.json, the way a
# real tab keeps window.__chewOffice between chrome-js calls. localStorage is
# the synthetic MSAL cache chosen by FAKE_TOKEN_MODE.
cat > "$T/page.js" <<'JS'
const fs = require('fs'), cp = require('child_process');
const [script, stateFile] = process.argv.slice(2);
const d = process.env.FAKE_DIR, tok = process.env.FAKE_TOKEN;
globalThis.window = globalThis;
try { window.__chewOffice = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (e) {}
globalThis.location = { origin: process.env.FAKE_ORIGIN || 'https://outlook.office.com', href: process.env.FAKE_PAGE };

const mode = process.env.FAKE_TOKEN_MODE || 'plain';
const future = Math.floor(Date.now()/1000) + 3600;
const store = {};
const gk = 'msal.3|acct.realm|env|accesstoken|cid|realm|https://graph.microsoft.com/mail.read https://graph.microsoft.com/calendars.read https://graph.microsoft.com/files.read https://graph.microsoft.com/chat.read|';
if (mode === 'plain')
  store[gk] = JSON.stringify({credentialType:'AccessToken', secret: tok, tokenType:'Bearer',
    target:'https://graph.microsoft.com/mail.read https://graph.microsoft.com/calendars.read https://graph.microsoft.com/files.read https://graph.microsoft.com/chat.read', expiresOn: String(future)});
else if (mode === 'encrypted')
  store[gk] = JSON.stringify({credentialType:'AccessToken', data:'ENCRYPTEDblob', nonce:'xx', id:'1'});
else if (mode === 'expired')
  store[gk] = JSON.stringify({credentialType:'AccessToken', secret: tok, target: gk.split('|')[6], expiresOn: String(Math.floor(Date.now()/1000) - 10)});
store['msal.3|acct.realm|env|accesstoken|cid|realm|https://outlook.office.com/mail.readwrite|'] =
  JSON.stringify({credentialType:'AccessToken', secret: 'OUTLOOKtokenNOTGRAPH0123456789abcdef', target:'https://outlook.office.com/mail.readwrite', expiresOn: String(future)}); // fake test token, secret-scan: allow
store['msal.3|acct.realm|env|refreshtoken|cid|||'] = JSON.stringify({credentialType:'RefreshToken', secret: 'REFRESHtokenNEVERTOUCH0123456789'}); // fake test token, secret-scan: allow
const keys = Object.keys(store);
globalThis.localStorage = { get length(){return keys.length;}, key: i => keys[i],
  getItem: k => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null };
globalThis.sessionStorage = { length: 0, key: () => null, getItem: () => null };

globalThis.fetch = async (url, opts) => {
  fs.appendFileSync(d + '/fetch.log', JSON.stringify({url, method: opts.method,
    authBearer: ((opts.headers||{}).Authorization||'') === 'Bearer ' + tok,
    leaksToken: JSON.stringify(opts.headers||{}).indexOf(tok) >= 0 && ((opts.headers||{}).Authorization||'').indexOf(tok) < 0,
    creds: opts.credentials}) + '\n');
  const r = JSON.parse(cp.execFileSync('python3', [d + '/api.py', url]).toString());
  const b64 = r.binary_b64;
  const buf = b64 ? Buffer.from(b64, 'base64') : null;
  return { status: r.status, url: r.url || url, redirected: !!r.url, text: async () => r.body,
    arrayBuffer: async () => buf ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : new ArrayBuffer(0) };
};
// eval on purpose: this runs the exact in-page script chrome-js would, from a
// file this test generated, inside a throwaway mock page. (Not untrusted input.)
const out = eval(fs.readFileSync(script, 'utf8'));
setTimeout(() => {
  fs.writeFileSync(stateFile, JSON.stringify(window.__chewOffice || {}));
  process.stdout.write(String(out));
}, 25);
JS

# The Graph mock. Synthetic mail, calendar, files, a workbook, a Word doc and
# Teams chats. One message, event and chat carry terminal controls and the
# token, to prove the sanitizer and the scrub. Env toggles drive the paging,
# oversize and traversal regression cases.
cat > "$T/api.py" <<'PY'
import base64, json, os, sys, time, urllib.parse
d, tok = os.environ["FAKE_DIR"], os.environ.get("FAKE_TOKEN", "")
sp = urllib.parse.urlsplit(sys.argv[1]); path = sp.path[len("/v1.0"):]
q = dict(urllib.parse.parse_qsl(sp.query))
with open(os.path.join(d, "calls.log"), "a") as f:
    f.write(f"{time.monotonic()} {path}?{sp.query}\n")
status = int(os.environ.get("FAKE_STATUS", "200"))
NASTY = "\x1b[31mred\x1b[0m \x1b]8;;https://evil.example\x07click\x1b]8;;\x07\roverwrite ‮gnp.exe \x9bc1"

def addr(n, a): return {"emailAddress": {"name": n, "address": a}}
body = None; extra = {}

if path == "/me/messages":
    filt = q.get("$filter", "")
    nxt = os.environ.get("FAKE_NEXT", "")
    p = int(q.get("_p", "0"))
    msgs = [
        {"id": "AAA1", "subject": "Midterm review " + NASTY, "from": addr("Prof " + NASTY, "prof@usc.edu"),
         "receivedDateTime": "2026-10-08T17:00:00Z", "isRead": False, "hasAttachments": True,
         "bodyPreview": "see you " + NASTY},
        {"id": "AAA2", "subject": "Read already", "from": addr("Ada Lovelace", "ada@usc.edu"),
         "receivedDateTime": "2026-10-07T12:00:00Z", "isRead": True, "hasAttachments": False, "bodyPreview": "hi"},
    ]
    if "isRead eq false" in filt: msgs = [m for m in msgs if not m["isRead"]]
    if "from/emailAddress/address eq 'ada@usc.edu'" in filt: msgs = [m for m in msgs if m["from"]["emailAddress"]["address"] == "ada@usc.edu"]
    if nxt == "offtemplate":
        body = {"value": msgs[:1], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/sendMail?%24skiptoken=x"}
    elif nxt == "offhost":
        body = {"value": msgs[:1], "@odata.nextLink": "https://evil.example/v1.0/me/messages?%24skiptoken=x"}
    elif nxt == "loop":
        body = {"value": msgs[:1], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/messages?%24skiptoken=SAME"}
    elif nxt == "grow":
        if p < 50:
            body = {"value": msgs[:1], "@odata.nextLink": f"https://graph.microsoft.com/v1.0/me/messages?_p={p+1}&%24skiptoken=S{p+1}"}
        else:
            body = {"value": msgs[:1]}
    elif p == 0 and not filt:
        body = {"value": msgs[:1], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/messages?_p=1&%24top=25"}
    elif p == 1:
        body = {"value": msgs[1:]}
    else:
        body = {"value": msgs}
    if os.environ.get("FAKE_OVERSIZE"):
        extra = {"pad": "x" * 4000}
elif path.startswith("/me/messages/"):
    body = {"subject": "Midterm review", "from": addr("Prof Plum", "prof@usc.edu"),
            "toRecipients": [addr("Caleb", "c@usc.edu")], "receivedDateTime": "2026-10-08T17:00:00Z",
            "isRead": False, "body": {"contentType": "html",
            "content": "<p>Hello <b>Caleb</b></p><p>token " + tok + "</p><script>x</script>" + NASTY}}
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
elif path.startswith("/me/drive/root/search"):
    assert "budget" in path, path
    body = {"value": [{"id": "FILE_XLSX", "name": "budget.xlsx", "file": {"mimeType": "x"},
            "lastModifiedDateTime": "2026-10-05T09:00:00Z", "webUrl": "https://usc-my.sharepoint.com/x"}]}
elif path.startswith("/me/drive/items/"):
    rest = path[len("/me/drive/items/"):]
    item = rest.split("/")[0]
    if rest.endswith("/content"):
        kind = "pptx" if item == "SHARED1" else "docx"
        print(json.dumps({"status": 200, "binary_b64": open(os.path.join(d, kind + ".b64")).read()})); sys.exit(0)
    elif rest.endswith("/workbook/worksheets"):
        body = {"value": [{"id": "s1", "name": "Sheet1", "position": 0}, {"id": "s2", "name": "Totals", "position": 1}]}
    elif "/usedRange" in rest:
        sid = rest.split("worksheets('")[1].split("')")[0]
        grid = [["a", "b"], ["1", "2"]] if sid == "s1" else [["total"], ["3"]]
        body = {"text": grid}
    else:
        name = "budget.xlsx" if item == "FILE_XLSX" else ("shared.pptx" if item == "SHARED1" else "paper.docx")
        body = {"name": name, "file": {"mimeType": "application/octet-stream"}, "size": 1024}
elif path == "/me/chats":
    body = {"value": [{"id": "19:chat1@thread.v2", "topic": "Group Project " + NASTY, "chatType": "group",
            "lastUpdatedDateTime": "2026-10-08T20:00:00Z",
            "lastMessagePreview": {"createdDateTime": "2026-10-08T20:00:00Z",
            "from": {"user": {"displayName": "Tommy " + NASTY}}, "body": {"content": "<p>lunch?</p>"}}}]}
else:
    body = None; status = 404

out = {"status": status, "url": os.environ.get("FAKE_URL", "")}
if body is None:
    out["body"] = ""
else:
    if isinstance(body, dict): body.update(extra)
    out["body"] = json.dumps(body)
print(json.dumps(out))
PY

cat > "$T/chrome-js" <<'PY'
#!/usr/bin/env python3
# Fake chrome-js. --list prints the tabs; anything else runs the real script in
# page.js and logs what came back.
import os, subprocess, sys
d = os.environ["FAKE_DIR"]
args = sys.argv[1:]
assert args[0] == "--real", "chewbacca office must target the real Chrome"
tabs = os.environ.get("FAKE_TABS", "https://outlook.office.com/mail/").split("|")
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

export FAKE_DIR="$T" FAKE_TOKEN="$TOKEN" CHEWBACCA_CHROME_JS="$T/chrome-js" CHEWBACCA_OFFICE_POLL=0.01 \
       CHEWBACCA_CHROME_DIR="$T/no-chrome"
off() { : > "$T/calls.log"; : > "$T/fetch.log"; : > "$T/state.json"; python3 "$OFF" "$@"; }
calls() { grep -c . "$T/calls.log"; }
items() { python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["items"]))'; }

# The verb is wired.
bash "$ROOT/bin/chewbacca" office help 2>&1 | grep -q "Every command is read-only" || no "chewbacca office help is not wired or lost its read-only note"

# mail: parses, carries the Bearer token, pages via @odata.nextLink.
out="$(off mail --json 2>&1)"
printf '%s' "$out" | python3 -c '
import json,sys; d=json.load(sys.stdin); m=d["items"]
assert d["truncated"] is False, d
assert [x["id"] for x in m] == ["AAA1","AAA2"], m
assert m[0]["unread"] and m[0]["has_attachments"] and m[0]["subject"].startswith("Midterm review"), m[0]
assert m[1]["id"] == "AAA2" and not m[1]["unread"], m[1]' || no "mail did not parse or page: $out"
grep -q '"authBearer":true' "$T/fetch.log" || no "the in-page fetch did not carry the Graph token as a Bearer header"
grep -q '"creds":"omit"' "$T/fetch.log" || no "the in-page fetch did not send credentials:omit"
[ "$(calls)" = 2 ] || no "mail made $(calls) calls, want 2 (one page + nextLink)"
grep -q 'IdType' "$T/fetch.log" >/dev/null 2>&1 || true

# The token is never chosen from a non-graph plaintext entry or a refresh token.
grep -q "OUTLOOKtokenNOTGRAPH\|REFRESHtoken" "$T/fetch.log" && no "a non-graph or refresh token was put on the request"

# --unread and --from narrow the Graph $filter.
off mail --unread --json >/dev/null 2>&1
grep -q 'isRead%20eq%20false\|isRead+eq+false' "$T/calls.log" || no "--unread did not add an isRead filter"
off mail --from ada@usc.edu --json | items > "$T/fromout.json" 2>&1
python3 -c 'import json; d=json.load(open("'"$T"'/fromout.json")); assert [m["id"] for m in d]==["AAA2"], d' || no "--from did not filter"

# read: GET only (never a PATCH, so never marks read), HTML stripped, token scrubbed.
out="$(off read AAA1 --json 2>&1)"
printf '%s' "$out" | python3 -c '
import json,sys; d=json.load(sys.stdin)
assert d["subject"] == "Midterm review" and "Caleb" in d["text"], d
assert "<p>" not in d["text"] and "<script>" not in d["text"], d
assert d["was_unread"] is True, d' || no "read did not parse or strip html: $out"
python3 - "$T/fetch.log" <<'PY' || no "read issued a method other than GET (could mark the message read)"
import json, sys
methods = {json.loads(l)["method"] for l in open(sys.argv[1]) if l.strip()}
assert methods == {"GET"}, methods
PY

# calendar: a start/end window, parsed.
out="$(off calendar --days 3 --json 2>&1)"
printf '%s' "$out" | python3 -c '
import json,sys; m=json.load(sys.stdin)["items"]
assert m[0]["subject"].startswith("Lecture") and m[0]["location"]=="SAL 101" and m[0]["organizer"]=="Dr. Who", m
assert m[0]["start"] and m[0]["end"]' || no "calendar did not parse: $out"

# files: recent and search both parse, with webUrl; a shared (remoteItem) file resolves.
out="$(off files --json 2>&1)"
printf '%s' "$out" | python3 -c '
import json,sys; m=json.load(sys.stdin)["items"]
names=[f["name"] for f in m]; assert "budget.xlsx" in names and "shared.pptx" in names, names
assert any(f["id"]=="SHARED1" for f in m) and all("webUrl" in f for f in m), m' || no "files --recent did not parse: $out"
off files --search budget --json | items | python3 -c 'import json,sys; d=json.load(sys.stdin); assert [f["name"] for f in d]==["budget.xlsx"], d' || no "files --search did not filter"

# doc: Excel through the workbook range API, every sheet; Word/PPT through content as text.
out="$(off doc FILE_XLSX --json 2>&1)"
printf '%s' "$out" | python3 -c '
import json,sys; d=json.load(sys.stdin)
assert d["type"]=="excel" and [s["name"] for s in d["sheets"]]==["Sheet1","Totals"], d
assert d["sheets"][0]["text"]=="a\tb\n1\t2" and d["sheets"][1]["text"]=="total\n3", d' || no "doc excel did not use the range API for all sheets: $out"
out="$(off doc FILE_DOCX --json 2>&1)"
printf '%s' "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert "Hello from Word" in d["text"] and "second line" in d["text"], d' || no "doc word did not extract text: $out"
out="$(off doc SHARED1 --json 2>&1)"
printf '%s' "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert "Slide one title" in d["text"] and "Slide two body" in d["text"], d' || no "doc pptx did not extract slide text: $out"

# teams: chat list with topic and preview.
out="$(off teams --json 2>&1)"
printf '%s' "$out" | python3 -c 'import json,sys; m=json.load(sys.stdin)["items"]; assert m[0]["id"]=="19:chat1@thread.v2" and m[0]["topic"].startswith("Group Project") and "lunch" in m[0]["preview"], m' || no "teams did not parse: $out"

# The token never leaves the page: not in the raw return, not in any output, and
# a token echoed inside a body is scrubbed to [redacted] in the page.
cat "$T/returned.log" > "$T/all.out"; for c in mail calendar files teams; do off $c --json >> "$T/all.out" 2>&1; done
off read AAA1 --json >> "$T/all.out" 2>&1
grep -q "$TOKEN" "$T/all.out" && no "the access token left the page"
grep -q "token \[redacted\]" "$T/returned.log" || no "a token echoed in a response body was not scrubbed in the page"

# GET only, and only to the fixed Graph origin, across every command above.
python3 - "$T/fetch.log" <<'PY' || no "a request was not a GET to https://graph.microsoft.com/v1.0"
import json, sys
for line in open(sys.argv[1]):
    if not line.strip(): continue
    r = json.loads(line)
    assert r["method"] == "GET" and r["url"].startswith("https://graph.microsoft.com/v1.0/"), r
    assert not r["leaksToken"], r
PY

# Terminal controls from other people's mail, events and chats never reach plain
# output; --json keeps the raw text, escaped.
off mail > "$T/plain.out" 2>&1; off calendar >> "$T/plain.out" 2>&1; off teams >> "$T/plain.out" 2>&1
python3 - "$T/plain.out" <<'PY2' || no "a terminal control sequence reached plain output"
import re, sys
out = open(sys.argv[1], encoding="utf-8", newline="").read()
assert "Midterm review" in out and "Lecture" in out and "Group Project" in out, out
assert not re.search("[\x00-\x08\x0b-\x1f\x7f-\x9f‪-‮⁦-⁩]", out), repr(out[:400])
PY2
off mail --json | python3 -c 'import json,sys; m=json.load(sys.stdin)["items"]; assert "\x1b[31m" in m[0]["subject"], m[0]' || no "--json no longer carries the raw text"

# The in-page script refuses a path outside the template, before any fetch.
: > "$T/fetch.log"
python3 - "$OFF" "$T/bad.js" <<'PY'
import sys, types, json
m = types.ModuleType("off"); m.__dict__["__file__"] = sys.argv[1]
exec(open(sys.argv[1]).read().replace('if __name__ == "__main__"', 'if False'), m.__dict__)
open(sys.argv[2], "w").write(m.START_JS % {"guard": m.GUARD, "graph": json.dumps(m.GRAPH),
    "graph_origin": json.dumps(m.GRAPH_ORIGIN), "path": json.dumps("/me/sendMail"),
    "key": json.dumps("x"), "tmpl": json.dumps(m.template_regex("/me/messages")),
    "binary": "false", "maxbody": "5000000"})
PY
out="$(FAKE_PAGE=https://outlook.office.com/mail/ node "$T/page.js" "$T/bad.js" "$T/bad-state.json" 2>&1)"
printf '%s' "$out" | grep -q "refused" && [ ! -s "$T/fetch.log" ] || no "the in-page script fetched a non-template path: $out"

# Traversal ids are rejected (strict id charset, then the normalization and
# decoded-path guards), and no request is made. Covers "..", a slash, a
# backslash and a percent-encoded traversal.
for bad in ".." "a/b" 'a\b' "..%2f..%2fsendMail" "x%2e%2e" "a b"; do
  : > "$T/fetch.log"
  out="$(off read "$bad" 2>&1)"; rc=$?
  [ "$rc" != 0 ] || no "traversal id '$bad' was accepted"
  [ -s "$T/fetch.log" ] && no "traversal id '$bad' reached a fetch"
done

# An @odata.nextLink that points off-template or off-host is never followed; the
# walk stops and says truncated, and no request goes to the off-template path.
: > "$T/fetch.log"
out="$(FAKE_NEXT=offtemplate off mail --json 2>&1)"
printf '%s' "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["truncated"] is True and len(d["items"])==1, d' || no "an off-template nextLink was not stopped: $out"
grep -q "sendMail" "$T/fetch.log" && no "a request was made to an off-template nextLink path"
out="$(FAKE_NEXT=offhost off mail --json 2>&1)"
printf '%s' "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["truncated"] is True, d' || no "an off-host nextLink was not stopped: $out"
grep -q "evil.example" "$T/fetch.log" && no "a request was made to an off-host nextLink"

# A nextLink that repeats itself is a cycle: it is detected and stops after the
# second fetch, well before the page cap.
out="$(FAKE_NEXT=loop off mail --json 2>&1)"
printf '%s' "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["truncated"] is True, d' || no "a nextLink cycle was not reported truncated: $out"
[ "$(calls)" = 2 ] || no "a nextLink cycle made $(calls) calls, want 2 (cycle caught on the repeat)"

# Ever-changing nextLinks are bounded by the page cap, not followed forever.
out="$(CHEWBACCA_OFFICE_MAXPAGES=3 FAKE_NEXT=grow off mail --json 2>&1)"
printf '%s' "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["truncated"] is True, d' || no "growing nextLinks did not report truncated: $out"
[ "$(calls)" = 3 ] || no "growing nextLinks made $(calls) calls, want 3 (the page cap)"

# A response larger than the byte cap is refused whole, with a clear message and
# no crash or hang.
out="$(CHEWBACCA_OFFICE_MAXBYTES=500 FAKE_OVERSIZE=1 off mail 2>&1)"; rc=$?
[ "$rc" != 0 ] || no "an oversize response was not refused (rc $rc)"
printf '%s' "$out" | grep -qi "cap" || no "an oversize response had no cap message: $out"

# Pushback stops on the first answer, with no retry and no second call.
for case in "FAKE_STATUS=401" "FAKE_STATUS=403" "FAKE_STATUS=429" \
            "FAKE_URL=https://login.microsoftonline.com/common/oauth2/v2.0/authorize" \
            "FAKE_URL=https://outlook.office.com/owa/logout.owa"; do
  : > "$T/calls.log"
  out="$(env "$case" python3 "$OFF" mail --limit 5 2>&1)"; rc=$?
  [ "$rc" = 4 ] || no "$case: exit $rc, want 4: $out"
  printf '%s' "$out" | grep -q "STOPPED" || no "$case: no STOPPED line: $out"
  [ "$(calls)" = 1 ] || no "$case: made $(calls) calls after pushback, want 1"
done

# No usable Graph token in the page stops with BLOCKED and makes no request.
for mode in encrypted none expired; do
  : > "$T/fetch.log"
  out="$(FAKE_TOKEN_MODE=$mode off mail 2>&1)"; rc=$?
  [ "$rc" = 4 ] || no "token mode $mode: exit $rc, want 4 (BLOCKED): $out"
  printf '%s' "$out" | grep -q "STOPPED" || no "token mode $mode: no STOPPED line: $out"
  [ -s "$T/fetch.log" ] && no "token mode $mode: a request was made with no usable token"
done

# Decoy tabs. Only https with a netloc of exactly an allowed host counts; an
# allowed host in a query, path, lookalike host, userinfo or port is a decoy,
# and no script may run in it. With no real tab, the real one is opened.
for decoy in "https://evil.example/?next=outlook.office.com" "https://evil.example/outlook.office.com/mail" \
             "https://outlook.office.com.evil.example/mail" "https://eviloutlook.office.com/mail" \
             "http://outlook.office.com/mail" "https://outlook.office.com@evil.example/mail" \
             "https://outlook.office.com:8443/mail"; do
  : > "$T/targets.log"; : > "$T/open.log"
  out="$(FAKE_TABS="$decoy" off mail 2>&1)"; rc=$?
  [ "$rc" != 0 ] || no "decoy tab $decoy was accepted"
  [ -s "$T/targets.log" ] && no "a script ran in decoy tab $decoy"
  [ "$(cat "$T/open.log")" = "https://outlook.office.com/mail/" ] || no "with only decoy $decoy, Office was not opened"
done
: > "$T/targets.log"
FAKE_TABS="https://evil.example/?outlook.office.com|https://m365.cloud.microsoft/chat" off mail >/dev/null 2>&1 \
  || no "the real Office tab behind a decoy was not used"
grep -qv -E '^https://(outlook\.office\.com|m365\.cloud\.microsoft)' "$T/targets.log" && no "a script was sent to a tab other than an allowed Office one"

# An allowed host other than the default is accepted on its own origin.
: > "$T/fetch.log"
FAKE_TABS="https://m365.cloud.microsoft/chat" FAKE_ORIGIN="https://m365.cloud.microsoft" off mail --json >/dev/null 2>&1 \
  && grep -q '"authBearer":true' "$T/fetch.log" || no "an m365.cloud.microsoft tab was not accepted"

# The page reports a disallowed origin: the in-page guard fetches nothing, and
# the Python side refuses the answer.
: > "$T/fetch.log"
out="$(FAKE_ORIGIN=https://evil.example off mail 2>&1)"; rc=$?
[ "$rc" = 5 ] || no "an answer from origin https://evil.example was accepted (rc $rc): $out"
[ -s "$T/fetch.log" ] && no "the in-page script fetched from a page whose origin is not an Office host"

grep -q 'PAUSE = max(1.0' "$OFF" || no "the 1 s throttle floor is gone"
grep -q 'GRAPH = "https://graph.microsoft.com/v1.0"' "$OFF" || no "the fixed Graph origin changed"
grep -q 'MAX_DOC_CHARS' "$OFF" || no "the per-document character cap is gone"

[ "$fail" -eq 0 ] && echo "chewbacca office: ok"
exit "$fail"
