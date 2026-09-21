#!/bin/bash
# A blocked file should be told which behaviour spec it needs, not just what
# is wrong with it. systems/ covers the look and cannot describe behaviour.
ROOT="${1:?}"
HOOK="${UX_GUARD:-$HOME/.claude/hooks/ux-guard.sh}"
[ -x "$HOOK" ] || exit 1
payload=$(python3 -c '
import json
body = "<form className=\"bg-indigo-600 transition-all\"><input placeholder=\"Email\" /></form>"
print(json.dumps({"tool_input": {"file_path": "/tmp/route-probe.tsx", "content": body}}))
')
printf '%s' "$payload" | UX_ENGINE_DIR="$ROOT" "$HOOK" 2>&1 | grep -q "ux-preset form"
