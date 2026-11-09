#!/usr/bin/env bash
# seo-check names a noindex before anything else. The draft site copies
# firmfoundation.tech on 2026-11-02: noindex header and meta, robots.txt
# disallowing everything, and no sitemap.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"
mkdir -p "$T/draft" "$T/live"
printf '<html><head><meta name="robots" content="noindex, nofollow"/></head></html>' > "$T/draft/index.html"
printf 'User-Agent: *\nDisallow: /\n' > "$T/draft/robots.txt"
printf '<html><head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization"},{"@type":"WebSite"}]}</script></head></html>' > "$T/live/index.html"
printf 'User-Agent: *\nAllow: /\n' > "$T/live/robots.txt"
printf '<urlset/>' > "$T/live/sitemap.xml"
printf '# Site\n' > "$T/live/llms.txt"
PORT=$(/usr/bin/python3 -c "import socket;s=socket.socket();s.bind(('127.0.0.1',0));print(s.getsockname()[1])")
(cd "$T/draft" && exec /usr/bin/python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1) & D=$!
(cd "$T/live" && exec /usr/bin/python3 -m http.server $((PORT+1)) --bind 127.0.0.1 >/dev/null 2>&1) & L=$!
trap 'kill $D $L 2>/dev/null; wait 2>/dev/null; rm -rf "$T"' EXIT
for p in "$PORT" $((PORT+1)); do for _ in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$p/" && break; sleep 0.1; done; done
fail=0
draft="$(/usr/bin/python3 "$ROOT/bin/seo-check" "http://127.0.0.1:$PORT/")"; dcode=$?
live="$(/usr/bin/python3 "$ROOT/bin/seo-check" "http://127.0.0.1:$((PORT+1))/")"; lcode=$?
[ "$dcode" = 2 ] || { echo "FAIL: draft exit $dcode, want 2"; fail=1; }
printf '%s' "$draft" | grep -q '"indexable": false' || { echo "FAIL: draft read as indexable: $draft"; fail=1; }
printf '%s' "$draft" | grep -q '"first_fix": "the page says noindex' || { echo "FAIL: noindex not named first: $draft"; fail=1; }
[ "$lcode" = 0 ] || { echo "FAIL: live exit $lcode, want 0"; fail=1; }
printf '%s' "$live" | grep -q '"sitemap": 200' || { echo "FAIL: sitemap not seen: $live"; fail=1; }
printf '%s' "$live" | grep -q '"json_ld": \["Organization", "WebSite"\]' || { echo "FAIL: schema types missing: $live"; fail=1; }
[ "$fail" = 0 ] && echo "seo-check: ok"
exit $fail
