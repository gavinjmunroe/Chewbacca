#!/bin/bash
# list-guard must hand list-gate a path with a space in it as ONE file.
# On 2026-10-26 "UCLA founders/firebox-la-partners.csv" split into "./UCLA" and
# "founders/..." and the hook refused a list list-gate had already passed.
set -uo pipefail
HOOK="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/list-guard.sh"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0
ok()  { printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no()  { printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }

mkdir -p "$TMP/UCLA founders"
printf 'full_name,title,organization,email\nJane Roe,Partner,Acme Ventures,jane@acme.com\n' > "$TMP/UCLA founders/clean.csv"
out=$(cd "$TMP" && echo '{}' | bash "$HOOK" 2>/dev/null)
[ -z "$out" ] && ok "clean list in a spaced folder passes" || no "clean list in a spaced folder was refused: $out"

printf 'full_name,title,organization,email\nJane Roe,Partner,Acme Ventures,info@acme.com\n' > "$TMP/UCLA founders/role.csv"
out=$(cd "$TMP" && echo '{}' | bash "$HOOK" 2>/dev/null)
printf '%s' "$out" | grep -q "role.csv: 1 shared mailboxes" && ok "bad list in a spaced folder still fails by its real name" || no "bad list in a spaced folder not caught: $out"

printf '\nlist_guard_spaces: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
