#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init durable-guard.sh 10
# Stop hook: a correction must land a gate or a test, or record why it can't.
#
# 2026-10-11, after "Why does the repeat mistake keep happening???": this hook
# had exited 0 on every run in the log, because Claude Code's Stop payload has
# no user_message and the hook returned before checking anything. It now hands
# bin/durable-check the transcript, which reads the last prompt from it. Codex's
# adapter still supplies user_message and durable_since directly.
#
# It refuses at most once per prompt. Every later Stop for the same prompt only
# records the outcome, so `chewbacca lessons` shows whether the turn landed a
# gate, wrote why not, or neither (feedback_enforce_dont_document).
set -uo pipefail

INPUT=$(cat)
command -v jq >/dev/null 2>&1 || exit 0

USER_TEXT=$(printf '%s' "$INPUT" | jq -r '.user_message // .prompt // empty' 2>/dev/null)
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)
[ -n "$USER_TEXT" ] || [ -f "$TRANSCRIPT" ] || exit 0

SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // empty')
PROMPT_ID=$(printf '%s' "$INPUT" | jq -r '.prompt_id // empty')

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK="$ROOT/bin/durable-check"
[ -x "$CHECK" ] || CHECK="$(command -v durable-check || true)"
[ -x "$CHECK" ] || exit 0

SINCE=$(printf '%s' "$INPUT" | jq -r '.durable_since // empty')
ARGS=(--session "$SESSION")
[ -z "$SINCE" ] || ARGS+=(--since "$SINCE")
[ -z "$USER_TEXT" ] && [ -f "$TRANSCRIPT" ] && ARGS+=(--transcript "$TRANSCRIPT")
[ -z "$PROMPT_ID" ] || ARGS+=(--prompt-id "$PROMPT_ID")

# One refusal per prompt. Claude Code marks the Stop that follows a refusal
# with stop_hook_active; Codex sends a prompt_id, which keys a guard file.
GUARD="${TMPDIR:-/tmp}/durable-guard-$(printf '%s' "${PROMPT_ID:-none}" | tr -c 'A-Za-z0-9._-' '_')"
ACTIVE=$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false')
if [ "$ACTIVE" = "true" ] || { [ -n "$PROMPT_ID" ] && [ -f "$GUARD" ]; }; then
  printf '%s' "$USER_TEXT" | "$CHECK" "${ARGS[@]}" --record-only >/dev/null 2>&1
  exit 0
fi

if OUT=$(printf '%s' "$USER_TEXT" | "$CHECK" "${ARGS[@]}" 2>&1); then
  exit 0
fi

[ -n "$PROMPT_ID" ] && : > "$GUARD"
printf '%s\n' "$OUT" >&2
exit 2
