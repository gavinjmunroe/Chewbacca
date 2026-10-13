#!/bin/bash
# hookd skips this guard for a Bash call that never runs slackcli.
# gate: slackcli slack_send_message slack_schedule_message
[ -z "${HOOKD_INNER:-}" ] && [ -x "$HOME/.local/bin/hookd" ] && exec "$HOME/.local/bin/hookd" gate "$0" "$@"
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init client-post-guard.sh 5
# PreToolUse: an agent never posts in a client's Slack conversations as Caleb.
# Togari is the client-facing voice there; its bot posts the reply cards and the
# "He wrote / We sent" lines.
#
# 2026-10-12, Caleb: "Why tf are there automated messages from my acc in the
# slack?????????? Everything should be togari!!!!!!!!!!" Agents had posted 13
# reply summaries, deck notes and a to-do for Jonah into #zeutara-cold-replies
# from his account on 10/11 and 10/12 (three of them the same line, one second
# apart), through slackcli and the Slack MCP, both of which act as him. The
# conversations come from clients.json client_slack.conversations, so this works
# for every client, not only Zeutara. A draft (slack_send_message_draft) is his
# to send and is not refused.

set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
payload="$(cat)"
tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null)"
case "$tool" in
  Bash)
    cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"
    printf '%s' "$cmd" | grep -qE 'slackcli[[:space:]]+(messages[[:space:]]+)?(send|post|schedule)' || exit 0
    target="$cmd" ;;
  mcp__claude_ai_Slack__slack_send_message|mcp__claude_ai_Slack__slack_schedule_message)
    target="$(printf '%s' "$payload" | jq -r '.tool_input.channel_id // .tool_input.channel // empty' 2>/dev/null)" ;;
  *) exit 0 ;;
esac
[ -n "$target" ] || exit 0
TARGET="$target" python3 - <<'PY'
import json, os, re, sys
cfg = os.path.expanduser(os.environ.get("CHEWBACCA_GTM_CLIENTS", "~/.chewbacca/gtm/clients.json"))
try:
    clients = json.load(open(cfg)).get("clients", [])
except (OSError, ValueError):
    sys.exit(0)
target = os.environ["TARGET"]
for c in clients:
    for conv in (c.get("client_slack") or {}).get("conversations") or []:
        if conv and re.search(r"(?<![A-Z0-9])" + re.escape(conv) + r"(?![A-Z0-9])", target):
            print(f"client-post-guard: {conv} is a {c['name']} conversation. Agents never post there as Caleb; "
                  f"Togari is the voice in client channels (Caleb, 2026-10-12: \"Everything should be togari\"). "
                  f"Togari posts its own reply cards and results. If something must be said there, put it in "
                  f"Togari or tell Caleb in chat what it is.", file=sys.stderr)
            sys.exit(2)
sys.exit(0)
PY
