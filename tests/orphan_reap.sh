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
 8000     1 /usr/bin/python3 /Users/x/code/chewbacca/bin/chewbacca-jobs _run 1010-1200-ab12
 8001  8000 nice -n 19 yt-bulk https://youtube.com/@queued
 5922     1 /opt/homebrew/bin/python3 /private/var/folders/9z/abc/T/tmpkud0vx9e/kit/bin/web.py X 53992
 5923     1 /opt/homebrew/bin/python3 /private/var/folders/9z/abc/T/tmpq1w2e3r4/snapshots/aaaa/bin/svc.sh
 9000     1 /opt/homebrew/bin/python3 /private/var/folders/9z/abc/T/tmpzzz/report.py
 9001     1 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/var/folders/9z/abc/T/chewie-chrome-default
PS
out="$(ORPHAN_REAP_PS="$T/ps.txt" python3 "$ROOT/bin/orphan-reap" --json)"
fail=0
has() { printf '%s' "$out" | python3 -c "import json,sys; sys.exit(0 if $1 in [r['pid'] for r in json.load(sys.stdin)] else 1)"; }
for pid in 85055 77251 77254 33558 5922 5923; do
  has "$pid" && echo "  ok    reaps $pid" || { echo "  FAIL  missed $pid"; fail=$((fail+1)); }
done
for pid in 1 500 510 511 4684 7000 7100 8000 8001 9000 9001; do
  has "$pid" && { echo "  FAIL  would kill $pid"; fail=$((fail+1)); } || echo "  ok    spares $pid"
done

# --pressure: unload Ollama models only when swap is past the limit AND free
# memory is low. Swap stayed at 87% after the 2026-10-19 cleanup with 54% free.
echo '{"models":[{"name":"mxbai-embed-large:latest"},{"name":"nomic-embed-text:latest"}]}' > "$T/ollama.json"
press() { ORPHAN_REAP_PS="$T/ps.txt" ORPHAN_REAP_OLLAMA="$T/ollama.json" ORPHAN_REAP_SWAP="$1" ORPHAN_REAP_FREE="${2:-34}" python3 "$ROOT/bin/orphan-reap" --kill --pressure; }
case "$(press 'total = 12288.00M  used = 10646.81M  free = 1641.19M  (encrypted)')" in
  *"unloaded Ollama models mxbai-embed-large:latest, nomic-embed-text:latest"*) echo "  ok    unloads models at 87% swap (2026-10-19)" ;;
  *) echo "  FAIL  kept models at 87% swap"; fail=$((fail+1)) ;;
esac
case "$(press 'total = 12288.00M  used = 4096.00M  free = 8192.00M  (encrypted)')" in
  *unloaded*) echo "  FAIL  unloaded models at 33% swap"; fail=$((fail+1)) ;;
  *) echo "  ok    leaves models alone at 33% swap" ;;
esac
case "$(press 'total = 0.00M  used = 0.00M  free = 0.00M')" in
  *unloaded*) echo "  FAIL  unloaded models with no swap"; fail=$((fail+1)) ;;
  *) echo "  ok    leaves models alone with no swap" ;;
esac
case "$(press 'total = 11264.00M  used = 9772.00M  free = 1492.00M  (encrypted)' 54)" in
  *unloaded*) echo "  FAIL  unloaded models at 87% swap with 54% free"; fail=$((fail+1)) ;;
  *) echo "  ok    leaves models alone when swap is stale but memory is free" ;;
esac
case "$(ORPHAN_REAP_PS="$T/ps.txt" ORPHAN_REAP_OLLAMA="$T/ollama.json" ORPHAN_REAP_SWAP='total = 100.00M  used = 99.00M' ORPHAN_REAP_FREE=20 python3 "$ROOT/bin/orphan-reap" --pressure)" in
  *"would unload"*) echo "  ok    without --kill it only says what it would unload" ;;
  *) echo "  FAIL  claimed an unload it didn't do"; fail=$((fail+1)) ;;
esac
json="$(ORPHAN_REAP_PS="$T/ps.txt" ORPHAN_REAP_OLLAMA="$T/ollama.json" ORPHAN_REAP_SWAP='total = 100.00M  used = 99.00M' ORPHAN_REAP_FREE=20 python3 "$ROOT/bin/orphan-reap" --json --pressure)"
printf '%s' "$json" | python3 -c 'import json,sys; json.load(sys.stdin)' && echo "  ok    --json stays valid under --pressure" || { echo "  FAIL  --json broken by --pressure"; fail=$((fail+1)); }


# --min-age: on the timer a young ppid-1 job may belong to a live tab.
cat > "$T/aged.txt" <<'PS'
  700     1    01:30 /opt/homebrew/bin/python3 /private/var/folders/9z/abc/T/tmpyoung1/kit/bin/web.py X 1
  701     1 16:13:55 /opt/homebrew/bin/python3 /private/var/folders/9z/abc/T/tmpold0001/kit/bin/web.py X 2
  702     1 1-02:00:00 /bin/zsh -c source /Users/x/.claude/shell-snapshots/snapshot-zsh-9.sh && yt-bulk x
PS
aged="$(ORPHAN_REAP_PS="$T/aged.txt" python3 "$ROOT/bin/orphan-reap" --json --min-age 7200)"
case "$aged" in *'"pid": 700'*) echo "  FAIL  timer reaped a 90 s old job"; fail=$((fail+1)) ;; *) echo "  ok    timer spares a 90 s old job" ;; esac
case "$aged" in *'"pid": 701'*'"pid": 702'*|*'"pid": 702'*'"pid": 701'*) echo "  ok    timer reaps 16 h and 1 day old jobs" ;; *) echo "  FAIL  timer missed old jobs: $aged"; fail=$((fail+1)) ;; esac
now="$(ORPHAN_REAP_PS="$T/aged.txt" python3 "$ROOT/bin/orphan-reap" --json)"
case "$now" in *'"pid": 700'*) echo "  ok    SessionStart (no --min-age) reaps at once" ;; *) echo "  FAIL  no --min-age spared a young orphan"; fail=$((fail+1)) ;; esac

# The daemon runs services with no /usr/sbin on PATH; --pressure must still work.
if PATH=/usr/bin:/bin ORPHAN_REAP_PS="$T/ps.txt" ORPHAN_REAP_OLLAMA="$T/ollama.json" /usr/bin/python3 "$ROOT/bin/orphan-reap" --pressure >/dev/null 2>"$T/err"; then
  echo "  ok    --pressure runs on the daemon PATH"
else echo "  FAIL  --pressure crashed on the daemon PATH: $(tail -1 "$T/err")"; fail=$((fail+1)); fi

# OLLAMA_HOST forms resolve the way Ollama reads them.
for pair in "0.0.0.0|http://0.0.0.0:11434" "127.0.0.1:9999|http://127.0.0.1:9999" "|http://127.0.0.1:11434" "https://box.local|https://box.local:11434"; do
  got="$(OLLAMA_HOST="${pair%%|*}" /usr/bin/python3 -c "import importlib.machinery,importlib.util,sys; l=importlib.machinery.SourceFileLoader('r', sys.argv[1]); m=importlib.util.module_from_spec(importlib.util.spec_from_loader('r', l)); l.exec_module(m); print(m.OLLAMA)" "$ROOT/bin/orphan-reap")"
  [ "$got" = "${pair#*|}" ] && echo "  ok    OLLAMA_HOST '${pair%%|*}' -> $got" || { echo "  FAIL  OLLAMA_HOST '${pair%%|*}' -> $got"; fail=$((fail+1)); }
done

[ "$fail" = 0 ] && echo "orphan-reap ok"
exit "$fail"
