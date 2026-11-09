#!/bin/bash
# client-post-guard: agents never post in a client's Slack conversations as
# Caleb. 2026-10-12: 13 automated posts from his account in #zeutara-cold-replies.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/.claude/hooks/client-post-guard.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
cat > "$T/clients.json" <<'JSON'
{"clients": [{"name": "Acme Co", "client_slack": {"user": "UJO", "me": ["UME"], "conversations": ["C1ABC", "D2XYZ"]}}]}
JSON
export CHEWBACCA_GTM_CLIENTS="$T/clients.json" HOOKD_INNER=1
fail=0
run() { printf '%s' "$1" | bash "$HOOK" >/dev/null 2>&1; echo $?; }
expect() { got=$(run "$2"); if [ "$got" = "$1" ]; then echo "ok    $3"; else echo "FAIL: expected $1 got $got: $3"; fail=1; fi; }
bash_p() { jq -n --arg c "$1" '{tool_name:"Bash",tool_input:{command:$c}}'; }
mcp_p() { jq -n --arg t "$1" --arg c "$2" '{tool_name:$t,tool_input:{channel_id:$c,message:"x"}}'; }
expect 2 "$(bash_p 'slackcli messages send --recipient-id C1ABC --message "Sent the deck in the thread"')" "slackcli into the client channel is refused"
expect 2 "$(bash_p 'slackcli messages send --recipient-id D2XYZ --message "hi"')" "slackcli into the client DM is refused"
expect 0 "$(bash_p 'slackcli messages send --recipient-id C9OTHER --message "hi"')" "slackcli into a team channel goes through"
expect 2 "$(mcp_p mcp__claude_ai_Slack__slack_send_message C1ABC)" "the Slack MCP send into the client channel is refused"
expect 2 "$(mcp_p mcp__claude_ai_Slack__slack_schedule_message C1ABC)" "a scheduled post into the client channel is refused"
expect 0 "$(mcp_p mcp__claude_ai_Slack__slack_send_message_draft C1ABC)" "a draft for Caleb to send himself is not refused"
expect 0 "$(mcp_p mcp__claude_ai_Slack__slack_send_message C1ABCD)" "a channel id that only starts with a client id goes through"
expect 0 "$(bash_p 'slackcli conversations history --channel C1ABC')" "reading the client channel goes through"
exit $fail
