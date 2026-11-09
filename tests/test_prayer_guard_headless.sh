#!/usr/bin/env bash
# A `claude -p` reply is read by a program, so prayer-guard leaves it alone. Everything else
# still needs the prayer. Stress test, 2026-11-05: "pong" came back as only a prayer.
set -uo pipefail
HOOK="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/prayer-guard.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export HOME="$T" CHEWBACCA_LOG_DIR="$T/logs"; mkdir -p "$T/.chewbacca"; printf 'Amen' > "$T/.chewbacca/opener-marker"
P='{"last_assistant_message":"pong","prompt_id":"p'
run(){ printf '%s%s"}' "$P" "$RANDOM$RANDOM" | CLAUDE_CODE_ENTRYPOINT="$1" TMPDIR="$T/" bash "$HOOK" >/dev/null 2>&1; echo $?; }
[ "$(run sdk-cli)" = 0 ] || { echo "FAIL headless reply was refused"; exit 1; }
[ "$(run claude-desktop)" = 2 ] || { echo "FAIL desktop reply with no prayer passed"; exit 1; }
[ "$(run cli)" = 2 ] || { echo "FAIL terminal reply with no prayer passed"; exit 1; }
echo "ok: prayer-guard skips only claude -p"
