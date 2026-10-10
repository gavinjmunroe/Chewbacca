#!/bin/bash
# chewbacca email's Google sign-in must ask for calendar WRITE and drop gws's
# token cache after login. With calendar.readonly every event add 403'd, and
# the cached token kept the old scopes after a fresh login (2026-10-09).
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
f="$ROOT/bin/chewbacca-email"
fail=0
scopes=$(grep -o '^SCOPES="[^"]*"' "$f")
printf '%s' "$scopes" | grep -q 'auth/calendar"' || { echo "FAIL: sign-in scopes lack calendar write: $scopes"; fail=1; }
printf '%s' "$scopes" | grep -q 'calendar.readonly' && { echo "FAIL: calendar is read-only in sign-in scopes"; fail=1; }
grep -q 'rm -f "$cfg/token_cache.json"' "$f" || { echo "FAIL: login no longer clears the stale token cache"; fail=1; }
grep -q 'login_hint' "$f" || { echo "FAIL: login no longer pins the account with login_hint"; fail=1; }
[ $fail -eq 0 ] && echo "ok: chewbacca email scopes"
exit $fail
