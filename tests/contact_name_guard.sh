#!/bin/bash
# contact-name-guard holds the 2026-11-05 standard: first, real last, then company.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/.claude/hooks/contact-name-guard.sh"
command -v jq >/dev/null 2>&1 || { echo "  skip: jq not installed"; exit 0; }
fail=0
probe() {  # name, expected exit, command
  jq -n --arg c "$3" '{tool_name:"Bash",tool_input:{command:$c}}' | HOOKD_INNER=1 bash "$HOOK" >/dev/null 2>&1
  local got=$?
  if [ "$got" = "$2" ]; then echo "  ok    $1"; else echo "  FAIL  $1: wanted $2 got $got"; fail=$((fail+1)); fi
}
probe "the standard" 0 'mac contacts add --name "Noah Kruse Firebox" --phone +15551234567 --org "Firebox"'
probe "no org, family" 0 'mac contacts add --name "Selah Newton" --phone +15551234567'
probe "two word company" 0 'mac contacts add --name "Josh Brennan Circuit Riders" --org "Circuit Riders"'
probe "case differs" 0 'mac contacts add --name "Noah Kruse FIREBOX" --org "Firebox"'
probe "edit, name only" 0 'mac contacts edit abc --name "Noah Kruse"'
probe "another tool" 0 'echo mac contacts add --name x --org y'
probe "garbage quoting" 0 'mac contacts add --name "Noah'
probe "company missing from name" 2 'mac contacts add --name "Noah Kruse" --org "Firebox"'
probe "last name missing" 2 'mac contacts add --name "Noah Firebox" --org "Firebox"'
probe "company as the only name" 2 'mac contacts add --name "Firebox" --org "Firebox"'
probe "edit breaks it" 2 'mac contacts edit abc --name "Noah Kruse" --org "Firebox"'
probe "equals form" 2 'mac contacts add --name="Noah Kruse" --org=Firebox'
probe "full path" 2 '/opt/homebrew/bin/mac contacts add --name "Noah Kruse" --org Firebox'
probe "second in a chain" 2 'cd ~ && mac contacts add --name "Noah Kruse" --org Firebox'
[ "$fail" = 0 ] && echo "contact-name-guard ok" || echo "$fail failed"
exit "$fail"
