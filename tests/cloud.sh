#!/usr/bin/env bash
# chewbacca cloud, offline: usage, an empty list, and list reading an instance's
# secrets file without printing its keys.
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
MODE="${2:-all}"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
mkdir -p "$TEST_DIR/home/.chewbacca/secrets"
run() { env HOME="$TEST_DIR/home" bash "$ROOT/bin/chewbacca-cloud" "$@"; }

case "$MODE" in
  usage)
    run --help | grep -q 'chewbacca cloud up'
    ! run bogus >/dev/null 2>&1
    ;;
  empty)
    run list | grep -q 'No instances yet'
    ;;
  list)
    # Port 9 refuses, so the instance reads as not answering, offline.
    printf 'OWNER_TOKEN=sekret-owner\nMCP_SECRET=sekret-mcp\nURL=http://127.0.0.1:9\n' \
      > "$TEST_DIR/home/.chewbacca/secrets/demo-os.env"
    out="$(run list)"
    printf '%s' "$out" | grep -q 'demo-os'
    printf '%s' "$out" | grep -q 'not answering'
    ! printf '%s' "$out" | grep -q 'sekret'
    ;;
  all)
    "$0" "$ROOT" usage && "$0" "$ROOT" empty && "$0" "$ROOT" list
    ;;
esac
