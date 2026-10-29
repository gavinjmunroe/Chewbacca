#!/bin/bash
# pasted-call-gate must refuse a turn that answered a pasted call without the
# pasted-call method, pass one that did all of it, ignore prompts that are not
# transcripts, refuse once per prompt, and hand the method over at prompt time.
# The refused fixture is the 2026-10-29 Roy Scott turn: invite checked, rows
# ledgered, people.md edited, skill never loaded and no texts read.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
H="$ROOT/.claude/hooks/pasted-call-gate.sh"
export TMPDIR=$(mktemp -d)
pass=0; fail=0
ok() { pass=$((pass+1)); }
no() { echo "  FAIL $1"; fail=$((fail+1)); }

CALL=$(python3 - <<'PY'
lines = ["Meeting Title: Anchored OS with Roy", "Date: Oct 29", "", "Transcript:"]
for i in range(10):
    lines += ["Them: Caleb, what's up, my man? How long you been back at school?",
              "Me: Like August 26th. Do you happen to know Jim Monroe?"]
print("\n".join(lines))
PY
)

# spec: P=prompt (uses $PROMPT), then name|json-input tool uses
tt() { # name, want_exit, prompt_id, prompt, tool uses...
  local name="$1" want="$2" pid="$3" prompt="$4"; shift 4
  local tr="$TMPDIR/$pid.jsonl"
  python3 - "$tr" "$prompt" "$@" <<'PY'
import json, sys
out = open(sys.argv[1], "w")
out.write(json.dumps({"type": "user", "message": {"role": "user", "content": sys.argv[2]}}) + "\n")
for spec in sys.argv[3:]:
    name, _, inp = spec.partition("|")
    out.write(json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [
        {"type": "tool_use", "id": "t", "name": name, "input": json.loads(inp)}]}}) + "\n")
    out.write(json.dumps({"type": "user", "message": {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "t", "content": "ok"}]}}) + "\n")
out.write(json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [
    {"type": "text", "text": "Done"}]}}) + "\n")
PY
  printf '{"transcript_path":"%s","prompt_id":"%s"}' "$tr" "$pid" | bash "$H" >/dev/null 2>"$TMPDIR/err"
  rc=$?
  if [ "$rc" = "$want" ]; then ok; else no "$name (exit $rc, wanted $want)"; fi
}

SKILL='Skill|{"skill":"pasted-call"}'
TEXTS='Bash|{"command":"people texts \"Roy Scott\" --limit 30"}'
LEDGER='Bash|{"command":"work-ledger add --scope ~ --source-key roy-x --title t"}'
BRAIN='Write|{"file_path":"/Users/x/second-brain/memory/project_roy_call.md","content":"c"}'

tt "the 10/29 Roy turn is refused" 2 p1 "$CALL" "$LEDGER" 'Edit|{"file_path":"/Users/x/second-brain/core/people.md"}'
grep -q "pasted-call skill" "$TMPDIR/err" && grep -q "people texts" "$TMPDIR/err" && ok || no "refusal names the skill and the texts"
grep -q "work ledger" "$TMPDIR/err" && no "refusal asks for a ledger that was written" || ok
tt "same prompt refuses once" 0 p1 "$CALL"
tt "all four steps pass" 0 p2 "$CALL" "$SKILL" "$TEXTS" "$LEDGER" "$BRAIN"
tt "skill read from disk counts" 0 p3 "$CALL" 'Bash|{"command":"cat ~/code/chewbacca/skills/pasted-call/SKILL.md"}' "$TEXTS" "$LEDGER" "$BRAIN"
tt "no texts read is refused" 2 p4 "$CALL" "$SKILL" "$LEDGER" "$BRAIN"
tt "a normal prompt is ignored" 0 p5 "Fix the build plz" 'Bash|{"command":"ls"}'
tt "a two-line text paste is ignored" 0 p6 "Them: u free?
Me: yeah after 3" 'Bash|{"command":"ls"}'
OTTER=$(for i in $(seq 1 6); do printf 'Jane Doe 00:0%s: we should ship it\nCaleb Newton 00:1%s: agreed\n' "$i" "$i"; done)
tt "an Otter-shaped paste counts" 2 p7 "$OTTER"

out=$(printf '%s' "$(python3 -c 'import json,sys;print(json.dumps({"hook_event_name":"UserPromptSubmit","prompt":sys.argv[1]}))' "$CALL")" | bash "$H")
printf '%s' "$out" | grep -q "pasted-call" && ok || no "prompt mode hands the method over"
out=$(printf '{"hook_event_name":"UserPromptSubmit","prompt":"what is due"}' | bash "$H")
[ -z "$out" ] && ok || no "prompt mode is silent on a normal prompt"
printf 'not json' | bash "$H" >/dev/null 2>&1; [ $? = 0 ] && ok || no "fails open on bad input"

echo "pasted-call-gate: $pass passed, $fail failed"
[ "$fail" = 0 ]
