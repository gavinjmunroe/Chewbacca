#!/bin/bash
# The hook must exit 2 (blocking) on a file carrying the generated look.
ROOT="${1:?}"
HOOK="${UX_GUARD:-$HOME/.claude/hooks/ux-guard.sh}"
[ -x "$HOOK" ] || exit 1
T="$(mktemp /tmp/uxg-XXXXXX).tsx"
cp "$ROOT/tests/fixtures/slop.tsx" "$T"
printf '{"tool_input":{"file_path":"%s"}}' "$T" | UX_ENGINE_DIR="$ROOT" "$HOOK" >/dev/null 2>&1
rc=$?
rm -f "$T"
[ "$rc" -eq 2 ]
