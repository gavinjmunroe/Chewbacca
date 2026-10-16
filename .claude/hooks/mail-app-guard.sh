#!/bin/bash
# hookd skips this guard for a Bash call that names none of these words,
# each one its first check requires.
# gate: mail Mail
[ -z "${HOOKD_INNER:-}" ] && [ -x "$HOME/.local/bin/hookd" ] && exec "$HOME/.local/bin/hookd" gate "$0" "$@"
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init mail-app-guard.sh 5
# PreToolUse: refuse `mac mail` (Mail.app) and point at Gmail.
#
# Caleb, 2026-10-08: "We shouldn't be using the mail app that thing sucks".
# Mail.app's newest message was from 9/22 and his work inbox was not in it.
# The lesson went into a memory note, and on 2026-10-13 a session ran
# `mac mail search "fiber"` and `mac mail search "invite"` anyway, looking for
# two invites in his USC inbox, which Mail.app doesn't hold at all. He wrote
# "NEVER USE THE MAC MAIL APP WHEN GMAIL MOGS! I THOUGHT I TOLD U THIS???"
#
# Email goes through the Gmail API: `chewbacca email` lists connected inboxes,
# `chewbacca email add <address>` connects another. Exit 2 blocks the call.

set -uo pipefail

payload="$(cat)"
tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null)"
[ "$tool" = "Bash" ] || exit 0
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -n "$cmd" ] || exit 0

# `mac mail ...` at a command start, or after ; && || | ( or a newline.
if printf '%s' "$cmd" | grep -qE '(^|[;&|(`]|\$\(|[[:space:]]then[[:space:]]|[[:space:]]do[[:space:]])[[:space:]]*(command[[:space:]]+)?mac[[:space:]]+mail([[:space:]]|$)' \
  || printf '%s' "$cmd" | grep -qiE 'tell application "Mail"|Library/Mail/V[0-9]+/MailData'; then
  cat >&2 <<'EOF'
mail-app-guard: refusing Mail.app. Email goes through the Gmail API.

  chewbacca email                 the connected inboxes
  chewbacca email add <address>   connect another (only his Google sign-in is manual)

Mail.app holds only the accounts someone added to it and syncs when it likes:
on 2026-10-08 its newest message was 9/22 and his work inbox was missing.
On 2026-10-13 it was searched for USC invites it could never have had.
An email chore (an invite, a link, a code) is yours to do, not his.
EOF
  exit 2
fi
exit 0
