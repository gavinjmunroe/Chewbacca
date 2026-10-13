#!/usr/bin/env bash
# Chewbacca never reads, stores, quotes or gates on a course AI policy.
#
# Caleb, 2026-10-11, mid-cram for a guitar midterm: the kit answered "help me
# study" by running `coursework policy mpgu ai` and calling an unrecorded policy
# a ban. "It is the user's decision what the user does, not chewb's", and USC
# students "will feel turned away if it is invasive and reads ai policies,
# those are for humans to read, not ai". The gate had spread to 30 files:
# CLAUDE.md, an MCP tool, a SessionStart hook, five skills, the ledger template.
# This test fails the build if any of it comes back, in prose or in code.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT" || exit 2
fail=0

# 1. No instruction, tool or template tells an agent to check a course AI policy.
# docs/plans and team/memory are history; this file names the patterns, and
# so does tools/claude_md_scrub.py, which removes them from an old CLAUDE.md
# (it matched its own removal regex and kept this check red since 4afcaa75).
PATTERN='policy <course> ai|policy [A-Za-z0-9 ]+ ai[^a-z]|course_ai_policy|policies\.ai|unrecorded policy|check the (course )?ai policy|ai policy gate|respect (the )?course.?s ai policy|is treated as a ban|counts as banned'
hits="$(git grep -n -i -E "$PATTERN" -- . ':!docs/plans' ':!team/memory' ':!tests/no_ai_policy_gate.sh' ':!tools/claude_md_scrub.py' 2>/dev/null)"
if [ -n "$hits" ]; then
  echo "FAIL: AI policy gate is back:"; printf '%s\n' "$hits" | cut -c1-200; fail=1
fi

# 2. The CLI never shows an `ai` key from an old ledger and check never nags.
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/courses"
printf 'term: Test\nstart: 2026-08-24\nend: 2026-12-11\n' > "$T/semester.yml"
cat > "$T/courses/x-101.yml" <<'YML'
code: X 101
title: Test
policies:
  ai: "SENTINEL-AI-TEXT banned"
  late: "10% per day"
YML
out="$(COURSEWORK_DIR="$T" "$ROOT/bin/coursework" policy X 2>&1; COURSEWORK_DIR="$T" "$ROOT/bin/coursework" policy X --json 2>&1; COURSEWORK_DIR="$T" "$ROOT/bin/coursework" policy X ai 2>&1; COURSEWORK_DIR="$T" "$ROOT/bin/coursework" check 2>&1)"
if printf '%s' "$out" | grep -q 'SENTINEL-AI-TEXT'; then echo "FAIL: coursework printed a stored AI policy"; fail=1; fi
if printf '%s' "$out" | grep -qi 'ai policy'; then echo "FAIL: coursework mentioned an AI policy"; fail=1; fi
printf '%s' "$out" | grep -q '10% per day' || { echo "FAIL: other policies stopped working"; fail=1; }

# 3. An installed CLAUDE.md from before this change gets scrubbed by autopull.
cat > "$T/CLAUDE.md" <<'MD'
mine above
<!-- CHEWBACCA:BEGIN -->
| What is this class's AI policy? | `coursework policy <course> ai`  |

- **Check the AI policy before helping with anything graded.** One term can carry
  three different rules. An unrecorded policy is a ban.
- **Run the CLI instead of parsing the YAML.** It is deterministic.
<!-- CHEWBACCA:END -->
Check the AI policy before helping with anything graded, says the user.
MD
python3 -I "$ROOT/tools/claude_md_scrub.py" "$T/CLAUDE.md" >/dev/null
block="$(sed -n '/CHEWBACCA:BEGIN/,/CHEWBACCA:END/p' "$T/CLAUDE.md")"
if printf '%s' "$block" | grep -qi 'check the ai policy\|policy <course> ai'; then echo "FAIL: scrub left the gate in the managed block"; fail=1; fi
printf '%s' "$block" | grep -q 'Run the CLI instead' || { echo "FAIL: scrub ate a neighbouring rule"; fail=1; }
grep -q '^mine above' "$T/CLAUDE.md" && tail -1 "$T/CLAUDE.md" | grep -q 'says the user' || { echo "FAIL: scrub touched text outside the block"; fail=1; }
[ "$(python3 -I "$ROOT/tools/claude_md_scrub.py" "$T/CLAUDE.md")" = clean ] || { echo "FAIL: scrub is not idempotent"; fail=1; }
grep -q claude_md_scrub "$ROOT/.claude/hooks/kit-autopull.sh" || { echo "FAIL: autopull no longer runs the scrub"; fail=1; }

[ "$fail" = 0 ] && echo "ok: no AI policy gate anywhere"
exit "$fail"
