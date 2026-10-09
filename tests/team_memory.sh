#!/usr/bin/env bash
# Team memory loads into every teammate's session, so the index and the files
# must agree, and nothing private or secret may ride along. Moved here from
# Caleb's private brain on 2026-10-09 ("Everything we save in our memory in
# relation to amber/chewbs/firm foundation should all be mutual in chewbs").
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
DIR="$ROOT/team/memory"
fail=0
for f in "$DIR"/*.md; do
  s="$(basename "$f" .md)"
  case "$s" in MEMORY|README) continue ;; esac
  grep -q "^- $s:" "$DIR/MEMORY.md" || { echo "not in the index: $s"; fail=1; }
done
while read -r s; do
  [ -f "$DIR/$s.md" ] || { echo "index names a missing file: $s"; fail=1; }
done < <(sed -n 's/^- \([a-z0-9_]*\):.*/\1/p' "$DIR/MEMORY.md")
# Key shapes and personal mail. The two +1 numbers in here are Medha's and
# Togari's public agent lines, which anyone can text, so phones are not checked.
if grep -nE 'sk-ant-[A-Za-z0-9_-]{20}|ghp_[A-Za-z0-9]{10}|xox[bp]-[0-9]|AIza[0-9A-Za-z_-]{20}|-----BEGIN [A-Z ]*PRIVATE|@gmail\.com|@usc\.edu' "$DIR"/*.md; then
  echo "secret or personal email in team memory"; fail=1
fi
exit "$fail"
