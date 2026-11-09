#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init attachment-guard.sh 5
# gate: osascript
# PreToolUse on Bash: a file texted over iMessage goes through send-file, never a
# bare AppleScript `send POSIX file`.
#
# 2026-11-03: a setup PDF for Gavin was sent with osascript straight from
# ~/Downloads. The thread showed the attachment as sent, but it didn't open for
# him; Caleb had to text it to himself and forward it from his iPhone ("For some
# reason when chewbs texts files it sometimes doesnt work"). send-file copies the
# file to ~/Pictures/chewbacca-send/ where Messages can read it, sends it, and
# confirms it went (team memory feedback_send_file_stages_in_pictures). The note
# existed and the agent still used osascript, so this makes send-file the only path.
# Denies through the permission decision and exits 0. Never exit 2.
set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
INPUT=$(cat)
[ "$(printf '%s' "$INPUT" | jq -r '.tool_name // empty')" = "Bash" ] || exit 0
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')
printf '%s' "$CMD" | grep -qiE 'osascript' || exit 0
printf '%s' "$CMD" | grep -qiE 'Messages' || exit 0
printf '%s' "$CMD" | grep -qiE 'POSIX file|as alias|send .*file' || exit 0
REASON="Text a file with send-file, never osascript: send-file <handle> \"<path>\" [--text \"...\"]. It stages the file where Messages can read it and confirms it went. On 2026-11-03 an osascript-sent PDF didn't open for Gavin."
jq -n --arg r "$REASON" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
exit 0
