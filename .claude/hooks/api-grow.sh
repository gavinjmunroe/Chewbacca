#!/bin/bash
# PreToolUse and PostToolUse: every site browsed grows the API layer.
#
# Caleb, 2026-10-11: "Whenever chewbs tries a new site, it should reverse
# engineer an api so moving forward it gets more and more cracked." Before a
# browse to a host that already has taught ops, the agent is told to call them
# instead. After a browse to a host with none, the visit is logged and the
# agent is told, once per session, to teach a read-only op or record why not.
# Never blocks: it only adds context. bin/api-grow does the work.

[ "${API_GROW:-on}" = "off" ] && exit 0
INPUT=$(cat)
# Cheap exit for the common case: a Bash call that touches no website.
case "$INPUT" in
  *'"tool_name":"Bash"'*|*'"tool_name": "Bash"'*)
    printf '%s' "$INPUT" | grep -qE '(chewie web|jev-browse|scrape|curl|browser-bridge|web-record|summarize|chrome-js|wget)' || exit 0
    printf '%s' "$INPUT" | grep -q 'http' || exit 0
    ;;
esac
GROW="$(dirname "${BASH_SOURCE[0]}")/../../bin/api-grow"
[ -x "$GROW" ] || GROW="$(command -v api-grow)"
[ -n "$GROW" ] || exit 0
printf '%s' "$INPUT" | /usr/bin/python3 "$GROW" hook 2>/dev/null
exit 0
