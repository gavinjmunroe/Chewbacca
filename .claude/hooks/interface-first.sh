#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init interface-first.sh 5
# PreToolUse on Write: a whole UI page is not written until the interface
# skill has been loaded in this session.
#
# 2026-10-11, a guitar midterm study app: the router named the interface skill
# on the prompt, the page was written without it, and it shipped as tabs over a
# grid of cards and tables. Caleb: "Terrible ux bro ru serious a flat html
# grid? Fix chewb to never make smth that terrible ever again." Every check
# that ran (ux-guard, a headless screenshot pass) judged the parts, and none of
# them asked what the page should BE. The skill is where that question lives
# (name the template, the stance, show the content as itself), so this refuses
# the write that skips it, once, with the reason, and lets it through after.
#
# Scope: Write of a .html/.tsx/.jsx/.vue/.svelte file of 150+ lines. Edits and
# small files pass, so a one-line fix never meets this. It denies through the
# permission decision and exits 0, never exit 2: a red "hook error" on Caleb's
# screen is its own complaint (feedback_hooks_never_show_errors).
set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
INPUT=$(cat)
[ "$(printf '%s' "$INPUT" | jq -r '.tool_name // empty')" = "Write" ] || exit 0
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')
case "$FILE" in *.html|*.htm|*.tsx|*.jsx|*.vue|*.svelte) ;; *) exit 0 ;; esac
# 150 lines: the guitar page was 700+; a component stub or a fixture is not a page.
LINES=$(printf '%s' "$INPUT" | jq -r '.tool_input.content // ""' | wc -l | tr -d ' ')
[ "${LINES:-0}" -ge "${INTERFACE_FIRST_MIN_LINES:-150}" ] || exit 0

SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' | tr -cd 'A-Za-z0-9_-')
STATE="${CHEWBACCA_HOME:-$HOME/.chewbacca}/state"
# Loaded already? skill-gate records every Skill call per session; the
# transcript is the fallback for a host where skill-gate is not registered.
if [ -n "$SID" ] && grep -qxE '(interface|site-spec|clone-site)' "$STATE/skill-loaded-$SID" 2>/dev/null; then exit 0; fi
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty')
if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ] \
   && tail -c 3000000 "$TRANSCRIPT" | grep -qE 'skills/(interface|site-spec|clone-site)\b|"skill": ?"(interface|site-spec|clone-site)"'; then
  exit 0
fi
[ "${CHEWBACCA_INTERFACE_FIRST:-1}" = "0" ] && exit 0

REASON="Load the interface skill before writing this page ($LINES lines, $(basename "$FILE")). Then, before any markup: name the template from its taxonomy (a tool someone practices or studies with is a session, one thing on screen at a time, never tabs over a card grid), name the stance and who reads it, and say what the content is as itself (the instrument, the document, the conversation). On 2026-10-11 a study app skipped this and shipped as a flat grid of cards."
jq -n --arg r "$REASON" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
exit 0
