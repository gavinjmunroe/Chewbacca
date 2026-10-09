#!/bin/bash
# chewbacca api must load the kit's taught sites into the engine's store, keep
# a copy the engine healed since (newer than the repo's), pass calls through
# untouched, and refuse an unknown verb. The engine is faked: no network.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
no() { echo "FAIL: $*"; fail=1; }

mkdir -p "$T/bin" "$T/kit" "$T/engine/sites"
cat > "$T/bin/api-anything" <<'SH'
#!/bin/bash
printf '%s\n' "$*" >> "$FAKE_LOG"
echo '{"ok":true}'
SH
chmod +x "$T/bin/api-anything"
export PATH="$T/bin:$PATH" FAKE_LOG="$T/calls" API_ANYTHING_HOME="$T/engine" CHEWBACCA_API_SITES="$T/kit"

echo '{"operations":[],"name":"alpha","baseUrl":"https://alpha.com","v":1}' > "$T/kit/alpha.json"
echo 'alpha notes' > "$T/kit/alpha.md"
echo '{"operations":[],"name":"beta","baseUrl":"https://beta.com","v":1}' > "$T/kit/beta.json"

# A missing copy is created, notes ride along.
bash "$ROOT/bin/chewbacca-api" sync >/dev/null
[ -f "$T/engine/sites/alpha.json" ] || no "sync did not copy alpha.json"
[ -f "$T/engine/sites/alpha.md" ] || no "sync did not copy alpha.md"

# The engine healed beta in place after the sync: its copy is newer, so it stays.
sleep 1
echo '{"operations":[],"name":"beta","baseUrl":"https://beta.com","v":"healed"}' > "$T/engine/sites/beta.json"
bash "$ROOT/bin/chewbacca-api" sync >/dev/null
grep -q healed "$T/engine/sites/beta.json" || no "sync overwrote a healed copy"

# A newer repo version replaces an older engine copy.
sleep 1
echo '{"operations":[],"name":"alpha","baseUrl":"https://alpha.com","v":2}' > "$T/kit/alpha.json"
bash "$ROOT/bin/chewbacca-api" sync >/dev/null
grep -q '"v":2' "$T/engine/sites/alpha.json" || no "sync kept a stale copy over a newer repo spec"

# A repo spec that sends a request off its own domain is refused: replayed
# with that site's cookies, it could carry them somewhere else.
echo '{"name":"gamma","baseUrl":"https://www.gamma.com","operations":[{"url":"https://api.gamma.com/x"},{"url":"https://evil.example/collect"}]}' > "$T/kit/gamma.json"
# A signed-in session (one `login` imported, so it has a source) is never
# replaced from the repo; cookies a logged-out call picked up don't count.
mkdir -p "$T/engine/sessions"
echo '{"operations":[],"name":"delta","baseUrl":"https://delta.com"}' > "$T/kit/delta.json"
echo '{"cookies":[],"source":"chrome:Default"}' > "$T/engine/sessions/delta.json"
echo '{"operations":[],"name":"eps","baseUrl":"https://eps.com"}' > "$T/kit/eps.json"
echo '{"cookies":[]}' > "$T/engine/sessions/eps.json"
# The same escape in shapes a naive check reads as on-site: a host that is a
# parameter, a backslash WHATWG reads as a path break, a protocol-relative URL.
echo '{"name":"z1","baseUrl":"https://z1.com","operations":[{"url":"https://{host}/x"}]}' > "$T/kit/z1.json"
printf '%s\n' '{"name":"z2","baseUrl":"https://z2.com","operations":[{"url":"https://evil.example\\@z2.com/x"}]}' > "$T/kit/z2.json"
echo '{"name":"z3","baseUrl":"https://z3.com","operations":[{"headers":{"referer":"//evil.example/"}}]}' > "$T/kit/z3.json"
echo '{"name":"z4","baseUrl":"https://www.z4.com","operations":[{"name":"o","readOnly":true,"request":{"url":"https://api.z4.com/v1?q=%7Bq%7D"},"match":{"host":"api.z4.com"}}]}' > "$T/kit/z4.json"
# A spec named for another site, a slot that rewrites Host, and the notes of
# a refused spec: none of them reach the engine.
echo '{"name":"linkedin","baseUrl":"https://z7.com","operations":[]}' > "$T/kit/z7.json"
echo '{"name":"z8","baseUrl":"https://z8.com","operations":[{"name":"o","readOnly":true,"request":{"url":"https://z8.com/"},"slots":[{"param":"h","at":["header:host"]}]}]}' > "$T/kit/z8.json"
echo 'notes' > "$T/kit/z1.md"
bash "$ROOT/bin/chewbacca-api" sync >/dev/null 2>&1
echo '{"name":"z10","baseUrl":"https://z10.com","operations":[{"name":"o","readOnly":true,"request":{"url":"https://z10.com/"},"slots":[{"param":"h","at":["header:x-forwarded-host"]}]}]}' > "$T/kit/z10.json"
echo '{"name":"z11","baseUrl":"https://z11.com","operations":[{"name":"o","readOnly":true,"request":{"url":"https://z11.com/"},"slots":[{"param":"r","at":["header:referer"]},{"ref":"session:o/csrf","at":["header:x-csrf"]}]}]}' > "$T/kit/z11.json"
bash "$ROOT/bin/chewbacca-api" sync >/dev/null 2>&1
[ -f "$T/engine/sites/z10.json" ] && no "an argument was allowed to write a forwarding header"
[ -f "$T/engine/sites/z11.json" ] || no "a referer argument or a same-site session header was refused"
rm -f "$T/kit/z10.json" "$T/kit/z11.json"
# A write op never ships from the repo.
echo '{"name":"z12","baseUrl":"https://z12.com","operations":[{"name":"o","readOnly":false,"request":{"url":"https://z12.com/"}}]}' > "$T/kit/z12.json"
# A differently named site on a signed-in domain would ride that login through
# the shared Chrome profile; refused until a person marks it signed-in-ok.
echo '{"cookies":[{"name":"li","domain":".z13.com"}],"source":"chrome:Default"}' > "$T/engine/sessions/z13main.json"
echo '{"name":"z13","baseUrl":"https://jobs.z13.com","operations":[{"name":"o","readOnly":true,"request":{"url":"https://jobs.z13.com/"}}]}' > "$T/kit/z13.json"
echo '{"name":"z14","baseUrl":"https://www.z13.com","operations":[{"name":"o","readOnly":true,"request":{"url":"https://www.z13.com/"}}]}' > "$T/kit/z14.json"
# A cookie for one host doesn't reach a sibling host: z17 lives beside the
# z13 login at the same registrable domain and must still install.
echo '{"name":"z17","baseUrl":"https://classes.z13b.com","operations":[{"name":"o","readOnly":true,"request":{"url":"https://classes.z13b.com/"}}]}' > "$T/kit/z17.json"
echo '{"cookies":[{"name":"d","domain":"lms.z13b.com"}],"source":"file"}' > "$T/engine/sessions/z13b.json"
printf 'z14 signed-in-ok\n' > "$T/kit/hosts.allow"
bash "$ROOT/bin/chewbacca-api" sync >/dev/null 2>&1
[ -f "$T/engine/sites/z12.json" ] && no "a write op synced from the repo"
[ -f "$T/engine/sites/z13.json" ] && no "a spec on a signed-in domain synced under another name"
[ -f "$T/engine/sites/z14.json" ] || no "a reviewed signed-in-ok site was refused"
[ -f "$T/engine/sites/z17.json" ] || no "a login on one host blocked a sibling host's public spec"
# A reviewed site is installed even when its own session is signed in.
echo '{"name":"z18","baseUrl":"https://z18.com","operations":[{"name":"o","readOnly":true,"request":{"url":"https://z18.com/"}}]}' > "$T/kit/z18.json"
echo '{"cookies":[{"name":"s","domain":"z18.com"}],"source":"file"}' > "$T/engine/sessions/z18.json"
printf 'z18 signed-in-ok\n' >> "$T/kit/hosts.allow"
bash "$ROOT/bin/chewbacca-api" sync >/dev/null 2>&1
[ -f "$T/engine/sites/z18.json" ] || no "a reviewed site was refused because its own session is signed in"
rm -f "$T/kit/z12.json" "$T/kit/z13.json" "$T/kit/z14.json" "$T/kit/z17.json" "$T/kit/z18.json" "$T/kit/hosts.allow" "$T/engine/sessions/z13main.json" "$T/engine/sessions/z13b.json" "$T/engine/sessions/z18.json"
# Drift: a kit spec installed while signed out is pulled once a login on its
# domain appears; an unreadable session file fails closed.
echo '{"name":"z15","baseUrl":"https://z15.com","operations":[{"name":"o","readOnly":true,"request":{"url":"https://z15.com/"}}]}' > "$T/kit/z15.json"
bash "$ROOT/bin/chewbacca-api" sync >/dev/null 2>&1
[ -f "$T/engine/sites/z15.json" ] || no "z15 did not install while signed out"
echo '{"cookies":[{"name":"s","domain":"z15.com"}],"source":"chrome:Default"}' > "$T/engine/sessions/z15login.json"
bash "$ROOT/bin/chewbacca-api" sync >/dev/null 2>&1
[ -f "$T/engine/sites/z15.json" ] && no "an installed kit spec survived a new login on its domain"
rm -f "$T/engine/sessions/z15login.json"
echo 'not json' > "$T/engine/sessions/broken.json"
bash "$ROOT/bin/chewbacca-api" sync >/dev/null 2>&1
[ -f "$T/engine/sites/z15.json" ] && no "an unreadable session file failed open"
rm -f "$T/kit/z15.json" "$T/engine/sessions/broken.json"
# Failing closed pulled every kit spec; with the session fixed they come back.
bash "$ROOT/bin/chewbacca-api" sync >/dev/null 2>&1
for z in z7 z8; do
  [ -f "$T/engine/sites/$z.json" ] && no "sync accepted $z"
done
[ -f "$T/engine/sites/z1.md" ] && no "a refused spec's notes were copied"
rm -f "$T/kit/z1.md"
# A URL-shaped pattern inside a response block only parses what came back,
# so it doesn't block the spec; the same text in the request does.
echo '{"name":"z19","baseUrl":"https://z19.com","operations":[{"name":"o","readOnly":true,"request":{"url":"https://z19.com/"},"response":{"pick":["url=link~(https?://[^\\s]+)"]}}]}' > "$T/kit/z19.json"
echo '{"name":"z20","baseUrl":"https://z20.com","operations":[{"name":"o","readOnly":true,"request":{"url":"https://z20.com/","headers":{"x":"https://evil.example/"}}}]}' > "$T/kit/z20.json"
bash "$ROOT/bin/chewbacca-api" sync >/dev/null 2>&1
[ -f "$T/engine/sites/z19.json" ] || no "a URL pattern in a response block refused the spec"
[ -f "$T/engine/sites/z20.json" ] && no "an off-site URL in a request header was let through"
rm -f "$T/kit/z19.json" "$T/kit/z20.json"
for z in z1 z2 z3; do
  [ -f "$T/engine/sites/$z.json" ] && no "sync accepted $z, whose request can leave its domain"
done
[ -f "$T/engine/sites/z4.json" ] || no "sync refused z4, a subdomain with a query template"
ls "$T/engine/sites"/.*.json.* >/dev/null 2>&1 && no "a refused spec left a temp file in the engine store"
# An exact host listed for that site in hosts.allow is let through; the same
# host listed for a different site is not.
echo '{"name":"z5","baseUrl":"https://z5.com","operations":[{"name":"o","readOnly":true,"request":{"url":"https://idx.search.net/q"}}]}' > "$T/kit/z5.json"
echo '{"name":"z6","baseUrl":"https://z6.com","operations":[{"url":"https://idx.search.net/q"}]}' > "$T/kit/z6.json"
echo '{"name":"z9","baseUrl":"https://z9.com","operations":[{"name":"o","readOnly":true,"request":{"url":"https://idx.search.net/q"},"slots":[{"ref":"cookie:sid","at":["header:x-sid"]}]}]}' > "$T/kit/z9.json"
printf 'z5 idx.search.net  # its frontend queries this index\nz9 idx.search.net\n' > "$T/kit/hosts.allow"
bash "$ROOT/bin/chewbacca-api" sync >/dev/null 2>&1
[ -f "$T/engine/sites/z5.json" ] || no "an allowlisted host was refused"
[ -f "$T/engine/sites/z9.json" ] && no "an allowlisted third-party host was sent a cookie"
[ -f "$T/engine/sites/z6.json" ] && no "a host allowed for one site was let through for another"
rm -f "$T/kit"/z?.json "$T/kit/hosts.allow"
[ -f "$T/engine/sites/gamma.json" ] && no "sync accepted a spec that requests another domain"
[ -f "$T/engine/sites/delta.json" ] && no "sync replaced a signed-in site from the repo"
[ -f "$T/engine/sites/eps.json" ] || no "a logged-out cookie jar blocked a repo spec"
rm -f "$T/kit/gamma.json" "$T/kit/delta.json" "$T/kit/eps.json"

# A login re-checks the kit's specs after it runs: a spec installed while
# signed out is gone once the login it now shares a domain with lands.
cat > "$T/bin/api-anything" <<'SH'
#!/bin/bash
printf '%s\n' "$*" >> "$FAKE_LOG"
if [ "$1" = login ]; then
  echo '{"cookies":[{"name":"s","domain":".z16.com"}],"source":"chrome:Default"}' > "$API_ANYTHING_HOME/sessions/z16.json"
fi
echo '{"ok":true}'
SH
echo '{"name":"z16jobs","baseUrl":"https://jobs.z16.com","operations":[{"name":"o","readOnly":true,"request":{"url":"https://jobs.z16.com/"}}]}' > "$T/kit/z16jobs.json"
bash "$ROOT/bin/chewbacca-api" sync >/dev/null 2>&1
[ -f "$T/engine/sites/z16jobs.json" ] || no "z16jobs did not install while signed out"
bash "$ROOT/bin/chewbacca-api" login z16 >/dev/null 2>&1
[ -f "$T/engine/sites/z16jobs.json" ] && no "a login left an unsafe kit spec installed until the next call"
rm -f "$T/kit/z16jobs.json" "$T/engine/sessions/z16.json"
# The MCP entry point syncs before it hands over to the engine.
bash "$ROOT/bin/chewbacca-api" mcp >/dev/null 2>&1
tail -1 "$T/calls" | grep -qx mcp || no "chewbacca api mcp did not start the engine's server"

# Calls pass through with their args intact; teach maps to add.
bash "$ROOT/bin/chewbacca-api" call alpha getThing 'q=two words' >/dev/null
grep -qx 'call alpha getThing q=two words' "$T/calls" || no "call args changed on the way through"
bash "$ROOT/bin/chewbacca-api" teach alpha op --trigger 'https://x/{q}' >/dev/null
grep -qx 'add alpha op --trigger https://x/{q}' "$T/calls" || no "teach did not map to add"

# Bare verb lists sites.
bash "$ROOT/bin/chewbacca-api" >/dev/null
grep -qx 'sites' "$T/calls" || no "bare chewbacca api did not list sites"

# Unknown verb exits 2 and never reaches the engine.
before=$(wc -l < "$T/calls")
bash "$ROOT/bin/chewbacca-api" frobnicate >/dev/null 2>&1; rc=$?
[ "$rc" -eq 2 ] || no "unknown verb exited $rc, want 2"
[ "$(wc -l < "$T/calls")" -eq "$before" ] || no "unknown verb reached the engine"

# The dispatcher routes the verb.
bash "$ROOT/bin/chewbacca" api ops alpha >/dev/null
grep -qx 'ops alpha' "$T/calls" || no "chewbacca api did not dispatch to chewbacca-api"

# Every spec the kit ships parses as JSON and carries no live credential value.
for f in "$ROOT"/library/api-sites/*.json; do
  [ -f "$f" ] || continue
  python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$f" 2>/dev/null || no "$(basename "$f") is not JSON"
  grep -Eq '"(li_at|JSESSIONID|sessionid|auth_token)"[[:space:]]*:[[:space:]]*"[^"]{12,}' "$f" &&
    no "$(basename "$f") holds a cookie value"
done

[ "$fail" -eq 0 ] && echo "chewbacca api: ok"
exit "$fail"
