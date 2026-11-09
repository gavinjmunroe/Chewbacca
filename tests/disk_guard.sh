#!/usr/bin/env bash
# disk-guard: quiet with room, prunes once in the background when low, warns
# harder when critical, and never runs two prunes at once.
set -uo pipefail
H="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/disk-guard.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export CHEWBACCA_LOG_DIR="$T/logs"
export CHEWBACCA_DISK_PRUNE_CMD="echo ran >> '$T/pruned'"
fail=0
ok() { if eval "$2"; then echo "  ok    $1"; else echo "  FAIL  $1"; fail=$((fail+1)); fi; }
GB=1048576

out=$(echo '{}' | CHEWBACCA_DISK_FREE_KB=$((100*GB)) bash "$H")
ok "silent with 100 GB free" '[ -z "$out" ] && [ ! -e "$T/pruned" ]'

out=$(echo '{}' | CHEWBACCA_DISK_FREE_KB=$((12*GB)) bash "$H")
sleep 1
ok "low disk says so" 'printf %s "$out" | grep -q "12 GB free"'
ok "and starts a prune" '[ "$(wc -l < "$T/pruned" 2>/dev/null)" -eq 1 ]'
ok "output is one JSON document" 'printf %s "$out" | python3 -c "import json,sys; json.load(sys.stdin)"'

out=$(echo '{}' | CHEWBACCA_DISK_FREE_KB=$((12*GB)) bash "$H")
sleep 1
ok "a second prompt inside 10 minutes does not prune again" '[ "$(wc -l < "$T/pruned")" -eq 1 ]'
ok "but still warns" 'printf %s "$out" | grep -q "Disk is low"'

out=$(echo '{}' | CHEWBACCA_DISK_FREE_KB=$((2*GB)) bash "$H")
ok "critical says stop starting large work" 'printf %s "$out" | grep -q "Below 5 GB"'

rm -f "$CHEWBACCA_LOG_DIR/.disk-guard-stamp"; mkdir "$CHEWBACCA_LOG_DIR/.disk-guard-lock"
echo '{}' | CHEWBACCA_DISK_FREE_KB=$((12*GB)) bash "$H" >/dev/null; sleep 1
ok "a prune already running blocks another" '[ "$(wc -l < "$T/pruned")" -eq 1 ]'

out=$(echo '{}' | CHEWBACCA_DISK_FREE_KB=garbage bash "$H"); rc=$?
ok "unreadable df is ignored" '[ "$rc" = 0 ] && [ -z "$out" ]'

[ "$fail" -eq 0 ] && echo "disk-guard ok" || { echo "disk-guard: $fail failed"; exit 1; }
