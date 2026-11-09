#!/usr/bin/env bash
# No shipped shell runs `grep -P`. macOS grep has no -P: it prints "invalid option"
# and exits 2, and `if grep -P ...; then fail; fi` reads exit 2 as "no match", so the
# check passes without ever running. On 2026-10-24 the em dash scan in
# anthony-codex-setup's smoke test did exactly that and printed "smoke ok" on a repo
# that still had an em dash in it. Use python3 or grep -E with a $'—' literal.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT" || exit 2
hits="$(git grep -n -E '(^|[^a-z])grep +(-[A-Za-z]*P|--perl-regexp)' -- '*.sh' 'bin/*' 'hooks/*' '.githooks/*' ':!tests/no_grep_p.sh' 2>/dev/null)"
if [ -n "$hits" ]; then
  echo "FAIL: grep -P does nothing on macOS, use python3 or grep -E:"; printf '%s\n' "$hits" | cut -c1-200; exit 1
fi
# The pattern must catch the real failure and leave pgrep -P alone.
printf 'if grep -rIlP x .; then\n' | grep -qE '(^|[^a-z])grep +(-[A-Za-z]*P|--perl-regexp)' || { echo "FAIL: pattern misses grep -rIlP"; exit 1; }
! printf 'pgrep -P 1\n' | grep -qE '(^|[^a-z])grep +(-[A-Za-z]*P|--perl-regexp)' || { echo "FAIL: pattern flags pgrep -P"; exit 1; }
echo "ok: no grep -P"
