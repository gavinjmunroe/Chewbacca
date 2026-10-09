#!/usr/bin/env bash
# chewbacca apps: a teammate finds and runs a build by name, never by path.
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
MODE="${2:-all}"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
mkdir -p "$TEST_DIR/kit/bin" "$TEST_DIR/kit/apps/site" "$TEST_DIR/kit/apps/bare"
cp "$ROOT/bin/chewbacca-apps" "$TEST_DIR/kit/bin/"
printf 'name: site\ndomain: a synthetic static site\n' > "$TEST_DIR/kit/apps/site/.project"
printf '<p>ok</p>\n' > "$TEST_DIR/kit/apps/site/index.html"
mkdir -p "$TEST_DIR/kit/apps/site/tests"
printf 'def test_ok():\n    assert True\n' > "$TEST_DIR/kit/apps/site/tests/test_ok.py"
run() { env CHEWBACCA_ROOT="$TEST_DIR/kit" bash "$TEST_DIR/kit/bin/chewbacca-apps" "$@"; }
case "$MODE" in
  list) run | grep -q 'site *a synthetic static site' ;;
  test) run test site | grep -q '1 passed' ;;
  missing) ! run run nope 2>/dev/null && ! run run bare 2>/dev/null ;;
  real) [ -f "$ROOT/apps/lemma-replica/index.html" ] && [ -f "$ROOT/apps/lemma-replica/.project" ] ;;
  all) for m in list test missing real; do bash "$0" "$ROOT" "$m"; done ;;
esac
