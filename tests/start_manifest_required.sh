#!/usr/bin/env bash
# start.sh refuses a payload that has no SHA256SUMS.txt. Break-it, 2026-10-19:
# with the manifest deleted and setup.sh edited, verification was skipped and
# the install went ahead. Runs start.sh's own verification block, lifted out.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
block="$(awk '/^# A payload with no manifest/{f=1} /^carry_state "\$HOME_DIR.previous"/{f=0} f' "$ROOT/start.sh")"
[ -n "$block" ] || { echo "FAIL: verification block not found in start.sh"; exit 1; }
fail=0
run() {  # run <payload dir>: exit code of the block
  HOME_DIR="$1" REPO=x/y bash -c '
    ok() { :; }; bad() { echo "$1"; }; restore_previous() { echo restored; }
    '"$block"'
    exit 0' >"$T/out" 2>&1
}
mkdir -p "$T/p1"; echo a > "$T/p1/setup.sh"
run "$T/p1"; rc=$?
[ "$rc" -ne 0 ] && grep -q "no SHA256SUMS" "$T/out" && echo "  ok    a payload with no manifest is refused" \
  || { echo "  FAIL  a payload with no manifest went ahead (rc $rc)"; fail=1; }
mkdir -p "$T/p2"; echo a > "$T/p2/setup.sh"; (cd "$T/p2" && shasum -a 256 setup.sh > SHA256SUMS.txt)
run "$T/p2"; rc=$?
[ "$rc" -eq 0 ] && echo "  ok    a payload that matches its manifest goes ahead" || { echo "  FAIL  a good payload was refused"; cat "$T/out"; fail=1; }
echo b >> "$T/p2/setup.sh"
run "$T/p2"; rc=$?
[ "$rc" -ne 0 ] && echo "  ok    a changed file is still refused" || { echo "  FAIL  a changed file went ahead"; fail=1; }
exit "$fail"
