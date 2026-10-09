#!/usr/bin/env bash
# SessionStart: open todos from the shared work ledger, for this workspace plus
# the person's own todos (scope ~), which show in every workspace.
#
# Caleb, 2026-10-09: "Nothing should ever be brute force word commanded." The
# ledger existed and Codex read it, but no Claude Code hook ever did, so a todo
# saved in one tab only came back if he remembered a phrase to type in the
# next. Uncached on purpose: one sqlite read, and the answer depends on cwd,
# which the shared session-context cache cannot key on.
set -uo pipefail

CWD="$(python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("cwd") or "")
except Exception: print("")' 2>/dev/null)"
CWD="${CWD:-$PWD}"

LEDGER="$(command -v work-ledger 2>/dev/null || true)"
[ -z "$LEDGER" ] && [ -x "$HOME/.local/bin/work-ledger" ] && LEDGER="$HOME/.local/bin/work-ledger"
[ -z "$LEDGER" ] && exit 0

"$LEDGER" context --scope "$CWD" 2>/dev/null || true
exit 0
