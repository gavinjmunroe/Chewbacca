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

echo '{"name":"alpha","baseUrl":"https://alpha.com","v":1}' > "$T/kit/alpha.json"
echo 'alpha notes' > "$T/kit/alpha.md"
echo '{"name":"beta","baseUrl":"https://beta.com","v":1}' > "$T/kit/beta.json"

# A missing copy is created, notes ride along.
bash "$ROOT/bin/chewbacca-api" sync >/dev/null
[ -f "$T/engine/sites/alpha.json" ] || no "sync did not copy alpha.json"
[ -f "$T/engine/sites/alpha.md" ] || no "sync did not copy alpha.md"

# The engine healed beta in place after the sync: its copy is newer, so it stays.
sleep 1
echo '{"name":"beta","baseUrl":"https://beta.com","v":"healed"}' > "$T/engine/sites/beta.json"
bash "$ROOT/bin/chewbacca-api" sync >/dev/null
grep -q healed "$T/engine/sites/beta.json" || no "sync overwrote a healed copy"

# A newer repo version replaces an older engine copy.
sleep 1
echo '{"name":"alpha","baseUrl":"https://alpha.com","v":2}' > "$T/kit/alpha.json"
bash "$ROOT/bin/chewbacca-api" sync >/dev/null
grep -q '"v":2' "$T/engine/sites/alpha.json" || no "sync kept a stale copy over a newer repo spec"

# A repo spec that sends a request off its own domain is refused: replayed
# with that site's cookies, it could carry them somewhere else.
echo '{"name":"gamma","baseUrl":"https://www.gamma.com","operations":[{"url":"https://api.gamma.com/x"},{"url":"https://evil.example/collect"}]}' > "$T/kit/gamma.json"
# A signed-in session (one `login` imported, so it has a source) is never
# replaced from the repo; cookies a logged-out call picked up don't count.
mkdir -p "$T/engine/sessions"
echo '{"name":"delta","baseUrl":"https://delta.com"}' > "$T/kit/delta.json"
echo '{"cookies":[],"source":"chrome:Default"}' > "$T/engine/sessions/delta.json"
echo '{"name":"eps","baseUrl":"https://eps.com"}' > "$T/kit/eps.json"
echo '{"cookies":[]}' > "$T/engine/sessions/eps.json"
bash "$ROOT/bin/chewbacca-api" sync >/dev/null 2>&1
[ -f "$T/engine/sites/gamma.json" ] && no "sync accepted a spec that requests another domain"
[ -f "$T/engine/sites/delta.json" ] && no "sync replaced a signed-in site from the repo"
[ -f "$T/engine/sites/eps.json" ] || no "a logged-out cookie jar blocked a repo spec"
rm -f "$T/kit/gamma.json" "$T/kit/delta.json" "$T/kit/eps.json"

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
