#!/bin/bash
# assumption-guard must refuse a drawing file whose structure is a modulus or
# an index stagger, and must let through ordinary modulo work (wrapping an
# index) and files that do not draw at all.
#
# This file exists because guard_two_sided.sh found assumption-guard could
# refuse and had no test at all, from the day it was written (2026-09-27) to
# 2026-10-03.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/.claude/hooks/assumption-guard.sh"
pass=0; fail=0
ok(){ printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }

command -v jq >/dev/null 2>&1 || { echo "  skip: jq not installed"; exit 0; }
[ -f "$HOOK" ] || { echo "  assumption-guard.sh missing"; exit 1; }

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT

expect() {  # label, wanted exit, file name, file body
  local f="$T/$3" got
  printf '%s\n' "$4" > "$f"
  jq -n --arg f "$f" '{tool_input:{file_path:$f}}' | bash "$HOOK" >/dev/null 2>&1
  got=$?
  if [ "$got" = "$2" ]; then ok "$1 (exit $got)"; else no "$1: wanted $2 got $got"; fi
}

echo "refuses invented structure in a file that draws:"
expect "the 9/27 every-fourth-brick-fails modulus" 2 wall.js \
'for (let i = 0; i < 42; i++) {
  const el = document.createElement("div");
  const fill = i % 4 === 1 ? "red" : "gray";
  el.style.background = fill;
}'
expect "an index stagger as an animation delay" 2 load.js \
'items.forEach((item, i) => {
  item.style.animationDelay = i * 0.1 + "s";
  item.classList.add("in");
});'

echo "permits ordinary modulo and non-drawing code:"
expect "a modulus that wraps an index" 0 carousel.js \
'const el = document.createElement("img");
const next = slides[(i + 1) % slides.length];
el.setAttribute("src", next);'
expect "a scheduler that never draws" 0 schedule.ts \
'const isRetry = attempt % 3 === 0;
export function backoff(attempt: number) { return attempt * 250; }'
expect "a non-script file" 0 notes.md 'fill: i % 4 === 1'

[ "$fail" -eq 0 ] || exit 1
echo "assumption-guard: $pass checks passed."
