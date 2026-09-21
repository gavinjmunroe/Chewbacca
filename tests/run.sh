#!/bin/bash
# The detector has to fire on the generated look and stay quiet on a real one.
# A linter that flags everything gets turned off in a week, which is the same
# failure as not having one.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0; FAIL=0
check() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then printf '  ok    %s\n' "$name"; PASS=$((PASS+1))
  else printf '  FAIL  %s\n' "$name"; FAIL=$((FAIL+1)); fi
}

echo "ux-engine tests"

# The index must regenerate deterministically from the vendored corpus.
check "extractor runs"            python3 "$ROOT/tools/extract.py"
check "index renders"             python3 "$ROOT/tools/index_md.py"
check "systems.json is valid"     python3 -c "import json;json.load(open('$ROOT/data/systems.json'))"
check "constants.json is valid"   python3 -c "import json;json.load(open('$ROOT/data/constants.json'))"

# Never report a constraint for a system whose tokens did not parse. Ten
# systems ship prose only, and calling them monochrome would teach the
# generator that Spotify has no green.
check "no constraint claimed without data" python3 -c "
import json,sys
rows=json.load(open('$ROOT/data/systems.json'))
bad=[r['name'] for r in rows if not r['has_frontmatter'] and r['forbids']]
sys.exit(1 if bad else 0)"

# Bugatti is the reference case, and the reason the corpus is here at all.
check "bugatti reads as monochrome" python3 -c "
import json,sys
r={x['name']:x for x in json.load(open('$ROOT/data/systems.json'))}['bugatti']
sys.exit(0 if r['accent'] is None and r['radius_profile']=='sharp' else 1)"

# Semantic tokens are not brand accents. Getting this wrong reported Bugatti
# as gold and Stripe as its drop-shadow blue.
check "stripe accent is its blurple" python3 -c "
import json,sys
r={x['name']:x for x in json.load(open('$ROOT/data/systems.json'))}['stripe']
sys.exit(0 if r['accent'] and r['accent']['hex'].lower()=='#533afd' else 1)"

check "selector finds bugatti from a brief" bash -c \
  "'$ROOT/bin/ux-pick' 'austere luxury dark' -n 1 | grep -q bugatti"

# The detector, both directions.
check "detector fires on the slop fixture" bash -c \
  "'$ROOT/bin/ux-lint' '$ROOT/tests/fixtures/slop.tsx' --max 5; [ \$? -eq 1 ]"
check "detector is quiet on the clean fixture" bash -c \
  "'$ROOT/bin/ux-lint' '$ROOT/tests/fixtures/clean.tsx' --max 0"
check "detector catches indigo specifically" bash -c \
  "'$ROOT/bin/ux-lint' '$ROOT/tests/fixtures/slop.tsx' | grep -q indigo"
check "detector never scans the vendored corpus" bash -c \
  "! '$ROOT/bin/ux-lint' '$ROOT' 2>/dev/null | grep -q 'systems/'"

# Bourdieu's test, made executable. See tools/check_rules.py.
check "every rule names a user cost and cites a source" python3 "$ROOT/tools/check_rules.py"

check "ux-lint prints the user cost, not just the rule" bash -c \
  "'$ROOT/bin/ux-lint' '$ROOT/tests/fixtures/slop.tsx' | grep -q 'COSTS:'"

check "ux-guard blocks a slop file" "$ROOT/tests/guard_blocks.sh" "$ROOT"
check "ux-guard passes a clean file" "$ROOT/tests/guard_passes.sh" "$ROOT"

check "ux-pick branches instrumental vs expressive" bash -c \
  "'$ROOT/bin/ux-pick' 'fashion brand landing page' -n 1 | grep -q 'restraint is not being rewarded'"

check "every preset cites its research" bash -c '
  for f in "'$ROOT'"/presets/*.md; do
    case "$f" in */README.md) continue ;; esac
    grep -q "^Compiled from" "$f" || exit 1
  done'

check "every preset covers states" bash -c '
  for f in "'$ROOT'"/presets/*.md; do
    case "$f" in */README.md) continue ;; esac
    grep -qiE "loading|empty|error" "$f" || exit 1
  done'

check "every preset names its failure mode" bash -c '
  for f in "'$ROOT'"/presets/*.md; do
    case "$f" in */README.md) continue ;; esac
    grep -qi "failure mode" "$f" || exit 1
  done'

check "ux-preset resolves an alias" bash -c \
  "'$ROOT/bin/ux-preset' modal | head -1 | grep -q Dialog"

check "ux-preset refuses to invent one" bash -c \
  "! '$ROOT/bin/ux-preset' wizard 2>/dev/null"

check "the guard routes a form to its preset" "$ROOT/tests/guard_routes.sh" "$ROOT"
echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
