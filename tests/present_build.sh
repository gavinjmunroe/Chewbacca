#!/bin/bash
# `chewbacca present` turns one script file into a presenter app.
#
# 2026-11-06: the BISC presenter window was hand-built overnight and still
# being changed at 10:13 while he sat in the room waiting to present at 10:00,
# because nothing in the kit made one. These cases pin the parts that decide
# whether the generated window is usable at all.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
B="$ROOT/tools/present_build.py"
CLI="$ROOT/bin/chewbacca-present"
[ -f "$B" ] || { echo "SKIP present_build: no builder"; exit 0; }

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
pass=0; fail=0
ok()  { echo "  ok   $1"; pass=$((pass + 1)); }
no()  { echo "  FAIL $1"; fail=$((fail + 1)); }
has() { grep -qF "$2" "$1" && ok "$3" || no "$3"; }

cat > "$tmp/talk.md" <<'MD'
# A talk | Caleb Newton

## intro: The opening

### the first beat
A sentence with **bold** in it.
> what the room sees right now
- a spare fact
- another spare fact

### the second beat
Another sentence.
> something else on screen

## Q&A

### Why this and not that?
Because the long answer runs well past a hundred and ten characters, which is more than fits in a glance while somebody is waiting for him to speak.
MD

python3 -I "$B" "$tmp/talk.md" "$tmp/out" >"$tmp/log" 2>&1 \
  && ok "builds from a script" || no "builds from a script"

beats="$tmp/out/lib/beats.ts"; drill="$tmp/out/lib/drill.ts"
has "$beats" 'export const TITLE = "A talk"'        "reads the title"
has "$beats" 'export const PRESENTER = "Caleb Newton"' "reads his name"
has "$beats" '"intro"'                               "scene key from the heading"
has "$beats" 'intro: "The opening"'                  "scene label from the heading"
has "$beats" 'cue: "the first beat"'                 "the cue the room sees"
has "$beats" '<b>bold</b>'                           "markdown bold becomes html"

# The presenter window renders `say` with dangerouslySetInnerHTML, so the only
# tags in it must be the ones the builder generated. Flagged by review
# 2026-11-06: md_inline rewrote the stars and never escaped anything.
cat > "$tmp/xss.md" <<'MD'
# T | C

## a: A

### beat
A <script>alert(1)</script> and **bold**.
> seen
MD
python3 -I "$B" "$tmp/xss.md" "$tmp/xss-out" >/dev/null 2>&1
if grep -q '&lt;script&gt;' "$tmp/xss-out/lib/beats.ts" && ! grep -q '<script>' "$tmp/xss-out/lib/beats.ts"; then
  ok "html in the script is escaped before it reaches the window"
else
  no "html in the script is escaped before it reaches the window"
fi
has "$beats" 'see: "what the room sees right now"'   "the on-screen line"
has "$beats" '"a spare fact"'                        "bullets become spare material"
has "$drill" 'Why this and not that?'                "Q&A becomes questions"

# The scene block is read aloud, so it carries neither html nor markdown stars.
if grep -A 3 "export const SCRIPT" "$beats" | grep -q '\*\*\|<b>'; then
  no "the spoken block is plain text"
else
  ok "the spoken block is plain text"
fi

# A prompt that stops mid-word is worse than no prompt when he reads it
# mid-answer. The first version ended one on "breakin". The check is whether
# the clipped text is a whole-word prefix of the full answer, not whether it
# ends in a letter: "...where..." is a correct clip and a letter precedes it.
python3 -I - "$drill" <<'PYCHK'
import re, sys
src = open(sys.argv[1]).read()
full = dict(re.findall(r'^  \[("(?:[^"\\]|\\.)*"), ("(?:[^"\\]|\\.)*")\],$',
                       src.split("export const QA")[1].split("];")[0], re.M))
prep = dict(re.findall(r'^  \[("(?:[^"\\]|\\.)*"), ("(?:[^"\\]|\\.)*")\],$',
                       src.split("export const QPREP")[1].split("];")[0], re.M))
import json
bad = []
for q, p in prep.items():
    a, b = json.loads(full[q]), json.loads(p)
    if not b.endswith("..."):
        continue
    stem = b[:-3]
    if not (a.startswith(stem) and a[len(stem):len(stem) + 1] in (" ", "")):
        bad.append(json.loads(q))
raise SystemExit(1 if bad else 0)
PYCHK
[ $? = 0 ] && ok "question prompts clip at a word boundary" \
           || no "question prompts clip at a word boundary"

# It has to say when the talk is too short for the window, because 614 words
# of prompts read as 4.4 minutes against an 8-to-10 requirement once already.
grep -q "under a typical 8-to-10 minute window" "$tmp/log" \
  && ok "warns when the script is short for the window" \
  || no "warns when the script is short for the window"

# A beat with no on-screen line leaves him guessing at the drawing behind him.
cat > "$tmp/thin.md" <<'MD'
# T | C

## a: A

### beat with no see line
Just a sentence.
MD
python3 -I "$B" "$tmp/thin.md" "$tmp/thin-out" 2>&1 | grep -q "no 'on screen' line" \
  && ok "names the beats with no on-screen line" \
  || no "names the beats with no on-screen line"

# The level is chosen from rehearsal, so a bad value is refused rather than
# silently falling back to something that does not match it.
python3 -I "$B" "$tmp/talk.md" "$tmp/bad" --level yolo >/dev/null 2>&1 \
  && no "refuses an unknown aid level" || ok "refuses an unknown aid level"
grep -q 'LEVEL = "script"' "$tmp/out/lib/level.ts" \
  && ok "defaults to the script level" || no "defaults to the script level"

if [ -x "$CLI" ]; then
  "$CLI" new "$tmp/app" --script "$tmp/talk.md" >/dev/null 2>&1
  [ -f "$tmp/app/app/notes/page.tsx" ] && ok "scaffolds the presenter window" || no "scaffolds the presenter window"
  [ -f "$tmp/app/app/train/page.tsx" ] && ok "scaffolds the trainer" || no "scaffolds the trainer"
  [ -f "$tmp/app/lib/scenes.tsx" ] && ok "leaves a scenes stub to draw into" || no "leaves a scenes stub to draw into"
  "$CLI" new "$tmp/app" --script "$tmp/talk.md" >/dev/null 2>&1 \
    && no "refuses to overwrite an existing app" || ok "refuses to overwrite an existing app"
else
  echo "  skip CLI cases (no $CLI)"
fi

echo "present_build: $pass passed, $fail failed"
[ "$fail" = 0 ]
