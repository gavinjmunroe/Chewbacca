#!/bin/bash
# design-context gives the model a short note on every prompt and the full block
# only when the model asks. It matches none of his words; whether the model calls
# work "renders" right is measured in tests/eval_intent_notes.py.
set -uo pipefail
HOOK="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/design-context.sh"
pass=0; fail=0
ok(){ printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }
command -v jq >/dev/null 2>&1 || { echo "  skip: jq not installed"; exit 0; }

TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
TEST_HOME="$TEST_DIR/home"
mkdir -p "$TEST_HOME/code/chewbacca/apps/ux-engine"
export HOME="$TEST_HOME" CHEWBACCA_LOG_DIR="$TEST_DIR/logs"

run(){ jq -cn --arg p "$1" '{prompt:$p}' | bash "$HOOK" 2>/dev/null; }

out=$(run "make the hero scroll animation smoother")
printf '%s' "$out" | grep -q "design-context.sh --full" && ok "note names the command" || no "note lost the command"
printf '%s' "$out" | grep -q "400ms TOTAL" && no "the full block leaked into the note" || ok "note stays short"
[ "${#out}" -lt 400 ] && ok "note is under 400 characters" || no "note grew to ${#out}"
out=$(run "fix the failing test in the argument parser")
printf '%s' "$out" | grep -q "design-context.sh --full" && ok "same note on non-design work, the model decides" || no "no note on plain work"

full=$(bash "$HOOK" --full </dev/null 2>/dev/null)
printf '%s' "$full" | grep -q "400ms TOTAL" && ok "--full carries the stagger ceiling" || no "--full lost the stagger ceiling"
printf '%s' "$full" | grep -q "Removal is free" && ok "--full carries the subtraction cue, which moved 41% to 61% on eight words" || no "--full lost the subtraction cue"
if grep -qE "grep -q[a-zA-Z]*E" "$HOOK"; then no "hook still matches words"; else ok "no word matching left"; fi

printf '\n  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
