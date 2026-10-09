#!/usr/bin/env bash
# SessionStart, UserPromptSubmit, PreToolUse (file tools), SessionEnd: put this
# tab on the shared board and show it every other live tab, from any runtime.
#
# Caleb, 2026-10-09, five tabs open: "Fix chewbs so tabs always know what other
# tabs are doing even across llms". repo-overlap-guard.sh already said that
# SOMEONE edited this checkout; nothing said who, on what, or in which runtime.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
for candidate in "${CHEWBACCA_ROOT:-}" "$ROOT" "$HOME/code/chewbacca"; do
  if [ -n "$candidate" ] && [ -f "$candidate/tools/tabs.py" ]; then
    exec python3 "$candidate/tools/tabs.py" hook --runtime "${CHEWBACCA_RUNTIME:-claude-code}"
  fi
done
exit 0
