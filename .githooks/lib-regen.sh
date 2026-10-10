#!/bin/bash
# Sourced by post-merge, post-commit and post-rewrite. Settles a merge whose
# generated files (SHA256SUMS.txt, README counts) the merge driver deferred:
# see tools/merge_regen.py for why the driver itself never regenerates.
# Never fails the hook: a settle that cannot run leaves pre-push to catch it.
chewbacca_settle() {
  local hook="$1" here tool
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  tool="$here/../tools/merge_regen.py"
  [ -f "$tool" ] || tool="$(git rev-parse --show-toplevel 2>/dev/null)/tools/merge_regen.py"
  if [ -f "$tool" ]; then python3 "$tool" settle "$hook" || true; fi
}
