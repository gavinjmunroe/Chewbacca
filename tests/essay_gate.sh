#!/bin/bash
# essay-gate: prose that reads as generated never goes into a Google Doc.
# 2026-10-11, the Mash Up paper. Fixtures are synthetic, built from the shapes
# measured that night, so no one's real paper lives in the repo.
H="${ESSAY_GATE_HOOK:-$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/essay-gate.sh}"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
pass=0; fail=0
mkdir -p "$tmp/specs" "$tmp/nospec"; : > "$tmp/specs/SECTION-SPEC.md"
export ESSAY_SPEC_DIRS="$tmp/specs"
t() { # name, expected_exit, command
  out=$(printf '{"tool_name":"Bash","tool_input":{"command":%s}}' "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$3")" | bash "$H" 2>&1 >/dev/null)
  rc=$?
  if [ "$rc" = "$2" ]; then echo "  ok   $1 (exit $rc)"; pass=$((pass+1));
  else echo "  FAIL $1 (exit $rc, wanted $2) $out"; fail=$((fail+1)); fi
}
python3 - "$tmp" <<'PY'
import json, sys
d = sys.argv[1]
paired = ("Both designers worked with rhythm. Both of them used flat shapes. "
  'Douglas painted "rings of color" (NGA). Miyake made "a laboratory" (MDS). '
  'He said "for the many" (MDS) and "making things" (BoF) and "beauty and joy" (NYT). '
  "It was technical, but it was also democratic. It shapes light, not just clothing. "
  "Both men chose hope. Both reached ordinary people. ") * 8
narrative = ("Aaron Douglas was born on May 26th, 1899 in Topeka Kansas, far away from his eventual "
  "residence in Harlem. He worked in a glass factory and a steel foundry to pay for college, "
  "and he kept painting at night because his mother had. In his cover for God's Trombones, "
  "Johnson compares a preacher's voice to a trombone, and Douglas draws the sound as light "
  "breaking over the congregation (Johnson). ") * 6
def batch(text):
    return {"requests": [{"insertText": {"location": {"index": 10, "tabId": "t.x"}, "text": text}}]}
json.dump(batch(paired), open(f"{d}/slop.json", "w"))
json.dump(batch(narrative), open(f"{d}/human.json", "w"))
json.dump({"requests": [{"replaceAllText": {"containsText": {"text": "Miyaki"}, "replaceText": "Miyake"}}]}, open(f"{d}/typo.json", "w"))
open(f"{d}/inline.txt", "w").write(json.dumps(batch(paired)))
PY
echo "SHOULD BLOCK (exit 2):"
t "batch from a file, the 10/11 shape" 2 "gws docs documents batchUpdate --params '{\"documentId\":\"x\"}' --json \"\$(cat $tmp/slop.json)\""
t "inline json"                         2 "gws docs documents batchUpdate --params '{\"documentId\":\"x\"}' --json '$(cat "$tmp/inline.txt")'"
ESSAY_SPEC_DIRS="$tmp/nospec" t "section with no spec behind it" 2 "gws docs documents batchUpdate --params '{\"documentId\":\"x\"}' --json \"\$(cat $tmp/human.json)\""
echo "SHOULD PASS (exit 0):"
t "hand-written narrative"  0 "gws docs documents batchUpdate --params '{\"documentId\":\"x\"}' --json \"\$(cat $tmp/human.json)\""
t "a typo fix"              0 "gws docs documents batchUpdate --params '{\"documentId\":\"x\"}' --json \"\$(cat $tmp/typo.json)\""
t "reading a doc"           0 "gws docs documents get --params '{\"documentId\":\"x\"}'"
t "unrelated command"       0 "ls ~/Downloads"
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
