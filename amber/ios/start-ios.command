#!/bin/bash
set -euo pipefail
app_dir="/Users/sagartiwari/dev/amber-ios-sagar-main/apps/mobile"
node_bin="/usr/local/bin/node"
if [[ ! -f "$app_dir/../../node_modules/expo/bin/cli" ]]; then
  echo "The local Amber checkout is missing: $app_dir"
  exit 1
fi
if [[ "$(curl -fsS --max-time 2 http://127.0.0.1:8081/status 2>/dev/null || true)" == "packager-status:running" ]]; then
  echo "Metro is already running. Opening the installed Amber app."
  open -a Simulator
  xcrun simctl launch booted com.joinrytual.amber
  exit 0
fi
cd "$app_dir"
export EXPO_OFFLINE=1 EXPO_PUBLIC_DESIGN_PREVIEW=1
"$node_bin" ../../node_modules/expo/bin/cli start --localhost --port 8081 --max-workers 2 &
metro_pid=$!
trap 'kill "$metro_pid" 2>/dev/null || true' EXIT
trap 'exit 130' INT TERM
for attempt in {1..60}; do
  kill -0 "$metro_pid" 2>/dev/null || { wait "$metro_pid"; exit 1; }
  if [[ "$(curl -fsS --max-time 1 http://127.0.0.1:8081/status 2>/dev/null || true)" == "packager-status:running" ]]; then
    open -a Simulator
    xcrun simctl launch booted com.joinrytual.amber || echo "Choose an iPhone in Simulator, then open Amber."
    echo "Keep this terminal open. Reload Amber to restart the design walkthrough."
    wait "$metro_pid"
    exit 0
  fi
  sleep 1
done
echo "Metro did not become ready. See the startup error above."
exit 1
