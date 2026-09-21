#!/bin/bash
# The hook must exit 0 on a file that follows a real system.
ROOT="${1:?}"
HOOK="${UX_GUARD:-$HOME/.claude/hooks/ux-guard.sh}"
[ -x "$HOOK" ] || exit 1
printf '{"tool_input":{"file_path":"%s"}}' "$ROOT/tests/fixtures/clean.tsx" \
  | UX_ENGINE_DIR="$ROOT" "$HOOK" >/dev/null 2>&1
