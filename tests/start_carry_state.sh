#!/bin/bash
# An update through start.sh keeps the state that lives in ~/.chewbacca.
# start.sh downloads from GitHub, so this runs its carry_state function alone,
# lifted out of the script, against a fake old and new install.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fn="$(awk '/^carry_state\(\) \{/,/^}/' "$ROOT/start.sh")"
[ -n "$fn" ] || { echo "FAIL: carry_state not found in start.sh"; exit 1; }
eval "$fn"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
prev="$tmp/old" new="$tmp/new"
mkdir -p "$prev/people" "$prev/logs" "$prev/bin" "$prev/superassistant" "$new/bin" "$new/superassistant"
echo db > "$prev/people/people.db"
echo log > "$prev/logs/hooks.log"
echo '{}' > "$prev/context.json"
echo hidden > "$prev/.marker"
echo said > "$prev/superassistant/questions.jsonl"
echo old > "$prev/bin/tool"
echo new > "$new/bin/tool"
echo readme > "$new/superassistant/README.md"

carry_state "$prev" "$new"

fail=0
expect() { if eval "$2"; then echo "  ok   $1"; else echo "  FAIL $1"; fail=1; fi; }
expect "the people database survives"        '[ "$(cat "$new/people/people.db")" = db ]'
expect "logs survive"                         '[ -f "$new/logs/hooks.log" ]'
expect "top-level state files survive"        '[ -f "$new/context.json" ] && [ -f "$new/.marker" ]'
expect "the voice log survives"               '[ "$(cat "$new/superassistant/questions.jsonl")" = said ]'
expect "the new release wins over old files"  '[ "$(cat "$new/bin/tool")" = new ]'
expect "a missing previous install is fine"   'carry_state "$tmp/none" "$new"'
exit "$fail"
