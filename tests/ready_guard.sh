#!/usr/bin/env bash
# ready-guard refuses a launch-ready claim without a fresh, signed READY from
# `chewbacca gtme ready`. The first probe is the 2026-10-12 reply word for word.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/.claude/hooks/ready-guard.sh"
command -v jq >/dev/null 2>&1 || { echo "jq absent, skipping"; exit 0; }
TMP=$(cd "$(mktemp -d)" && pwd -P); trap 'rm -rf "$TMP"' EXIT
export CHEWBACCA_LOG_DIR="$TMP/logs" TMPDIR="$TMP/tmp" HOME="$TMP/home"
export CHEWBACCA_STATE_DIR="$TMP/state" GTME_GRADE_KEY_FILE="$TMP/keys/gtme-grade.key"
export GTME_CLIENTS="$TMP/clients.json" CHEWBACCA_GTM_CLIENTS="$TMP/clients.json"
mkdir -p "$TMPDIR" "$HOME"
cat > "$GTME_CLIENTS" <<'JSON'
{"clients": [{"name": "Zeutara", "principal": "Jonah Graham"}, {"name": "Firm Foundation SoCal"}]}
JSON
echo '[{"company": "Ivy", "tier": "A", "campaign": "cam_x1"}]' > "$TMP/drafts.json"
fail=0
n=0

# A transcript: his prompt, one tool call, and a skill-list injection that
# mentions campaigns (every session has one; it must not count as GTM work).
transcript() {   # prompt, tool command
  local f="$TMP/t$RANDOM.jsonl"
  jq -cn --arg t "$1" '{type:"user",message:{role:"user",content:$t}}' > "$f"
  jq -cn '{type:"user",message:{role:"user",content:"<system-reminder>skills: clay campaigns outbound</system-reminder>"}}' >> "$f"
  jq -cn --arg c "$2" '{type:"assistant",message:{role:"assistant",content:[{type:"tool_use",name:"Bash",input:{command:$c}}]}}' >> "$f"
  printf '%s' "$f"
}
GTM_T=$(transcript "check the monday launch" "chewbacca clay campaign ws=1 campaign=cam_x1")
PLAIN_T=$(transcript "fix the css on the site" "npm run build")

probe() {        # name, expected exit, reply, transcript
  n=$((n+1))
  jq -cn --arg m "$3" --arg t "$4" --arg p "probe$n" '{last_assistant_message:$m,transcript_path:$t,prompt_id:$p}' \
    | bash "$HOOK" >"$TMP/out" 2>"$TMP/err"
  local got=$?
  if [ "$got" = "$2" ]; then echo "  ok    $1"; else echo "  FAIL  $1: wanted $2 got $got"; cat "$TMP/err"; fail=$((fail+1)); fi
}

write_result() { # verdict, blockers, age seconds
  python3 -I - "$ROOT/tools" "$1" "$2" "$3" "$TMP/drafts.json" <<'PY'
import sys, time
sys.path.insert(0, sys.argv[1])
import gtme_ready
verdict, blockers, age, drafts = sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
gtme_ready.write_result("Zeutara", {"v": 1, "client": "Zeutara", "time": int(time.time()) - age,
                                    "verdict": verdict, "blockers": blockers,
                                    "drafts": gtme_ready.drafts_identity(drafts), "checks": [], "campaigns": []})
PY
}

echo "refuses with no READY on file:"
probe "the 2026-10-12 reply: good until Jonah responds" 2 \
  "Copy is pushed and graded. We're good until Jonah responds with the footer address." "$GTM_T"
grep -q 'chewbacca gtme ready --client "Zeutara"' "$TMP/err" \
  && echo "  ok    the refusal names the command and the client" \
  || { echo "  FAIL  refusal text"; cat "$TMP/err"; fail=$((fail+1)); }
grep -qi "do not repeat it" "$TMP/err" \
  && echo "  ok    the refusal asks for an added line, never the reply again" \
  || { echo "  FAIL  refusal asks to repeat"; fail=$((fail+1)); }
probe "only waiting on X" 2 "All 14 drafts are set. Only waiting on Jonah's address." "$GTM_T"
probe "just needs X" 2 "The launch just needs the footer, then we start." "$GTM_T"
probe "ready to launch" 2 "Tier A is ready to launch Monday." "$GTM_T"
probe "perfect" 2 "Perfect, the campaigns look right." "$GTM_T"
probe "good to go, no client named in the reply" 2 "Everything is good to go." "$GTM_T"

write_result "NOT READY" 12 0
probe "a NOT READY result on file does not unlock it" 2 "We're good to go on the launch." "$GTM_T"
write_result "READY" 0 $((3 * 3600))
probe "a READY over 2 hours old does not unlock it" 2 "We're good to go on the launch." "$GTM_T"
write_result "READY" 0 60
cp "$CHEWBACCA_STATE_DIR/gtme-ready/zeutara.json" "$TMP/good.json"
python3 -I - "$CHEWBACCA_STATE_DIR/gtme-ready/zeutara.json" <<'PY'
import json, sys
p = sys.argv[1]; b = json.load(open(p)); b["blockers"] = 0; b["verdict"] = "READY"; b["client"] = "Zeutara!"
json.dump(b, open(p, "w"))
PY
probe "a hand-edited READY (bad signature) does not unlock it" 2 "We're good to go on the launch." "$GTM_T"

echo "lets through:"
cp "$TMP/good.json" "$CHEWBACCA_STATE_DIR/gtme-ready/zeutara.json"
probe "a fresh signed READY for the client" 0 "We're good to go on the Zeutara launch." "$GTM_T"
probe "the same, named by Jonah" 0 "Good until Jonah responds, then it starts." "$GTM_T"
rm -f "$CHEWBACCA_STATE_DIR/gtme-ready/zeutara.json"
probe "an honest NOT READY report" 0 "NOT READY: 37 blockers. Ivy A: gate 3 NOT CHECKED, no recipient read." "$GTM_T"
probe "a negated claim" 0 "Tier A is not ready to launch: the pre-send receipt expired." "$GTM_T"
probe "a question" 0 "Is the launch ready to go?" "$GTM_T"
probe "no readiness claim" 0 "Pushed the copy to all 14 drafts and graded them." "$GTM_T"
probe "a claim in a session with no GTM work" 0 "The build is good to go." "$PLAIN_T"
probe "school progress in a GTM session (manager tab, 2026-10-16)" 0 \
  "A13 is done, and A14 only needs ur engagement-metrics cell." "$GTM_T"
probe "the same shape about a launch still refuses" 2 \
  "Ivy A is done, and the launch only needs the footer." "$GTM_T"
probe "a quoted claim in a report about the guard (2026-10-16)" 0 \
  "The guard was refusing \"A13 is done, and A14 only needs ur engagement-metrics cell\" because the session touched campaigns. A launch phrase still counts." "$GTM_T"
# Once per turn: a second Stop in the same turn never loops.
jq -cn --arg m "We're good to go on the launch." --arg t "$GTM_T" '{last_assistant_message:$m,transcript_path:$t,prompt_id:"probe1"}' \
  | bash "$HOOK" >/dev/null 2>&1 && echo "  ok    fires once per turn" || { echo "  FAIL  fired twice in one turn"; fail=$((fail+1)); }

[ "$fail" = 0 ] && echo "ready-guard ok" || echo "$fail failed"
exit "$fail"
