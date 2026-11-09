#!/bin/bash
# chewie web's Chrome never takes the screen unless a person asks for it.
# 2026-10-11: the bridge launched a windowed Chrome that jumped in front of
# Caleb on every read ("Make sure chewbs never flash bangs anyone ever again").
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/mac/bridge/web.js"
fail=0
# The bridge needs its npm deps to load; a checkout without them skips, loudly.
DEPS=""
for d in "$ROOT/mac/bridge/node_modules" "$HOME/code/chewbacca/mac/bridge/node_modules" "$HOME/.chewbacca/kit/current/mac/bridge/node_modules"; do
  [ -d "$d/chrome-remote-interface" ] && { DEPS="$d"; break; }
done
if [ -z "$DEPS" ]; then
  echo "SKIP  web bridge deps not installed (npm install in mac/bridge)"
  exit 0
fi
args() { NODE_PATH="$DEPS" env "$@" node "$WEB" launch-args; }
out="$(args -u CHEWIE_WEB_VISIBLE)"
if printf '%s' "$out" | grep -q -- '--headless=new'; then echo "ok    the bridge Chrome launches headless by default"; else echo "FAIL  no --headless=new by default: $out"; fail=1; fi
out="$(args CHEWIE_WEB_VISIBLE=1)"
if printf '%s' "$out" | grep -q -- '--headless'; then echo "FAIL  CHEWIE_WEB_VISIBLE=1 still headless"; fail=1; else echo "ok    CHEWIE_WEB_VISIBLE=1 shows a window for a person's sign-in"; fi
grep -q 'spawn(CHROME, launchArgs()' "$WEB" && echo "ok    the one launch site uses launchArgs" || { echo "FAIL  Chrome is spawned somewhere without launchArgs"; fail=1; }
# The other spawn is the idle watcher (node itself), which never opens Chrome.
[ "$(grep -c 'spawn(CHROME' "$WEB")" = "1" ] && [ "$(grep -c 'spawn(' "$WEB")" = "2" ] && grep -q 'spawn(process.execPath, \[__filename, "idle-watch"\]' "$WEB" \
  && echo "ok    there is exactly one Chrome launch" || { echo "FAIL  a spawn in web.js besides the Chrome launch and its idle watcher"; fail=1; }
grep -q 'runningHeadless' "$WEB" && echo "ok    a windowed bridge Chrome left running is replaced" || { echo "FAIL  no check on an already-running windowed Chrome"; fail=1; }
exit $fail
