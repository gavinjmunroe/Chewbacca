#!/bin/bash
# Clean content must pass through untouched.
ROOT="${1:?}"
HOOK="${UX_GUARD:-$HOME/.claude/hooks/ux-guard.sh}"
[ -x "$HOOK" ] || exit 1
BODY=$(python3 -c "import json;print(json.dumps(open('$ROOT/tests/fixtures/clean.tsx').read()))")
printf '{"tool_input":{"file_path":"/tmp/uxg-clean-%s.tsx","content":%s}}' "$$" "$BODY" \
  | UX_ENGINE_DIR="$ROOT" "$HOOK" >/dev/null 2>&1
