#!/bin/bash
# plan-guard must refuse a write outside the plan's active phase, and must let
# through a write inside it, a write once the phase's artifacts exist, and any
# write under a repo with no gated PLAN.md.
#
# This file exists because guard_two_sided.sh found plan-guard could refuse
# and had no test at all, from the day it was written (2026-09-27) to
# 2026-10-03.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/.claude/hooks/plan-guard.sh"
pass=0; fail=0
ok(){ printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }

command -v jq >/dev/null 2>&1 || { echo "  skip: jq not installed"; exit 0; }
[ -f "$HOOK" ] || { echo "  plan-guard.sh missing"; exit 1; }

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/gated/measure" "$T/gated/src" "$T/plain/src"
cat > "$T/gated/PLAN.md" <<'EOF'
# Plan

<!-- PLAN-GATES
phase 1 Stop flying blind
requires measure/ledger.md
allows measure/
phase 2 Build
requires src/done.txt
allows src/
-->
EOF

expect() {  # label, wanted exit, file path
  local got
  jq -n --arg f "$3" '{tool_input:{file_path:$f}}' | bash "$HOOK" >/dev/null 2>&1
  got=$?
  if [ "$got" = "$2" ]; then ok "$1 (exit $got)"; else no "$1: wanted $2 got $got"; fi
}

echo "refuses a write that skips the active phase:"
expect "building before the measurement exists" 2 "$T/gated/src/app.js"

echo "permits writes the plan allows:"
expect "a write inside the active phase" 0 "$T/gated/measure/notes.md"
touch "$T/gated/measure/ledger.md"
expect "building once phase 1 produced its artifact" 0 "$T/gated/src/app.js"
expect "a repo with no gated PLAN.md" 0 "$T/plain/src/app.js"

[ "$fail" -eq 0 ] || exit 1
echo "plan-guard: $pass checks passed."
