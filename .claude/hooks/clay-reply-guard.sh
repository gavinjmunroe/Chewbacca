#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init clay-reply-guard.sh 5
# PostToolUse on Bash: when campaign analytics show a reply, put the rule in
# front of the agent at the exact moment it is tempted to break it.
#
# Written 2026-10-05. Analytics showed one Ivy reply categorized "Interested",
# positive sentiment, and it was reported to Caleb as a warm lead. The text was
# Hustle Fund's canned "apply through our website" redirect. The analytics
# output carries the category and never the text.

set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0

payload="$(cat)"
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"
case "$cmd" in *analytics*) ;; *) exit 0 ;; esac
printf '%s' "$cmd" | grep -qE '\bclay\b' || exit 0

out="$(printf '%s' "$payload" | jq -r '.tool_response.stdout // .tool_response // empty' 2>/dev/null)"
# Any nonzero reply count anywhere in the output.
printf '%s' "$out" | grep -qE '"(replies|repliedCount|repliesExcludingOoo)": *[1-9]' || exit 0

msg='clay-reply-guard: these analytics show replies, but only their CATEGORY. Do not tell anyone a lead is interested until you have read the reply text: run `python3 scripts/replies.py` in ~/code/work/zeutara-gtme (or open the Replies tab). On 2026-10-05 an "Interested" tag was a canned apply-on-our-site redirect.'
jq -n --arg m "$msg" '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $m}}'
exit 0
