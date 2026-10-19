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

# Directories both trees have keep what the user added. Break-it, 2026-10-19:
# only top-level names moved back, so a user's own skill, a linked pack skill
# and a bin tool were deleted on update. ~/.chewbacca/skills is the shared
# skill library: 215 entries on the author's Mac against 74 shipped.
p2="$tmp/old2" n2="$tmp/new2"
mkdir -p "$p2/skills/my-own-skill" "$p2/skills/shipped" "$p2/bin" "$tmp/packroot" "$n2/skills/shipped" "$n2/bin"
echo mine > "$p2/skills/my-own-skill/SKILL.md"
echo old > "$p2/skills/shipped/SKILL.md"; echo new > "$n2/skills/shipped/SKILL.md"
ln -s "$tmp/packroot" "$p2/skills/linked-pack-skill"
echo tool > "$p2/bin/my-tool"
carry_state "$p2" "$n2"
expect "a user's own skill survives"          '[ "$(cat "$n2/skills/my-own-skill/SKILL.md" 2>/dev/null)" = mine ]'
expect "a linked pack skill survives"         '[ -L "$n2/skills/linked-pack-skill" ]'
expect "a user's own bin tool survives"       '[ -f "$n2/bin/my-tool" ]'
expect "a shipped skill takes the new copy"   '[ "$(cat "$n2/skills/shipped/SKILL.md")" = new ]'
exit "$fail"
