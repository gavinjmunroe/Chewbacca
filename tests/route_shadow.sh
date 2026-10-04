#!/bin/bash
# The router shadow log: brain-recall.sh and skill-route.sh append one row per
# prompt to ~/.chewbacca/state/route-shadow.jsonl, silent prompts included, and
# the logging can neither fail a hook nor write inside a git work tree.
# bin/route-label turns rows into labels, one key per row.
#
# Temp HOME throughout, so nothing here touches the real log.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BR="$ROOT/.claude/hooks/brain-recall.sh"
SR="$ROOT/.claude/hooks/skill-route.sh"
T=$(mktemp -d); trap 'chmod -R u+w "$T" 2>/dev/null; rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME"
unset ROUTE_SHADOW_LOG ROUTE_LABELS CHEWBACCA_HOME
LOG="$HOME/.chewbacca/state/route-shadow.jsonl"
pass=0; fail=0
ok() { if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "  pass  $1"; else fail=$((fail+1)); echo "  FAIL  $1"; echo "        got: $2  wanted: $3"; fi; }
# eval reads expressions written in this file only, never log content.
field() { python3 -c 'import json,sys; r=[json.loads(l) for l in open(sys.argv[1])][int(sys.argv[2])]; v=eval(sys.argv[3],{},{"r":r}); print(v)' "$@"; }

mkdir -p "$T/bin"
cat > "$T/bin/brain" <<'OUT'
#!/bin/sh
cat <<'EOF'
# brain mode=hybrid files=2 chunks=2

[1] memory/user_a.md#7. A heading with spaces cos=0.76
    the strong one

[2] memory/user_b.md cos=0.41
    the weak one
EOF
OUT
chmod +x "$T/bin/brain"
brain_run() { printf '{"prompt":"%s","session_id":"s1"}' "$1" | PATH="$T/bin:/usr/bin:/bin" bash "$BR"; }

out=$(brain_run "what did my mentor say about loneliness")
ok "brain-recall still prints its hit" "$(echo "$out" | grep -c 'memory/user_a.md')" "1"
ok "one row landed in the private log" "$(wc -l < "$LOG" | tr -d ' ')" "1"
ok "row carries hook and session" "$(field "$LOG" 0 'r["hook"]+"/"+r["session_id"]')" "brain-recall/s1"
ok "top candidates are sorted, anchors with spaces parsed" "$(field "$LOG" 0 '[c["name"] for c in r["candidates"]]')" "['memory/user_a.md', 'memory/user_b.md']"
ok "shown is what cleared the bar" "$(field "$LOG" 0 'r["shown"]')" "['memory/user_a.md']"
ok "prompt is hashed and cut to 80" "$(field "$LOG" 0 'len(r["prompt_sha"])==16 and r["prompt80"].startswith("what did")')" "True"
ok "log is private (0600)" "$(stat -f '%Lp' "$LOG" 2>/dev/null || stat -c '%a' "$LOG")" "600"

brain_run "hi there" >/dev/null
ok "a gated prompt still logs, with the gate named" "$(field "$LOG" 1 'r["gate"]')" "short-or-slash"
printf '{"prompt":"what did my mentor say about loneliness"}' | PATH="/usr/bin:/bin" bash "$BR" >/dev/null
ok "no brain on PATH still logs" "$(field "$LOG" 2 'r["gate"]')" "no-brain"

# skill-route on the keyword fallback, Ollama unreachable.
sr_run() { printf '{"prompt":"%s","session_id":"s2","cwd":"%s"}' "$1" "$ROOT" \
  | OLLAMA_HOST=http://127.0.0.1:9 SKILL_ROUTE_NO_VECTOR=1 bash "$SR"; }
out=$(sr_run "build a knowledge graph and dedupe entities across sources")
ok "skill-route still routes" "$(echo "$out" | grep -c graph-engineering)" "1"
ok "skill-route logged a stem row" "$(field "$LOG" 3 'r["hook"]+"/"+r["method"]+"/"+str("graph-engineering" in r["shown"])')" "skill-route/stem/True"
out=$(sr_run "whats the weather like today")
ok "a silent skill-route prompt still logs" "$(field "$LOG" 4 'r["shown"]')" "[]"

# Inside a git work tree: refuse, whether named directly or via CHEWBACCA_HOME.
mkdir -p "$T/repo" && git -C "$T/repo" init -q
before=$(brain_run "what did my mentor say about loneliness")
after=$(ROUTE_SHADOW_LOG="$T/repo/state/route-shadow.jsonl" brain_run "what did my mentor say about loneliness")
ok "in-repo log path: output unchanged" "$after" "$before"
ok "in-repo log path: nothing written" "$(find "$T/repo" -name '*.jsonl' | wc -l | tr -d ' ')" "0"
CHEWBACCA_HOME="$T/repo/.chewbacca" sr_run "build a knowledge graph and dedupe entities across sources" >/dev/null
ok "CHEWBACCA_HOME inside a repo: nothing written" "$(find "$T/repo" -name 'route-shadow*' | wc -l | tr -d ' ')" "0"
ok "symlink into a repo is resolved and refused" "$(ln -s "$T/repo" "$T/link"; ROUTE_SHADOW_LOG="$T/link/x.jsonl" brain_run "what did my mentor say about loneliness" >/dev/null; ls "$T/repo" | grep -c jsonl)" "0"

# Logging that cannot write must not fail or slow the hook.
touch "$T/afile"
start=$(python3 -c 'import time;print(time.time())')
out=$(ROUTE_SHADOW_LOG="$T/afile/x.jsonl" brain_run "what did my mentor say about loneliness"); rc=$?
ok "unwritable log: hook exits 0" "$rc" "0"
ok "unwritable log: output intact" "$(echo "$out" | grep -c 'memory/user_a.md')" "1"
mkdir -p "$T/ro" && chmod 500 "$T/ro"
printf '{"prompt":"build a knowledge graph and dedupe entities across sources","cwd":"%s"}' "$ROOT" \
  | ROUTE_SHADOW_LOG="$T/ro/x.jsonl" SKILL_ROUTE_NO_VECTOR=1 bash "$SR" >/dev/null; rc=$?
ok "read-only log dir: skill-route exits 0" "$rc" "0"
elapsed=$(python3 -c "import time;print(int(time.time()-$start))")
ok "failed logging adds no wait (under 5s for both)" "$([ "$elapsed" -lt 5 ] && echo yes || echo "${elapsed}s")" "yes"

# route-label: one key per row, labels beside the log, never inside a repo.
LAB="$HOME/.chewbacca/state/route-labels.jsonl"
ok "route-label counts what waits" "$(python3 "$ROOT/bin/route-label" --stats | head -1)" "6 rows logged, 1 waiting for a label"
printf '1' | python3 "$ROOT/bin/route-label" >/dev/null
ok "key 1 labels the first candidate" "$(field "$LAB" 0 'r["truth"]+"/"+r["hook"]')" "memory/user_a.md/brain-recall"
ok "label carries the candidates for the tuner" "$(field "$LAB" 0 'len(r["candidates"])')" "2"
ok "a labeled row is not asked again" "$(printf 'n' | python3 "$ROOT/bin/route-label")" "Nothing to label."
brain_run "a different question about my mentor entirely" >/dev/null
printf 'n' | python3 "$ROOT/bin/route-label" >/dev/null
ok "key n means nothing fits" "$(field "$LAB" 1 'str(r["truth"])+"/"+str(r["outside"])')" "None/False"
ok "route-label refuses a labels path inside a repo" "$(ROUTE_LABELS="$T/repo/l.jsonl" python3 "$ROOT/bin/route-label" </dev/null >/dev/null 2>&1; echo $?)" "2"

echo; echo "$pass passed, $fail failed"; [ "$fail" -eq 0 ]
