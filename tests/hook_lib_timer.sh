#!/bin/bash
# lib.sh times every hook with perl, not python (feedback_slow_means_broken).
# Measured 2026-10-11 at load 22: a hook that did nothing cost ~175 ms with
# two python3 starts for its timer and ~95 ms with perl, and a dozen hooks run
# on every Bash call. A python3 on PATH that records being called proves the
# timer never reaches for it when perl is there.
set -u
LIB="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/lib.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"
printf '#!/bin/sh\necho called >> "%s/python-called"\nexit 1\n' "$T" > "$T/bin/python3"
chmod +x "$T/bin/python3"
out="$(PATH="$T/bin:$PATH" CHEWBACCA_LOG_DIR="$T/logs" bash -c "source '$LIB'; hook_init timer-test.sh 5; _hook_ms")"
fail=0
case "$out" in ''|*[!0-9]*) echo "FAIL: _hook_ms printed '$out', not milliseconds"; fail=1 ;; esac
[ -f "$T/python-called" ] && { echo "FAIL: the hook timer started python3"; fail=1; }
grep -q '|timer-test.sh|[0-9]*|ok|' "$T/logs/hooks.log" 2>/dev/null || { echo "FAIL: no timed log row"; fail=1; }
[ $fail = 0 ] && echo "hook timer: perl, no python3 start, log row written: ok"
exit $fail
