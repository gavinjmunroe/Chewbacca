#!/bin/bash
# plan-review-receipt writes what a real subagent found next to the plan, and writes
# nothing for a launch notice, a one-liner, or a file that isn't a big plan.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/.claude/hooks/plan-review-receipt.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0; ok() { printf '  ok   %s\n' "$1"; }; no() { printf '  FAIL %s\n' "$1"; fail=1; }
PLAN="$T/PLAN.md"; RECEIPT="$T/PLAN.review.json"
printf '# P\n\n## Outcome\n\nx\n\n## Riskiest assumptions\n\n- y\n' > "$PLAN"
printf '# notes\n' > "$T/notes.md"
send() {  # prompt, response text
  python3 -c 'import json,sys; print(json.dumps({"tool_input":{"prompt":sys.argv[1],"description":"Break it"},"tool_response":{"content":[{"type":"text","text":sys.argv[2]}]}}))' "$1" "$2" | bash "$HOOK" > "$T/out" 2>&1
  echo $?
}
LONG="$(python3 -c 'print("Phase 1 tests the wrong product, and here is how it fails. " * 10)')"

[ "$(send "Read $PLAN. How does it fail?" "$LONG")" = 0 ] && grep -q "tests the wrong product" "$RECEIPT" && ok "a real review writes its findings" || no "review: $(cat "$T/out")"
python3 -c 'import json,sys; sys.path.insert(0,sys.argv[1]+"/bin/lib"); import plan_core as p; r=json.load(open(sys.argv[2])); sys.exit(0 if r["reviews"][0]["core"]==p.core_hash(open(sys.argv[3]).read()) else 1)' "$ROOT" "$RECEIPT" "$PLAN" && ok "it records which version of the plan got reviewed" || no "core"
send "Read $PLAN again" "$LONG" > /dev/null; [ "$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["reviews"]))' "$RECEIPT")" = 2 ] && ok "a second review adds to the first" || no "second"
rm -f "$RECEIPT"
send "Read $PLAN" "Async agent launched successfully. agentId: x $LONG" > /dev/null; [ ! -e "$RECEIPT" ] && ok "a launch notice as text writes nothing" || no "launch"
# How it really arrives: a launch with metadata, then a notification with the result.
export PLAN_REVIEW_STATE="$T/pending"
launch() { python3 -c 'import json,sys; print(json.dumps({"tool_input":{"prompt":sys.argv[1],"description":"Break it"},"tool_response":{"isAsync":True,"status":"async_launched","agentId":"abc123","prompt":sys.argv[1],"outputFile":"/tmp/"+"x"*400}}))' "$1" | bash "$HOOK"; }
notify() { python3 -c 'import json,sys; print(json.dumps({"prompt":sys.argv[1]}))' "$1" | bash "$HOOK"; }
launch "Read $PLAN. How does it fail?"; [ ! -e "$RECEIPT" ] && [ -f "$T/pending/abc123.json" ] && ok "a real launch's metadata is no review, it only notes the plan" || no "launch metadata: $(cat "$RECEIPT" 2>/dev/null)"
notify "hello there"; [ ! -e "$RECEIPT" ] && ok "a person's message writes nothing" || no "plain prompt"
notify "<task-notification><task-id>other</task-id><status>completed</status><result>$LONG</result></task-notification>"; [ ! -e "$RECEIPT" ] && ok "another agent's result writes nothing" || no "other agent"
notify "<task-notification><task-id>abc123</task-id><status>failed</status><result>$LONG</result></task-notification>"; [ ! -e "$RECEIPT" ] && ok "a failed agent writes nothing" || no "failed agent"
notify "<task-notification><task-id>abc123</task-id><status>completed</status><result>nah</result></task-notification>"; [ ! -e "$RECEIPT" ] && ok "a one-line result writes nothing" || no "short result"
launch "Read $PLAN. How does it fail?"
notify "<task-notification><task-id>abc123</task-id><summary>x</summary><status>completed</status><result>$LONG</result></task-notification>"; grep -q "tests the wrong product" "$RECEIPT" && [ ! -e "$T/pending/abc123.json" ] && ok "the finished agent's real result writes the receipt" || no "real result: $(cat "$RECEIPT" 2>/dev/null)"
rm -f "$RECEIPT"
send "Read $PLAN" "looks good to me" > /dev/null; [ ! -e "$RECEIPT" ] && ok "a one-liner writes nothing" || no "short"
send "Read the plan and tell me how it fails" "$LONG" > /dev/null; [ ! -e "$RECEIPT" ] && ok "no path in the prompt writes nothing" || no "no path"
send "Read $T/notes.md" "$LONG" > /dev/null; [ ! -e "$T/notes.review.json" ] && ok "a file that isn't a big plan writes nothing" || no "not a plan"
[ "$(printf 'not json' | bash "$HOOK" > /dev/null 2>&1; echo $?)" = 0 ] && ok "bad input never breaks the tool call" || no "bad input"
exit "$fail"
