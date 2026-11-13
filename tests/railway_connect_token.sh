#!/usr/bin/env bash
# railway-connect reads the login from either key the Railway CLI writes.
# CLI 5.71 writes user.accessToken; reading only user.token said "no Railway
# login" to a signed-in CLI on 2026-11-13. Offline: an unlinked folder stops
# before any API call, so the error tells us whether the token was found.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/bin/railway-connect"
fail=0
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
run() { # $1 = config json; prints stderr
  local home="$tmp/home$RANDOM"; mkdir -p "$home/.railway" "$tmp/work"
  printf '%s' "$1" > "$home/.railway/config.json"
  (cd "$tmp/work" && env -u RAILWAY_API_TOKEN -u RAILWAY_TOKEN HOME="$home" python3 "$BIN" --check 2>&1 >/dev/null)
}
expect() { # $1 label, $2 output, $3 substring
  if printf '%s' "$2" | grep -q "$3"; then echo "ok   $1"; else echo "FAIL $1: got: $2"; fail=1; fi
}
expect "accessToken counts as a login (CLI 5.71)" "$(run '{"user":{"accessToken":"x"},"projects":{}}')" "isn't linked"
expect "token counts as a login (older CLI)" "$(run '{"user":{"token":"x"},"projects":{}}')" "isn't linked"
expect "no token is still refused" "$(run '{"user":{},"projects":{}}')" "no Railway login"
expect "empty accessToken is still refused" "$(run '{"user":{"accessToken":""},"projects":{}}')" "no Railway login"
expect "garbage config is refused, not a crash" "$(run 'not json')" "no Railway login"
exit $fail
