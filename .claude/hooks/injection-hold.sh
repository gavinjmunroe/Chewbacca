#!/bin/bash
# hookd skips this for a Bash call that names no external sink, unless this session
# already has a flag file, which makes every Bash call run the full classifier. So
# python, rm and find are read only in a flagged session; a clean session pays for
# them nothing. Every doubt in hookd resolves to running this.
# gate: send post push publish deploy delete curl wget scp rsync sftp ssh osascript
# gate: twilio slackcli wacli text-group text-blast mac-use peekaboo chrome-js
# gate: crontab launchctl land launch jobs codex injection-hold
# gate: human-turns chat-approval gh /dev/tcp
# Not `claude` or `.claude/`: transcript_path holds both, so every call ran (the
# replay caught 15,141 of 15,141). Those shapes are read once a flag file exists.
# gate-file: state/injection-hold/{session}.jsonl
[ -z "${HOOKD_INNER:-}" ] && [ -x "$HOME/.local/bin/hookd" ] && exec "$HOME/.local/bin/hookd" gate "$0" "$@"
# PreToolUse: a send, post, pay, delete or publish waits for Caleb after a flagged
# read in this session. bin/lib/injection_hold.py has the rules, the measured false
# positive rate and what this can't stop.
HOLD="$(dirname "${BASH_SOURCE[0]}")/../../bin/injection-hold"
[ -x "$HOLD" ] || HOLD="$HOME/.local/bin/injection-hold"
[ -x "$HOLD" ] || HOLD="$(command -v injection-hold)"
if [ ! -x "$HOLD" ]; then
  # With the checker gone, a flag on disk is still a flag: a removed tool must not
  # read as a clean session.
  PAYLOAD="$(cat)"
  SESSION="$(printf '%s' "$PAYLOAD" | sed -n 's/.*"session_id" *: *"\([A-Za-z0-9_-]*\)".*/\1/p' | head -1)"
  if [ -n "$SESSION" ] && [ -s "${CHEWBACCA_STATE_DIR:-$HOME/.chewbacca/state}/injection-hold/$SESSION.jsonl" ]; then
    echo "injection-hold: this session has a flagged read and the checker is missing, so outbound is held. Tell Caleb." >&2
    exit 2
  fi
  exit 0
fi
exec /usr/bin/env python3 -I "$HOLD" check
