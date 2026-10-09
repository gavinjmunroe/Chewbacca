#!/usr/bin/env bash
# orphan-reap finds what a dead tab left running and nothing else.
# Fixture rows are the real 2026-10-10 offenders plus the jobs that must live.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
cat > "$T/ps.txt" <<'PS'
    1     0 /sbin/launchd
  500     1 /Applications/Claude.app/Contents/MacOS/Claude
  510   500 /bin/zsh -c source /Users/x/.claude/shell-snapshots/snapshot-zsh-1.sh && nice -n 19 yt-bulk https://youtube.com/@live
  511   510 /usr/bin/python3 /Users/x/.local/bin/yt-bulk https://youtube.com/@live
85055     1 /Users/x/.chewbacca/jev-ultrafast/.venv/bin/python /Users/x/code/chewbacca/.claude/worktrees/agent-a815/bin/clay-map crawl --resume --max-passes 6
77251     1 /bin/zsh -c source /Users/x/.claude/shell-snapshots/snapshot-zsh-2.sh && python3 tools/ingest_all.py list
77254 77251 /opt/homebrew/bin/python3 -I tools/ingest_all.py list
33558     1 /Applications/Nalana.app/Contents/MacOS/Nalana -b --factory-startup --python shot6.py
 4684     1 /Applications/Ollama.app/Contents/MacOS/Ollama hidden
 7000     1 /Users/x/.chewbacca/runtime/node /Users/x/code/chewbacca/bin/people texts refresh
 7100     1 /Applications/Blender.app/Contents/MacOS/Blender
 8000     1 /usr/bin/python3 /Users/x/code/chewbacca/bin/jobs _run 1010-1200-ab12
 8001  8000 nice -n 19 yt-bulk https://youtube.com/@queued
PS
out="$(ORPHAN_REAP_PS="$T/ps.txt" python3 "$ROOT/bin/orphan-reap" --json)"
fail=0
has() { printf '%s' "$out" | python3 -c "import json,sys; sys.exit(0 if $1 in [r['pid'] for r in json.load(sys.stdin)] else 1)"; }
for pid in 85055 77251 77254 33558; do
  has "$pid" && echo "  ok    reaps $pid" || { echo "  FAIL  missed $pid"; fail=$((fail+1)); }
done
for pid in 1 500 510 511 4684 7000 7100 8000 8001; do
  has "$pid" && { echo "  FAIL  would kill $pid"; fail=$((fail+1)); } || echo "  ok    spares $pid"
done
[ "$fail" = 0 ] && echo "orphan-reap ok"
exit "$fail"
