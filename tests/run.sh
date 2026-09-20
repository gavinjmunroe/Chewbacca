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

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
