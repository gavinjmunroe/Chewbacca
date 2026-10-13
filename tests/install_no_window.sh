#!/bin/bash
# Nothing in the install opens a window or a browser, with one kind of
# exception: an open marked `# opens-window: <why>` whose block checks for a
# person at a terminal ([ -t 0 ]) within the 6 lines above it. Agents, the
# suite and piped installs never have one, so they never see a window.
#
# 2026-10-13: start.sh's last step hands a person who ran the installer by
# hand to the Claude app (797a6559, the double-click Setup lane), and this
# check, grep only, went red on it with no way to say the open was deliberate.
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
bad=0
for f in "$ROOT/setup.sh" "$ROOT/start.sh" "$ROOT/bin/bootstrap.sh"; do
  [ -f "$f" ] || continue
  while IFS=: read -r n line; do
    case "$line" in *no-open*) continue ;; esac
    if [[ "$line" == *"# opens-window:"* ]]; then
      start=$((n > 6 ? n - 6 : 1))
      sed -n "${start},${n}p" "$f" | grep -q '\[ -t 0 \]' && continue
      echo "$f:$n: marked opens-window but no [ -t 0 ] check above it: $line"; bad=1; continue
    fi
    echo "$f:$n: $line"; bad=1
  done < <(grep -nE "^[[:space:]]*(open|xdg-open)[[:space:]]|--open\b|webbrowser" "$f" 2>/dev/null)
done
exit "$bad"
