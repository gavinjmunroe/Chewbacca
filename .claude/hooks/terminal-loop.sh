#!/bin/bash
# hookd writes the PreToolUse and PostToolUse rows itself (crates/hookd/src/
# terminal.rs) and hands anything else back to the lines below. This cost
# 0.08 s of CPU and 96 ms before and after every tool call until 2026-10-12
# (tools/hook_bench.py). Only when setup.sh has checked the installed hookd
# knows the verb: an older one would answer with exit 0 and write nothing.
[ -z "${HOOKD_INNER:-}" ] && [ -x "$HOME/.local/bin/hookd" ] && [ -e "${CHEWBACCA_HOME:-$HOME/.chewbacca}/hookd-terminal-event" ] &&
  exec "$HOME/.local/bin/hookd" terminal-event "$0" "$@"
# Claude Code -> the terminal loop.
#
# Not sourcing lib.sh on purpose: its helpers read stdin, and the event JSON
# on stdin is the whole point here. Hooks run without a login shell, so PATH
# may not have ~/.local/bin; fall back to where setup.sh links chewie.
CHEWIE="$(command -v chewie 2>/dev/null || echo "$HOME/.local/bin/chewie")"
[ -x "$CHEWIE" ] || exit 0
# Never exec: a chewie that predates the `terminal` verb answers with an
# argparse error and exit 2, and on a PermissionRequest exit 2 is a blocking
# error that refuses the tool call. Seen on 2026-09-20 when tests/run.sh ran
# this wrapper against ~/.local/bin/chewie linked to an older checkout. The
# error stays on stderr, stdout stays empty, and the tab carries on.
"$CHEWIE" terminal hook
exit 0
