#!/bin/bash
# Every tool Kyber.app runs from ~/.local/bin must be one setup.sh links there.
# text-command was not, until 2026-10-05: a text to yourself woke Kyber and it
# ran a path that did not exist on any fresh install.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fail=0
for tool in $(grep -rhoE '\.local/bin/[A-Za-z0-9_-]+' "$ROOT/hud/Sources" | sed 's|.*/||' | sort -u); do
  if grep -qE "^for _tool in .*[[:space:]]$tool([[:space:]]|;)|link_tool $tool\$" "$ROOT/setup.sh"; then
    echo "  ok   $tool"
  else
    echo "  FAIL Kyber runs ~/.local/bin/$tool but setup.sh never links it"
    fail=1
  fi
done
exit "$fail"
