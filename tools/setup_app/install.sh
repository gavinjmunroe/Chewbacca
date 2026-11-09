#!/bin/bash
# What the double-click "Chewbacca Setup" app runs. No Terminal window, ever.
#
#   install.sh <payload.tar.gz>
#
# Built into the app by tools/build_setup_app.sh. The person this is for has a
# Mac and a Claude subscription and has never opened Terminal, so every word it
# shows is plain, every question has a safe default, and the only windows it
# opens are its own small dialogs, Apple's developer tools installer when
# python3 is missing, and the Claude app at the end.
#
# CHEWBACCA_SETUP_HEADLESS=1 answers every dialog with its default and prints
# instead of showing anything, which is how tests/setup_app.sh drives it.
set -uo pipefail

PAYLOAD="${1:?payload path}"
HERE="$(cd "$(dirname "$0")" && pwd)"
APPS="${CHEWBACCA_APPLICATIONS_DIR:-/Applications}"
LOG_DIR="$HOME/Library/Logs/Chewbacca"
LOG="$LOG_DIR/setup.log"
HEADLESS="${CHEWBACCA_SETUP_HEADLESS:-0}"
TITLE="Chewbacca Setup"
mkdir -p "$LOG_DIR"

# One dialog. In headless mode it prints and takes the default button.
ask() {  # message, buttons (comma list), default
  local message="$1" buttons="$2" default="$3"
  if [ "$HEADLESS" = 1 ]; then
    printf 'DIALOG: %s [%s]\n' "$message" "$default" >&2
    echo "$default"
    return 0
  fi
  local list="" button
  local IFS=,
  for button in $buttons; do list="$list\"$button\","; done
  unset IFS
  osascript -e "button returned of (display dialog \"${message//\"/\\\"}\" with title \"$TITLE\" buttons {${list%,}} default button \"$default\")" 2>/dev/null
}

tell() { ask "$1" "OK" "OK" >/dev/null; }

# Opens a page or an app for the person. Headless prints what it would open.
take_there() {
  if [ "$HEADLESS" = 1 ]; then echo "OPEN: $*"; else open "$@" >/dev/null 2>&1 || true; fi
}

# 1. Say what this does before it does anything.
answer="$(ask "Chewbacca sets up the Claude app on this Mac so it can help with your texts, calendar, email and files.

It takes about a minute. Setup itself sends nothing about you anywhere: it copies files into your own account and changes nothing outside it.

You can remove it later from the same place." "Not now,Set up" "Set up")"
[ "$answer" = "Set up" ] || exit 0

# 2. It needs an assistant app to live in. The Claude app first, since that is
#    who this is for, then the ChatGPT or Codex app, whose Codex is free on some
#    plans (USC's ChatGPT Edu among them).
AGENT_APP=""
for name in Claude ChatGPT Codex; do
  for dir in "$APPS" "$HOME/Applications"; do
    if [ -d "$dir/$name.app" ]; then AGENT_APP="$dir/$name.app"; break 2; fi
  done
done
if [ -z "$AGENT_APP" ]; then
  tell "Chewbacca works inside the Claude app, and it is not on this Mac yet.

The download page is opening now. Install Claude, sign in, then open Chewbacca Setup again."
  take_there "https://claude.com/download"
  exit 3
fi

# 3. python3 and git are Apple's developer tools. Without them macOS shows its
#    own installer the first time anything asks, so ask once, on purpose, and
#    say what the window is before it appears.
if ! xcode-select -p >/dev/null 2>&1; then
  tell "Apple needs to add its free developer tools first. A window from Apple will ask: click Install.

It is a large download and can take several minutes. Setup carries on by itself when it finishes."
  if [ "$HEADLESS" != 1 ]; then xcode-select --install >/dev/null 2>&1 || true; fi
  waited=0
  until xcode-select -p >/dev/null 2>&1; do
    sleep 5; waited=$((waited + 5))
    if [ "$waited" -ge "${CHEWBACCA_SETUP_CLT_WAIT:-1800}" ]; then
      tell "Apple's tools did not finish installing. Open Chewbacca Setup again once they have."
      exit 4
    fi
  done
fi

# 4. The install itself: start.sh, from the payload in this app, wiring only
#    the agents already here. No Homebrew, so no password prompt.
echo "== $(date -u +%FT%TZ) $TITLE" >> "$LOG"
if ! bash "$HERE/start.sh" --tarball "$PAYLOAD" --every-agent </dev/null >> "$LOG" 2>&1; then
  tell "Setup stopped before it finished. Nothing outside your account was changed.

The details are in Logs > Chewbacca > setup.log, which is opening now."
  take_there -R "$LOG"
  exit 1
fi

# 5. Hand them to the app, with the one thing to do there.
if [ "${AGENT_APP##*/}" = Claude.app ]; then
  next="Open the Claude app, click Code at the top, choose Local, and say hi. Chewbacca will walk you through the rest, one question at a time."
else
  next="Open ${AGENT_APP##*/}, start a Codex chat, and say hi. Chewbacca will walk you through the rest, one question at a time."
fi
answer="$(ask "Done. $next

Permissions come later, one at a time, only when a job needs one, and Chewbacca opens the right switch for you." "Later,Open it" "Open it")"
[ "$answer" = "Open it" ] && take_there -a "$AGENT_APP"
exit 0
