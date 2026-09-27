#!/usr/bin/env bash
# The public suite must never rely on private backlog content or real HOME.
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
MODE="${2:-all}"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
mkdir -p "$TEST_DIR/home" "$TEST_DIR/private" "$TEST_DIR/checkout/bin"
# Copy the entry point so its beside-checkout fallback is also isolated.
cp "$ROOT/bin/backlog" "$TEST_DIR/checkout/bin/backlog"
cat > "$TEST_DIR/private/BACKLOG.md" <<'MD'
# Synthetic backlog

## Now
| # | Item | Status |
| --- | --- | --- |
| 1 | Inspect a synthetic fixture | open |

## Dead
| Item | Reason |
| --- | --- |
| Removed experiment | Replaced |
MD
run() {
  env HOME="$TEST_DIR/home" CHEWBACCA_PRIVATE="$TEST_DIR/private" \
    python3 "$TEST_DIR/checkout/bin/backlog" "$@"
}
case "$MODE" in
  open) run | grep -q '1 open now' ;;
  dead)
    output="$(run dead)"
    [[ "$output" == *'Removed experiment'* && "$output" == *'Replaced'* ]]
    ;;
  absent)
    rm "$TEST_DIR/private/BACKLOG.md"
    run | grep -q 'No backlog on this machine'
    ;;
  *) echo 'Expected open, dead, or absent' >&2; exit 2 ;;
esac
