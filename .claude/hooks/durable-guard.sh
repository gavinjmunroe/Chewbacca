#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init durable-guard.sh 10
# Stop hook: a correction must change the kit, not just the reply.
# Runtime adapters must supply the current user prompt, not hook feedback.
# The checker looks for a subsequent policy write in this session's log.
set -uo pipefail

INPUT=$(cat)
command -v jq >/dev/null 2>&1 || exit 0

USER_TEXT=$(printf '%s' "$INPUT" | jq -r '.user_message // .prompt // empty' 2>/dev/null)
[ -n "$USER_TEXT" ] || exit 0

SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // empty')
PROMPT_ID=$(printf '%s' "$INPUT" | jq -r '.prompt_id // .session_id // "unknown"')
GUARD="${TMPDIR:-/tmp}/durable-guard-$PROMPT_ID"
[ -f "$GUARD" ] && exit 0

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK="$ROOT/bin/durable-check"
[ -x "$CHECK" ] || CHECK="$(command -v durable-check || true)"
[ -x "$CHECK" ] || exit 0

SINCE=$(printf '%s' "$INPUT" | jq -r '.durable_since // empty')
ARGS=(--session "$SESSION")
[ -z "$SINCE" ] || ARGS+=(--since "$SINCE")

if OUT=$(printf '%s' "$USER_TEXT" | "$CHECK" "${ARGS[@]}" 2>&1); then
  exit 0
fi

: > "$GUARD"
printf '%s\n' "$OUT" >&2
exit 2
