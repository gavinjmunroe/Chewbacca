#!/bin/bash
# client-ask-guard: a Slack post tagging a client waits for a fresh, clean
# gtme done. 2026-10-11: a post asked Jonah for decks he had DM'd a day earlier.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/.claude/hooks/client-ask-guard.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
cat > "$T/clients.json" <<'JSON'
{"clients": [{"name": "Acme Co", "principal": "Jo", "client_slack": {"user": "UJO", "me": ["UME"], "conversations": ["C1"]}}]}
JSON
export CHEWBACCA_GTM_CLIENTS="$T/clients.json" CHEWBACCA_STATE_DIR="$T/state"
fail=0
run() { jq -n --arg c "$1" '{tool_input:{command:$c}}' | bash "$HOOK" >/dev/null 2>&1; echo $?; }
expect() { got=$(run "$2"); [ "$got" = "$1" ] || { echo "FAIL: expected $1 got $got: $3"; fail=1; }; [ "$got" = "$1" ] && echo "ok    $3"; }
ASK='slackcli messages send --recipient-id C1 --message "<@UJO> can you send the deck?"'
expect 2 "$ASK" "a post tagging the client with no done check is refused"
mkdir -p "$T/state/gtme-done"
echo "{\"at\": $(date +%s), \"open\": 1, \"not_run\": 0, \"client_unanswered\": 1}" > "$T/state/gtme-done/acme-co.json"
expect 2 "$ASK" "a post while the client has an unanswered message is refused"
echo "{\"at\": $(date +%s), \"open\": 0, \"not_run\": 0, \"client_unanswered\": 0}" > "$T/state/gtme-done/acme-co.json"
expect 0 "$ASK" "a post after a fresh clean check goes through"
echo "{\"at\": $(( $(date +%s) - 4000 )), \"open\": 0, \"not_run\": 0, \"client_unanswered\": 0}" > "$T/state/gtme-done/acme-co.json"
expect 2 "$ASK" "a check older than 30 minutes is stale"
expect 0 'slackcli messages send --recipient-id C1 --message "Sent the deck in the thread"' "a post that tags nobody goes through"
printf '<@UJO> one question\n' > "$T/msg.txt"
expect 2 "slackcli messages send --recipient-id C1 --message-file $T/msg.txt" "a tag inside a message file counts"
exit $fail
