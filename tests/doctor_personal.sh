#!/usr/bin/env bash
# A personal install is graded as a personal install. On 2026-10-09 a fresh
# personal setup ended with four red "FAIL major" lines (git identity, gh,
# prettier, the brain not being a git repo), none of which a non-developer
# will ever need. To that person, red at the end of setup means "it broke".
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/.claude"
printf 'personal' > "$T/.claude/.chewbacca-profile"
out="$(HOME="$T" GIT_CONFIG_GLOBAL="$T/none" PATH=/usr/bin:/bin bash "$ROOT/doctor.sh" 2>&1)"
fail=0
for line in "no global git identity" "gh not authenticated" "gh missing" "format hook ran but changed nothing" "which is not a git repo"; do
  if printf '%s' "$out" | grep -q "FAIL.*$line"; then echo "  FAIL personal install still fails: $line"; fail=1; fi
done
printf '%s' "$out" | grep -q "which a personal install never needs" || { echo "  FAIL git identity check did not run for the personal profile"; fail=1; }
[ "$fail" -eq 0 ] && echo "  ok   a personal install is not failed for developer tools"
exit "$fail"
