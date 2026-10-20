#!/bin/bash
# Close what LockDown Browser blocklists before it opens, so it has nothing to
# kill. On 2026-10-19 it was handed ~70 processes (Claude, Slack, Spotify, Loom,
# Ollama, llama-server) on a Mac already at load 7 with an iOS simulator up, its
# "Close Applications and Continue" froze the machine, and it needed a hard restart.
# No model or network calls. --dry-run lists what would close.
set -u
dry=0
[ "${1:-}" = "--dry-run" ] && dry=1

apps=(Claude Slack Spotify Loom WhatsApp Ollama Preview Simulator Xcode Discord
      Messages Zoom.us "ChatGPT" Notion "Visual Studio Code" Cursor Codex)
procs=(llama-server ollama node_repl ShipIt loom-recorder-production claude
       disclaimer hud-speak)

# Asks AppleScript, since pgrep -x missed the Claude app on 2026-10-19.
running_apps() {
  for app in "${apps[@]}"; do
    [ "$(/usr/bin/osascript -e "application \"$app\" is running" 2>/dev/null)" = true ] && echo "$app"
  done
}

if [ "$dry" = 1 ]; then
  echo "Would quit:"; running_apps
  echo "Would stop:"; for p in "${procs[@]}"; do /usr/bin/pgrep -x "$p" >/dev/null && echo "$p"; done
  exit 0
fi

# Ask apps to quit first so they save state.
running_apps | while read -r app; do
  /usr/bin/osascript -e "tell application \"$app\" to quit" >/dev/null 2>&1 &
done
/usr/bin/xcrun simctl shutdown all >/dev/null 2>&1
sleep 8
for p in "${procs[@]}"; do /usr/bin/pkill -x "$p" 2>/dev/null; done
sleep 2
# Anything still up after a polite quit gets stopped, so LockDown has no list.
running_apps | while read -r app; do /usr/bin/pkill -f "/$app.app/Contents/MacOS/" 2>/dev/null; done
for p in "${procs[@]}"; do /usr/bin/pkill -9 -x "$p" 2>/dev/null; done
/usr/bin/osascript -e 'display notification "Open the quiz in Brightspace now" with title "Quiz Mode ready"' 2>/dev/null
