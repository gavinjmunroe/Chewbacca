#!/usr/bin/env bash
# The fusion guard must refuse a first-name collision and stay silent otherwise.
# Stage 8 of graph-engineering, enforced. It exists because "Jordan Black" was
# written into second-brain as a client's name on a first-name match, and the
# right person was Jordan Grant.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/.claude/hooks/fusion-guard.sh"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
TEST_HOME="$TEST_DIR/home"
mkdir -p "$TEST_HOME/second-brain/core"
printf '**Joel Stone** — synthetic fixture only.\n' > "$TEST_HOME/second-brain/core/people.md"
[ -x "$HOOK" ] || { echo "fusion-guard source missing"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq absent, skipping"; exit 0; }

BRAIN="$TEST_HOME/second-brain"
fail=0
probe() {                       # name, file, content, expected exit
  local code
  printf '{"tool_name":"Write","tool_input":{"file_path":%s,"content":%s}}' \
    "$(jq -Rn --arg v "$2" '$v')" "$(jq -Rn --arg v "$3" '$v')" \
    | env HOME="$TEST_HOME" CHEWBACCA_LOG_DIR="$TEST_DIR/logs" bash "$HOOK" >/dev/null 2>&1
  code=$?
  if [ "$code" = "$4" ]; then printf '  ok    %s (exit %s)\n' "$1" "$code"
  else printf '  FAIL  %s: wanted %s got %s\n' "$1" "$4" "$code"; fail=$((fail+1)); fi
}

echo "refuses a first-name collision in the notes:"
# Joel Stone is on the roster; Joel Keller is not.
probe "new surname, known first name" \
  "$BRAIN/memory/probe_fusion.md" "Met with Joel Keller about the deal." 2

echo "stays out of the way:"
probe "a person already on the roster" \
  "$BRAIN/memory/probe_fusion.md" "Met with Joel Stone about the deal." 0
probe "a first name nobody shares" \
  "$BRAIN/memory/probe_fusion.md" "Met with Quentin Hale about the deal." 0
probe "outside the notes store" \
  "/tmp/probe_fusion.md" "Met with Joel Keller about the deal." 0
probe "no names at all" \
  "$BRAIN/memory/probe_fusion.md" "The build passes and the gates are green." 0

echo
[ "$fail" = 0 ] && echo "stage 8 is enforced, and only where it should be   ok" || echo "$fail failed"
exit "$fail"
