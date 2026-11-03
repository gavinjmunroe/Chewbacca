#!/bin/bash
# lecture-gate: a coursework SPEC has to cite the deck that assigned the work.
# 2026-11-02, the ACAD 185 A20 Hero's Journey, built from the dropbox brief
# while the W10S20 lecture that assigned it was never on disk. Synthetic text.
H="${LECTURE_GATE_HOOK:-$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/lecture-gate.sh}"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
pass=0; fail=0
mkdir -p "$tmp/slides/ACAD-185" "$tmp/slides/ACAD-324" "$tmp/work"
echo '{"A20": {"session": "W10S20", "deck": "W10S20 Storytelling for Product Leaders.pdf"}, "A7": {"session": "W3S5", "deck": "W3S5 Pitches.pdf"}}' > "$tmp/slides/ACAD-185/assigned-in.json"
echo '{"A7": {"session": "W2S4", "deck": "W2S4 Other.pdf"}}' > "$tmp/slides/ACAD-324/assigned-in.json"
: > "$tmp/slides/ACAD-185/W10S20 Storytelling for Product Leaders.pdf"
export LECTURE_GATE_SLIDES="$tmp/slides"
t() { # name, expected_exit, json payload
  out=$(printf '%s' "$3" | bash "$H" 2>&1 >/dev/null); rc=$?
  if [ "$rc" = "$2" ]; then echo "  ok   $1 (exit $rc)"; pass=$((pass+1));
  else echo "  FAIL $1 (exit $rc, wanted $2) $out"; fail=$((fail+1)); fi
}
w() { python3 -c 'import json,sys;print(json.dumps({"tool_name":"Write","tool_input":{"file_path":sys.argv[1],"content":sys.argv[2]}}))' "$1" "$2"; }
brief="# A20 Hero's Journey v1 spec
Brief (Brightspace dropbox, ACAD 185): problem statement, solution statement, 15 to 45 slide storyboard, plus a script."
echo "SHOULD BLOCK (exit 2):"
t "the 11/2 shape, brief only"            2 "$(w "$tmp/work/A20-SPEC.md" "$brief")"
out=$(w "$tmp/work/A20-SPEC.md" "$brief" | bash "$H" 2>&1 >/dev/null)
printf '%s' "$out" | grep -q 'W10S20 Storytelling for Product Leaders.pdf' || { echo "  FAIL refusal should name the deck path: $out"; fail=$((fail+1)); }
rm "$tmp/slides/ACAD-185/W10S20 Storytelling for Product Leaders.pdf"
out=$(w "$tmp/work/A20-SPEC.md" "$brief" | bash "$H" 2>&1 >/dev/null)
printf '%s' "$out" | grep -q 'NOT on disk: run brightspace-sync decks ACAD-185' || { echo "  FAIL a missing deck should say how to pull it: $out"; fail=$((fail+1)); }
echo "SHOULD PASS (exit 0):"
t "cites the session"                     0 "$(w "$tmp/work/A20-SPEC.md" "$brief
Lecture: W10S20 asks for an AI-image storyboard.")"
t "cites the deck title"                  0 "$(w "$tmp/work/A20-SPEC.md" "$brief
Per Storytelling for Product Leaders: pictures, not words.")"
t "sources in the body need no deck"    0 "$(w "$tmp/work/A20-SPEC.md" "# A20 spec, W10S20 storyboard
Sources: A7 pitches, A8 interviews (ACAD 185).")"
t "not a SPEC file"                       0 "$(w "$tmp/work/notes.md" "$brief")"
t "A7 is in two courses, none named"      0 "$(w "$tmp/work/A7-SPEC.md" "# A7 pitch spec")"
printf '%s\n' "$brief" > "$tmp/work/A20-SPEC.md"
t "an Edit that adds the session"         0 "$(python3 -c 'import json,sys;print(json.dumps({"tool_name":"Edit","tool_input":{"file_path":sys.argv[1],"old_string":"plus a script.","new_string":"plus a script. W10S20: AI images."}}))' "$tmp/work/A20-SPEC.md")"
t "a Bash call"                           0 '{"tool_name":"Bash","tool_input":{"command":"ls"}}'
LECTURE_GATE_SLIDES="$tmp/none" t "no map on this machine" 0 "$(w "$tmp/work/A20-SPEC.md" "$brief")"
echo "lecture-gate: $pass passed, $fail failed"
[ "$fail" = 0 ]
