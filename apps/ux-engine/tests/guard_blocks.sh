#!/bin/bash
# The hook must block the WRITE, not merely exit 2 after it.
#
# The previous version copied a fixture to a temp path and asserted rc == 2.
# That passed under PostToolUse, where exit 2 is ignored and the file was
# already on disk. So it proved the exit code and nothing else.
#
# This passes content the way PreToolUse does, and then asserts the file was
# never created.
ROOT="${1:?}"
HOOK="${UX_GUARD:-$HOME/.claude/hooks/ux-guard.sh}"
[ -x "$HOOK" ] || exit 1
T="/tmp/uxg-blocked-$$.tsx"
rm -f "$T"
printf '{"tool_input":{"file_path":"%s","content":"<div className=\\"bg-indigo-600 transition-all\\">Empower your team</div>"}}' "$T" \
  | UX_ENGINE_DIR="$ROOT" "$HOOK" >/dev/null 2>&1
rc=$?
[ "$rc" -eq 2 ] || { echo "expected exit 2, got $rc" >&2; exit 1; }
[ ! -f "$T" ] || { echo "file was written despite the block" >&2; rm -f "$T"; exit 1; }
exit 0
