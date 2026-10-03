#!/usr/bin/env bash
# Every refusing hook needs BOTH cases tested: one that it refuses, and one
# that it must let through.
#
# 2026-09-26. design-gate in ux-engine refused a correct page three different
# ways: a fixed header counted as colliding with everything scrolling under
# it, nav links inside that header counted the same way because overlay-ness
# is inherited and the check did not walk ancestors, and ordinary body copy
# scored as unreadable because the legibility metric assumed one luminance
# mode when clean type on a flat ground has two.
#
# Four manual runs missed the third. Two inline fixtures found it in seconds.
#
# The kit already enforced the other direction. feedback_a_silent_guard_proves
# _nothing says a guard that has never fired proves nothing, so make it refuse
# something on purpose. That rule alone pushes every guard toward firing more,
# and a guard that fires on correct input is equally broken and worse in one
# way: it is loud. A false finding printed beside a real one teaches whoever
# reads it to skim past both, which is how an enforcing hook decays into an
# advisory one without anybody changing a line.
#
# So: a hook that can refuse must have a test naming a case it refuses AND a
# test naming a case it permits. This checks that both exist.

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fails=0
checked=0

note() { printf '  %s\n' "$*"; }

# A hook "refuses" if it can exit 2 or emit a deny decision.
for hook in "$ROOT"/.claude/hooks/*.sh; do
  [ -f "$hook" ] || continue
  name="$(basename "$hook" .sh)"

  grep -qE 'exit 2|permissionDecision.*deny|"deny"' "$hook" || continue
  checked=$((checked + 1))

  tests="$(grep -rl -- "$name" "$ROOT"/tests/ 2>/dev/null || true)"
  if [ -z "$tests" ]; then
    note "FAIL $name can refuse and has NO test at all"
    fails=$((fails + 1))
    continue
  fi

  # Both directions must appear somewhere in that hook's tests. The words are
  # deliberately broad: this checks that somebody thought about the permit
  # case, not that they used a particular helper.
  refuses=0; permits=0
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    grep -qiE 'refus|block|deny|exit 2|expect.*2|should fail' "$t" && refuses=1
    grep -qiE 'pass(es)?|permit|allow|exit 0|expect.*0|should not|clean' "$t" && permits=1
  done <<EOF
$tests
EOF

  if [ "$refuses" -eq 0 ]; then
    note "FAIL $name has tests but none asserts it REFUSES anything"
    fails=$((fails + 1))
  elif [ "$permits" -eq 0 ]; then
    note "FAIL $name is only tested for refusing. Add a case it must PERMIT,"
    note "     or it will grow false positives nobody notices until it is"
    note "     loud enough to be ignored entirely."
    fails=$((fails + 1))
  fi
done

if [ "$checked" -eq 0 ]; then
  note "FAIL found no refusing hooks to check, which means this test is"
  note "     looking in the wrong place and is silently passing."
  exit 1
fi

note "checked $checked refusing hook(s), $fails failure(s)"
[ "$fails" -eq 0 ]
