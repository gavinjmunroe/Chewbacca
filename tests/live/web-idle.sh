#!/bin/bash
# Live: chewie web's idle Chrome closes itself and keeps at most 4 tabs.
# chewie web's Chrome closes itself once idle and never piles up tabs. On
# 2026-10-19 two bridge Chromes ran 6 and 7.5 hours after their last call, one
# with 20 renderers, while the Mac sat at load 280 and 11 of 12 GB of swap.
# Live: starts a real headless Chrome on its own port and throwaway profile.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WEB="$ROOT/mac/bridge/web.js"
DEPS=""
for d in "$ROOT/mac/bridge/node_modules" "$HOME/code/chewbacca/mac/bridge/node_modules" "$HOME/.chewbacca/kit/current/mac/bridge/node_modules"; do
  [ -d "$d/chrome-remote-interface" ] && { DEPS="$d"; break; }
done
[ -n "$DEPS" ] || { echo "SKIP  web bridge deps not installed"; exit 77; }
[ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ] || { echo "SKIP  no Chrome"; exit 77; }
T=$(mktemp -d)
PORT=9555
export NODE_PATH="$DEPS" CHEWIE_WEB_DIR="$T/profile" CHEWIE_CDP_PORT=$PORT CHEWIE_WEB_IDLE_S=5
mkdir -p "$CHEWIE_WEB_DIR"
up() { curl -s -m 1 "http://127.0.0.1:$PORT/json/version" >/dev/null; }
cleanup() { node "$WEB" close >/dev/null 2>&1; rm -rf "$T"; }
trap cleanup EXIT
fail=0

node "$WEB" tabs >/dev/null || { echo "FAIL  bridge Chrome never came up"; exit 1; }
up && echo "ok    bridge Chrome is up on $PORT" || { echo "FAIL  not up"; exit 1; }
# The watcher is spawned detached and writes its pid a moment later.
for i in 1 2 3 4 5 6 7 8 9 10; do [ -f "$CHEWIE_WEB_DIR/.chewie-watch.pid" ] && break; sleep 0.5; done
[ -f "$CHEWIE_WEB_DIR/.chewie-watch.pid" ] && kill -0 "$(cat "$CHEWIE_WEB_DIR/.chewie-watch.pid")" 2>/dev/null \
  && echo "ok    an idle watcher started with it" || { echo "FAIL  no idle watcher"; fail=1; }

for i in 1 2 3 4 5 6; do node "$WEB" read "data:text/html,<p>page$i</p>" >/dev/null 2>&1; done
n=$(node "$WEB" tabs | grep -c '"url"')
[ "$n" -le 4 ] && echo "ok    six reads leave $n tabs (cap 4)" || { echo "FAIL  $n tabs after six reads"; fail=1; }

for i in $(seq 1 30); do up || break; sleep 2; done
up && { echo "FAIL  bridge Chrome still up 60s after a 5s idle limit"; fail=1; } || echo "ok    idle bridge Chrome closed itself"
# mutant : the cap check above has to be able to fail.
[ 99 -le 4 ] && { echo "FAIL  the tab cap passes 99 tabs"; fail=1; } || echo "mut   99 tabs fails the cap check"
exit $fail
