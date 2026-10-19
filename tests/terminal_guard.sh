#!/usr/bin/env bash
# The shell guard setup.sh writes, checked on all four cases it has to get
# right. It exists because of 2026-09-20: a Terminal.app started by an agent
# kept that agent's environment, every window opened in it inherited
# FORCE_COLOR=3, and Claude Code then wrote 24-bit colour Terminal.app cannot
# parse, leaving a block behind every word.
#
# The first version of the guard only fired when the shell's parent was login,
# which missed a nested shell, a tmux pane, and every shell that was already
# open. The colour half is keyed on the terminal now, and that is what these
# cases pin.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
FAILED=0
note() { echo "    $1"; }
fail() { echo "    FAIL: $1"; FAILED=1; }

HOMEDIR="$(mktemp -d)"
trap 'rm -rf "$HOMEDIR"' EXIT
printf '# a line that was already here\nexport EXISTING=1\n' > "$HOMEDIR/.zshrc"

install_guard() {
  HOME="$HOMEDIR" bash -c '
    set -u
    log() { :; }
    eval "$(awk "/^TERMINAL_GUARD_MARK=/,/^}\$/" "'"$ROOT"'/setup.sh")"
    eval "$(awk "/^ensure_terminal_shell_guard\(\) \{/,/^}\$/" "'"$ROOT"'/setup.sh")"
    ensure_terminal_shell_guard
  '
}

install_guard
install_guard   # twice: a second install must refresh, never duplicate

marks=$(grep -c 'Added by Chewbacca: a window' "$HOMEDIR/.zshrc")
[ "$marks" = 1 ] || fail "installed twice leaves $marks copies, want 1"
ends=$(grep -c 'End of the Chewbacca terminal guard' "$HOMEDIR/.zshrc")
[ "$ends" = 1 ] || fail "$ends end markers, want 1"
[ "$(grep -c 'a line that was already here' "$HOMEDIR/.zshrc")" = 1 ] \
  || fail "the rc file's own content did not survive"

# Terminal.app cannot render 24-bit colour, so the colour variables go
# whatever kind of shell this is. This is the case the first version missed.
left=$(env -i PATH="$PATH" HOME="$HOMEDIR" FORCE_COLOR=3 COLORTERM=truecolor CLICOLOR_FORCE=1 \
  TERM_PROGRAM=Apple_Terminal bash -c "source '$HOMEDIR/.zshrc'; env | grep -cE '^(FORCE_COLOR|COLORTERM|CLICOLOR_FORCE)='")
[ "$left" = 0 ] || fail "a nested Terminal.app shell kept $left colour variables"

# A terminal that does render it keeps them.
kept=$(env -i PATH="$PATH" HOME="$HOMEDIR" FORCE_COLOR=3 COLORTERM=truecolor \
  TERM_PROGRAM=iTerm.app bash -c "source '$HOMEDIR/.zshrc'; env | grep -cE '^(FORCE_COLOR|COLORTERM)='")
[ "$kept" = 2 ] || fail "iTerm lost truecolor: $kept of 2 variables left"

# A Claude tool shell keeps the session variables: its tools reach the session
# through CLAUDE_CODE_MESSAGING_SOCKET, and its parent is claude, not login.
session=$(env -i PATH="$PATH" HOME="$HOMEDIR" CLAUDE_CODE_MESSAGING_SOCKET=/tmp/x.sock \
  CLAUDE_CODE_SESSION_ID=abc CLAUDECODE=1 TERM_PROGRAM=Apple_Terminal \
  bash -c "source '$HOMEDIR/.zshrc'; env | grep -cE '^(CLAUDECODE|CLAUDE_CODE_)'")
[ "$session" = 3 ] || fail "a tool shell lost its session variables: $session of 3 left"

# A third run changes nothing: each refresh used to add one blank line.
before=$(cksum < "$HOMEDIR/.zshrc")
install_guard
[ "$(cksum < "$HOMEDIR/.zshrc")" = "$before" ] || fail "a re-run changed the rc file (blank line drift)"

# The first version (29bb83ee) had no end marker. Refreshing it used to strip
# from the marker to the end of the file, taking everything after it
# (break-it, 2026-10-19).
cat > "$HOMEDIR/.zshrc" <<'OLD'
export BEFORE=1

# Added by Chewbacca: a window is not a Claude Code child session
# A Terminal.app launched from inside a Claude Code session passes the session's
if [ "$(ps -o comm= -p "$PPID" 2>/dev/null)" = "login" ]; then
  unset FORCE_COLOR COLORTERM CLICOLOR_FORCE CLAUDECODE
  unset _chewbacca_var
fi
export AFTER_THE_OLD_GUARD=1
alias ll='ls -la'
OLD
install_guard
grep -q 'AFTER_THE_OLD_GUARD' "$HOMEDIR/.zshrc" || fail "refreshing the old guard deleted the lines after it"
grep -q "alias ll=" "$HOMEDIR/.zshrc" || fail "refreshing the old guard deleted the user's alias"
[ "$(grep -c 'Added by Chewbacca: a window' "$HOMEDIR/.zshrc")" = 1 ] || fail "old guard not replaced exactly once"
[ -f "$HOMEDIR/.zshrc.chewbacca-bak" ] || fail "no backup of the rc before rewriting it"

[ "$FAILED" = 0 ] && note "guard installs once, cleans Terminal.app, spares iTerm and tool shells"
exit "$FAILED"
