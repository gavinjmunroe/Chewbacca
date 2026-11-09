#!/usr/bin/env bash
# scope-guard refuses a self-chosen cut when he asked for all of it.
set -uo pipefail
HOOK="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/scope-guard.sh"
command -v jq >/dev/null 2>&1 || { echo "jq absent, skipping"; exit 0; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export CHEWBACCA_LOG_DIR="$TMP/logs"
fail=0

transcript() {   # one user prompt per argument
  local f="$TMP/t.jsonl"; : > "$f"
  for p in "$@"; do jq -cn --arg t "$p" '{type:"user",message:{role:"user",content:$t}}' >> "$f"; done
  # A hook injection is a user row too, and must not count as his words.
  jq -cn '{type:"user",message:{role:"user",content:"<system-reminder>scrape all of everything</system-reminder>"}}' >> "$f"
  printf '%s' "$f"
}
probe() {        # name, expected exit, reply, prompts...
  local name="$1" want="$2" reply="$3"; shift 3
  local t; t=$(transcript "$@")
  jq -cn --arg m "$reply" --arg t "$t" '{last_assistant_message:$m,transcript_path:$t}' \
    | HOOK_JUDGE_STUB="${HOOK_JUDGE_STUB-}" bash "$HOOK" >/dev/null 2>&1
  local got=$?
  if [ "$got" = "$want" ]; then echo "  ok    $name"; else echo "  FAIL  $name: wanted $want got $got"; fail=$((fail+1)); fi
}

ASK="Graph engineer finding a ton of creators like him and then scraping all their stuff too"
CUT="The 36 closest fits get the full pull. Instagram and TikTok are on hold."

# Whether a reply cuts scope is Jev's call. The stub stands in for it. Phrasings
# and live scores: tests/eval_reply_judges_jev.py.
echo "refuses when Jev reads a cut and he asked for all of it:"
HOOK_JUDGE_STUB=0.9 probe "the 2026-10-09 reply" 2 "$CUT" "$ASK"
echo "stays out of the way:"
HOOK_JUDGE_STUB=0.1 probe "Jev reads no cut" 0 "All 238 creators are queued." "$ASK"
HOOK_JUDGE_STUB="" probe "Jev down means no refusal" 0 "$CUT" "$ASK"
HOOK_JUDGE_STUB=0.9 probe "he never said all" 0 "$CUT" "ingest these creators"
HOOK_JUDGE_STUB=0.9 probe "only a hook injection said all" 0 "$CUT" "ok"
HOOK_JUDGE_STUB=0.9 probe "a named blocker" 0 "Instagram is on hold. BLOCKED: Instagram 429s his session." "$ASK"
# hook_judge reads both ends of a long reply and survives a split character. A fake
# jev.py beside a copy of lib.sh, so this never reaches the network.
mkdir -p "$TMP/x/.claude/hooks" "$TMP/x/bin/lib"
cp "$(dirname "$HOOK")/lib.sh" "$TMP/x/.claude/hooks/lib.sh"
cat > "$TMP/x/bin/lib/jev.py" <<'PY'
def ask(state, q, timeout=0, decision=None):
    return {"q": {"noul": 0.5 if state["text"].endswith("THE-END") else 0.1}}
def probability(v): return v
PY
SEEN=$(python3 -I -c 'print("\u2019" * 1000 + "x" * 9000 + "THE-END", end="")' \
  | HOME="$TMP/home" bash -c 'source "$1"; hook_judge t q' _ "$TMP/x/.claude/hooks/lib.sh")
[ "$SEEN" = "0.5" ] && echo "  ok    a long reply keeps its end and its split character" || { echo "  FAIL  long reply: $SEEN"; fail=$((fail+1)); }
if grep -qE 're\.finditer' "$HOOK"; then echo "  FAIL  cut words are back"; fail=$((fail+1)); fi

[ "$fail" = 0 ] && echo "scope-guard ok" || echo "$fail failed"
exit "$fail"
