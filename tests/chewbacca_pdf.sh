#!/bin/bash
# chewbacca pdf turns markdown into a PDF fast and never waits on Chrome.
# 2026-10-11: a hand-rolled pandoc + Chrome print hung after the PDF was written
# ("this should be a 2 sec task"); the fix already lived inside gtme_operator.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
printf '# Brief\n\n- one point\n\n- [a link](https://example.com)\n' > "$T/brief.md"
printf 'Plain text to paste.\n' > "$T/note.txt"
fail=0
start=$(date +%s)
python3 "$ROOT/bin/chewbacca-pdf" "$T/brief.md" "$T/note.txt" --out "$T/out" > "$T/log" 2>&1
code=$?
took=$(( $(date +%s) - start ))
cat "$T/log"
[ "$code" = 0 ] && echo "ok    exit 0" || { echo "FAIL  exit $code"; fail=1; }
for f in brief note; do
  if [ -s "$T/out/$f.pdf" ] && head -c 5 "$T/out/$f.pdf" | grep -q '%PDF-'; then echo "ok    $f.pdf is a PDF"; else echo "FAIL  $f.pdf missing or not a PDF"; fail=1; fi
done
# 2 files: the shipped routine takes about 5 s a file when Chrome is warm and
# lingers; a hang is the failure this guards, so the bound is loose but finite.
[ "$took" -le 60 ] && echo "ok    both files in ${took}s" || { echo "FAIL  took ${took}s"; fail=1; }
pgrep -f "print-to-pdf=$T" >/dev/null && { echo "FAIL  a Chrome print process was left running"; fail=1; } || echo "ok    no Chrome left running"
python3 "$ROOT/bin/chewbacca-pdf" "$T/nope.md" >/dev/null 2>&1 && { echo "FAIL  a missing file exited 0"; fail=1; } || echo "ok    a missing file exits 1"
python3 - "$ROOT" <<'PY' && echo "ok    inline code and bold render as tags, not raw marks" || { echo "FAIL  inline markdown printed raw"; fail=1; }
import sys; sys.path.insert(0, sys.argv[1] + "/tools")
import gtme_operator as op
h = op.md_to_html("# T\n\n- run `recur` **now** <x>\n\nSee `scars` here", "T")
assert "<code>recur</code>" in h and "<b>now</b>" in h and "<code>scars</code>" in h, h
assert "`" not in h and "**" not in h and "&lt;x&gt;" in h, h
PY
python3 - "$ROOT" <<'PY2' && echo "ok    numbered steps render as an ordered list" || { echo "FAIL  numbered steps lost their numbers"; fail=1; }
import sys; sys.path.insert(0, sys.argv[1] + "/tools")
import gtme_operator as op
h = op.md_to_html("1. grab\n2. build\n\n- a\n- b\n3. after", "T")
assert "<ol><li>grab</li><li>build</li></ol>" in h, h
assert "<ul><li>a</li><li>b</li></ul><ol><li>after</li></ol>" in h, h
PY2
printf 'Grab what u need w ur partner.\n' > "$T/slang.md"
printf 'Grab what you need with your partner. Use it.\n' > "$T/clean.md"
python3 "$ROOT/bin/chewbacca-pdf" "$T/slang.md" --out "$T/out" | grep -q "chat shorthand (u, ur, w)" && echo "ok    chat shorthand in a PDF source is named" || { echo "FAIL  chat shorthand not flagged"; fail=1; }
python3 "$ROOT/bin/chewbacca-pdf" "$T/clean.md" --out "$T/out" | grep -q "chat shorthand" && { echo "FAIL  full English flagged"; fail=1; } || echo "ok    full English is not flagged"
G="$ROOT/.claude/hooks/use-the-kit-guard.sh"
g() { jq -n --arg c "$1" '{tool_input:{command:$c}}' | bash "$G" >/dev/null 2>&1; echo $?; }
[ "$(g 'chrome --headless=new --print-to-pdf=out.pdf file.html')" = 2 ] && echo "ok    a hand-rolled Chrome print is pointed at chewbacca pdf" || { echo "FAIL  hand-rolled print not refused"; fail=1; }
[ "$(g 'chewbacca pdf brief.md --out x')" = 0 ] && echo "ok    chewbacca pdf itself passes" || { echo "FAIL  chewbacca pdf refused"; fail=1; }
exit $fail
