#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init chatdb-guard.sh 5
# PreToolUse: refuse a raw sqlite3 search of chat.db that filters on the
# `text` column without decoding attributedBody.
#
# Written 2026-10-03. Asked which Pasadena food spots had come up in his
# texts, this kit ran `sqlite3 chat.db "... WHERE m.text LIKE '%pasadena%'"`
# and got ONE row back. Decoding attributedBody found 2,213 Pasadena-area
# messages and every restaurant in the answer. Measured the same day: of
# 268,898 messages since 2025-01-01, 267,895 have an empty `text` column and
# 265,057 of those carry their words only in attributedBody. A `text LIKE`
# search reads under 0.4% of recent history and reports the rest as silence,
# which reads exactly like "you never texted about it".
#
# `people texts search "<query>"` already decodes attributedBody. Use it, or
# decode the blob in the query yourself; mentioning attributedBody passes.
#
# Exit 2 blocks the call.

set -uo pipefail

payload="$(cat)"
tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null)"
[ "$tool" = "Bash" ] || exit 0
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -n "$cmd" ] || exit 0

printf '%s' "$cmd" | grep -q 'sqlite3' || exit 0

# Reading threads by hand. 2026-10-09, "clear out my texts": the session
# wrote two chat.db queries joining chat_message_join on is_from_me (both came
# back empty, an integer compared to strftime TEXT is always smaller), then
# read the people store's messages table one thread at a time, 25 threads, the
# better part of an hour. `people texts owed` is that whole read in 1.3s. A
# command that says RAW_MESSAGES_OK=1 is debugging the reader and passes.
printf '%s' "$cmd" | grep -q 'RAW_MESSAGES_OK=1' && exit 0
thread_read=0
if printf '%s' "$cmd" | grep -q 'chat\.db' \
  && printf '%s' "$cmd" | grep -qiE 'is_from_me|chat_message_join'; then thread_read=1; fi
if printf '%s' "$cmd" | grep -q 'people\.db' \
  && printf '%s' "$cmd" | grep -qiE 'from[[:space:]]+messages([^_a-z]|$)' \
  && printf '%s' "$cmd" | grep -qiE 'from_me|body' \
  && ! printf '%s' "$cmd" | grep -qiE '(insert|update|delete)[[:space:]]'; then thread_read=1; fi
if [ "$thread_read" = 1 ]; then
  cat >&2 <<'MSG'
chatdb-guard: refusing. This reads message threads with raw SQL.

The people CLI already does it, decoded, every app, in one call:

  people texts owed [--json]        who is waiting on a reply, with context
  people texts <name>               one person's thread, newest, whole
  people texts search "<query>"     full text, all history
  people texts --days 3             the running log

On 2026-10-09 doing this by hand took eleven calls and most of an hour.
Debugging the reader itself: prefix the command with RAW_MESSAGES_OK=1.
MSG
  exit 2
fi

printf '%s' "$cmd" | grep -q 'chat\.db' || exit 0
printf '%s' "$cmd" | grep -qi 'attributedBody' && exit 0
# A filter on the text column: `text LIKE`, `m.text like`, `text GLOB`, `text =`.
printf '%s' "$cmd" | grep -qiE '(^|[^A-Za-z_])([A-Za-z_]+\.)?text[[:space:]]+(not[[:space:]]+)?(like|glob|match|=)' || exit 0

cat >&2 <<'MSG'
chatdb-guard: refusing. This searches chat.db on the `text` column only.

Since 2025, 99.6% of messages have an empty `text` column; their words live in
the attributedBody blob. On 2026-10-03 this exact query shape returned 1 hit
where decoding found 2,213.

  people texts search "<query>"     decodes attributedBody for you

Or decode attributedBody in your own query (any command that mentions
attributedBody passes).
MSG
exit 2
