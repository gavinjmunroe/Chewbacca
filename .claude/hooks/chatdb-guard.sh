#!/bin/bash
# hookd skips this guard for a Bash call that names none of these words,
# each one its first check requires. Proven by tools/hookd_replay.py.
# gate: sqlite3
[ -z "${HOOKD_INNER:-}" ] && [ -x "$HOME/.local/bin/hookd" ] && exec "$HOME/.local/bin/hookd" gate "$0" "$@"
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
# A heredoc fed to python3, cat or tee is writing a file (a test fixture that
# builds a fake chat.db), not reading anyone's messages. On 2026-10-10 that
# shape was refused twice while adding the RCS/SMS GUID test.
writes_file=0
printf '%s' "$cmd" | grep -qE '^[[:space:]]*(cd [^&;]*(&&|;)[[:space:]]*)?([A-Z_]+=[^ ]* )*(python3|cat|tee)[^|;&]*<<' && writes_file=1
# A fixture builds a fake database at a scratch path; it never opens the real
# ones. A heredoc that names Library/Messages/chat.db or the people store is a
# read, whatever it's fed to (security review, 2026-10-10).
if printf '%s' "$cmd" | grep -qE 'Library/Messages/chat\.db|\.chewbacca/people/people\.db'; then writes_file=0; fi
# A plain sqlite3 count is not reading a thread. 2026-10-12, the weekly
# false-positive report (hookd_replay.py fp) ranked this guard first: one of
# its three got-past refusals that week was `select count(*),
# sum(is_from_me) from message where date > ...`, a volume check, and the
# agent typed RAW_MESSAGES_OK=1 on its next call. So the chat.db thread rule
# lets through only one bare sqlite3 call (no cd, pipe, second command,
# redirect, substitution or dot command) with exactly one SELECT whose every
# output column is count, sum, avg, total, min or max, and whose text names no
# column that holds words and selects no *. A hand-built "who is waiting"
# query returns chat ids, not counts, so it is still refused. This only
# narrows the chat.db rule; the people.db rule below is untouched.
counts_only=0
if printf '%s' "$cmd" | grep -qE '^[[:space:]]*sqlite3[[:space:]]' \
  && ! printf '%s' "$cmd" | grep -qiE '(^|[^a-z_])(text|body|attributedbody|subject|group_concat|json_group_array|json_group_object|payload_data|message_summary_info)([^a-z_]|$)' \
  && ! printf '%s' "$cmd" | grep -qiE 'select[[:space:]]+(distinct[[:space:]]+)?\*|[a-z_]\.\*|,[[:space:]]*\*' \
  && ! printf '%s' "$cmd" | grep -qE '<|`|\$\(|[|;&]|(^|[[:space:]"'"'"'])\.[a-z]'; then
  counts_only="$(printf '%s' "$cmd" | /usr/bin/python3 -I -c '
import re, sys
c = sys.stdin.read()
if len(re.findall(r"\bselect\b", c, re.I)) != 1:
    print(0); sys.exit()
m = re.search(r"\bselect\s+(.*?)\s+from\b", c, re.I | re.S)
if not m:
    print(0); sys.exit()
items, depth, cur = [], 0, ""
for ch in m.group(1):
    depth += ch == "("
    depth -= ch == ")"
    if ch == "," and depth == 0:
        items.append(cur); cur = ""
    else:
        cur += ch
items.append(cur)
agg = re.compile(r"(count|sum|avg|total|min|max)\s*\((?:[^()]|\([^()]*\))*\)(\s+(as\s+)?\w+)?", re.I)
print(1 if all(agg.fullmatch(i.strip()) for i in items) else 0)
' 2>/dev/null || echo 0)"
fi
if [ "$writes_file" = 0 ] && [ "$counts_only" = 0 ] && printf '%s' "$cmd" | grep -q 'chat\.db' \
  && printf '%s' "$cmd" | grep -qiE 'is_from_me|chat_message_join'; then thread_read=1; fi
if [ "$writes_file" = 0 ] && printf '%s' "$cmd" | grep -q 'people\.db' \
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
