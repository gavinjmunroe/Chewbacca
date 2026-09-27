#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init assumption-guard.sh 10
# PostToolUse: refuse generated visuals whose structure was invented rather
# than measured.
#
# Caleb, 2026-09-27, across three messages: "Don't assume anything to be
# linear." "Don't expect any placements to be uniform." "Don't assume
# patterns." Then: "Fix chewbacca so it never makes illogical assumptions."
#
# All three were about the same page, and all three were right. It shipped a
# trace wall of 42 identical 132x74 rectangles in a perfect 7x6 lattice, where
# every fourth brick failed because the code said `i % 4 === 1`. The reference
# it was copying has bricks of visibly different widths, rows that break in
# different places, and failures wherever they happen to fall.
#
# WHY THIS IS A GATE AND NOT ADVICE. Uniformity and a modulus are not stylistic
# slips, they are the signature of having stopped looking. They are also what
# an agent reaches for by default, because a constant width and `i % 4` are the
# shortest code that fills a space. `feedback_enforce_dont_document`: a mistake
# made repeatedly needs something that refuses it.
#
# WHAT IT CAN AND CANNOT SEE. "Linear where the measurement curved" is the
# third thing he named and it is not detectable from source: a linear map is
# only wrong relative to data the file does not contain. That one stays in the
# rules. These two are detectable because they are self-evidently invented:
#
#   i % N deciding a visual property   a real system does not fail on a cycle
#   i * step as an animation delay     an index stagger cannot express a chain,
#                                      because it never knows how long anything
#                                      takes. The reference's own load has
#                                      0.42 + 1.1 = 1.52, each stage beginning
#                                      as the previous ends.
#
# It fires only on files that draw, and only inside something that looks like
# a generated set, so ordinary arithmetic and real modulo work (wrapping an
# index, alternating table rows for legibility) pass untouched.
set -uo pipefail

INPUT=$(cat)
command -v jq >/dev/null 2>&1 || exit 0

FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')
[ -n "$FILE" ] && [ -f "$FILE" ] || exit 0
case "$FILE" in
  *.js|*.jsx|*.ts|*.tsx|*.svelte|*.vue) ;;
  *) exit 0 ;;
esac

# Only files that actually draw. A modulo in a scheduler is not this bug.
grep -qE 'createElement|innerHTML|<(svg|polyline|polygon|circle|rect|path)|style\.|setAttribute|\.css|classList' "$FILE" 2>/dev/null || exit 0

FOUND=""

# A visual property decided by a modulus of the loop index. The captured line
# has to both take a modulus AND mention something visual, so `i % len` used to
# wrap an array index does not trip it.
MOD=$(grep -nE '%\s*[0-9]+\s*(===?|!==?)' "$FILE" 2>/dev/null \
      | grep -iE 'fill|stroke|opacity|color|width|height|offset|delay|x:|y:|top|left|fail|active|highlight|variant|hidden|show' \
      | head -5)
[ -n "$MOD" ] && FOUND="$FOUND
A VISUAL PROPERTY DECIDED BY A MODULUS. Every Nth item is not a measurement,
it is a placeholder a viewer recognises without being able to name it. Draw it
against a probability from a seeded generator, or read the real distribution.
$MOD"

# index * constant as a delay. Chains, not staggers.
STAG=$(grep -nE '(animation-?[Dd]elay|transition-?[Dd]elay|delay)\s*[:=].*\b[a-z]\w*\s*\*\s*[0-9.]+' "$FILE" 2>/dev/null | head -5)
[ -n "$STAG" ] && FOUND="$FOUND
AN INDEX STAGGER AS A DELAY. index * step cannot express a chain, because it
never knows how long anything takes. Where stages must follow each other,
derive each delay from the sum of the durations before it. A stagger is only
right for siblings arriving together.
$STAG"

# Several identical hardcoded dimensions feeding one generated set.
DIMS=$(grep -oE '\b(w|h|width|height|CW|CH|SIZE)\s*[:=]\s*[0-9]{2,4}\b' "$FILE" 2>/dev/null \
       | grep -oE '[0-9]{2,4}$' | sort | uniq -c | sort -rn | awk '$1>=4{print $1" uses of "$2}' | head -3)
if [ -n "$DIMS" ] && grep -qE 'for\s*\(|\.map\(|while\s*\(' "$FILE" 2>/dev/null; then
  FOUND="$FOUND
ONE DIMENSION REUSED ACROSS A GENERATED SET. A wall of identical rectangles is
a table pretending to be a wall. If the source is uniform, measure and say so
in a comment; if it was never checked, vary it or go look.
$DIMS"
fi

[ -n "$FOUND" ] || exit 0

cat >&2 <<EOF
assumption-guard: $FILE invents structure it did not measure.
$FOUND

Each of these is legitimate when the SOURCE is actually like that. If you
measured it, say so in a comment on the line and this passes on the next
write, because a stated measurement is what separates a finding from a guess.
EOF
exit 2
