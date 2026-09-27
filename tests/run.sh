#!/bin/bash
# The detector has to fire on the generated look and stay quiet on a real one.
# A linter that flags everything gets turned off in a week, which is the same
# failure as not having one.
set -uo pipefail
# export, not just assign. Without it every `bash -c '... "$ROOT" ...'` test
# ran with ROOT empty, so a whole class of them was passing vacuously.
export ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0; FAIL=0
check() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then printf '  ok    %s\n' "$name"; PASS=$((PASS+1))
  else printf '  FAIL  %s\n' "$name"; FAIL=$((FAIL+1)); fi
}

echo "ux-engine tests"
check "motion derivatives respect observed support" python3 "$ROOT/tests/test_modes.py"
check "design gate requires a fresh capture" python3 "$ROOT/tests/test_design_gate.py"
check "design gate requires a fresh capture" python3 "$ROOT/tests/test_gate_calibration.py"
check "comparison rejects unmatched captures" python3 "$ROOT/tests/test_compare.py"

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
# --max counts BLOCKING findings only, since research/16: a build-breaking
# gate made of house opinion runs ~3.4x over the threshold where tools get
# switched off. So the fixture must trip at least one EXTERNAL rule.
check "detector fires on the slop fixture" bash -c \
  "'$ROOT/bin/ux-lint' '$ROOT/tests/fixtures/slop.tsx' --max 0; [ \$? -eq 1 ]"

check "house opinion never blocks" bash -c \
  "'$ROOT/bin/ux-lint' '$ROOT/tests/fixtures/slop.tsx' | grep -q ADVISORY"

check "blocking findings cite an outside standard" bash -c \
  "! '$ROOT/bin/ux-lint' '$ROOT/tests/fixtures/slop.tsx' | grep '^HIGH \[EXTERNAL\]' -A2 | grep -q 'AUTHORITY: research/[0-9]*;\s*\$'"

check "ux-constrain --init then --check rejects the scaffold" bash -c '
  d=$(mktemp -d); cd "$d"
  "'$ROOT'/bin/ux-constrain" --init >/dev/null
  "'$ROOT'/bin/ux-constrain" --check DENY.md >/dev/null 2>&1
  rc=$?; cd /; rm -rf "$d"; [ $rc -eq 1 ]' 
check "detector is quiet on the clean fixture" bash -c \
  "'$ROOT/bin/ux-lint' '$ROOT/tests/fixtures/clean.tsx' --max 0"
check "detector catches indigo specifically" bash -c \
  "'$ROOT/bin/ux-lint' '$ROOT/tests/fixtures/slop.tsx' | grep -q indigo"
# Asserts on the FINDING PATH, not on any text containing "systems/".
# The old form matched SYSTEMS.md's own index table and was failing on its
# own generated output the moment ROOT started being exported.
check "detector never scans the vendored corpus" bash -c \
  "! '$ROOT/bin/ux-lint' '$ROOT' 2>/dev/null | grep -qE '\] +[^ ]*/(systems|corpus|runs)/'"

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
check "ux-trial refuses a single artifact" bash -c \
  "! '$ROOT/bin/ux-trial' run '$ROOT/tests/fixtures/clean.tsx' --brief x 2>/dev/null"

check "ux-trial requires a named feature" bash -c \
  "! '$ROOT/bin/ux-trial' judge deadbeef --worse A --feature '' 2>/dev/null"

check "headless render is available" bash -c \
  "[ -x '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' ] || command -v chromium"

check "the trial log survives and reports" bash -c \
  "'$ROOT/bin/ux-trial' log >/dev/null"

# ---- the generative half. Added 2026-09-20 -------------------------------
# Everything above tests refusal. These test proposing, looking and measuring,
# which is the half the repo was missing.

check "tokens: a tailwind class and a raw hex land on the same axis" python3 -c "
import sys; sys.path.insert(0,'$ROOT/tools')
import tokens
a = tokens.features('<div class=\'rounded-2xl\'>', 'html')
b = tokens.features('.x{border-radius:16px}', 'html')
assert 'radius:16' in a and 'radius:16' in b, (a, b)
"

check "tokens: radius comes from the rounded block, not every px value" python3 -c "
import sys; sys.path.insert(0,'$ROOT/tools')
import tokens
f = tokens.features(open('$ROOT/systems/airbnb/DESIGN.md').read(), 'design')
r = {x for x in f if x.startswith('radius:')}
assert r == {'radius:0','radius:4','radius:8','radius:14','radius:20','radius:32','radius:9999'}, r
"

check "tokens: neutrals do not register as a hue" python3 -c "
import sys; sys.path.insert(0,'$ROOT/tools')
import tokens
f = tokens.features('<a class=\'bg-zinc-800\'>', 'html')
assert 'neutral' in f and not any(x.startswith('hue:') for x in f), f
"

check "every stance carries hard refusals" python3 -c "
import sys; sys.path.insert(0,'$ROOT/tools')
import stances
assert len(stances.STANCES) >= 6
for k, v in stances.STANCES.items():
    assert v['refuse'], k          # a stance with no refusals is a mood board
    assert len(v['refuse']) >= 3, k
    assert v['principle'] and v['from'], k
"

check "a stance prompt states the refusals as hard failures" python3 -c "
import sys; sys.path.insert(0,'$ROOT/tools')
import stances
p = stances.prompt_for('one-voltage', 'a settings page')
assert 'MUST NOT' in p and 'hard failure' in p and 'settings page' in p
"

check "the viewer probe never sees the intent" bash -c \
  "! grep -nE 'PROBE.*intent|intent.*\\{PROBE' '$ROOT/bin/ux-viewer'"

check "the viewer stages a neutral filename" bash -c \
  "grep -q 'screenshot.png' '$ROOT/bin/ux-viewer'"

# The renderer used to screenshot the instant the page loaded, which captured
# uselemma.ai as a nearly blank page because all six of its plots animate in.
# Everything probed before that fix could have been an unfinished page.
check "the viewer waits for the page to settle before capturing" bash -c \
  "grep -q 'networkidle' '$ROOT/bin/ux-viewer' && \
   grep -q 'wait_for_timeout(settle)' '$ROOT/bin/ux-viewer'"

# Tried and rejected: it fast-forwards the clock and froze the same page
# mid-headline, which is worse than a blank capture because it looks deliberate.
# Matches the flag as it would actually be PASSED, quoted and dash-prefixed.
# Grepping for the bare phrase flagged the comment explaining why it is not
# used, which is a test failing on its own documentation.
check "the viewer never passes virtual-time-budget" bash -c \
  "! grep -qE '[\"'\''“]--virtual-time-budget' '$ROOT/bin/ux-viewer'"

# Intersection-triggered entrances never fire on a page that never scrolls.
check "the viewer nudges the scroll so entrance animations fire" bash -c \
  "grep -q 'mouse.wheel' '$ROOT/bin/ux-viewer'"

check "diversity of identical files is zero" python3 -c "
import sys, pathlib, tempfile; sys.path.insert(0,'$ROOT/tools')
import diversity
d = pathlib.Path(tempfile.mkdtemp())
for n in ('a-0.html','a-1.html'):
    (d/n).write_text('<html><div class=\'bg-indigo-600 rounded-2xl\'>hi</div></html>')
assert diversity.score_group(sorted(d.glob('*.html'))) == 0.0
"

check "diversity of disjoint files is one" python3 -c "
import sys, pathlib, tempfile; sys.path.insert(0,'$ROOT/tools')
import diversity
d = pathlib.Path(tempfile.mkdtemp())
(d/'a-0.html').write_text('<html><div class=\'bg-indigo-600\'>x</div></html>')
(d/'a-1.html').write_text('<html><p style=\'font-weight:300\'>x</p></html>')
s = diversity.score_group(sorted(d.glob('*.html')))
assert s == 1.0, s
"

check "ux-gen refuses an unknown stance" bash -c \
  "! '$ROOT/bin/ux-gen' 'x' --stances no-such-stance 2>/dev/null"

check "ux-slop says how to build the prior rather than crashing" bash -c \
  "'$ROOT/bin/ux-slop' '$ROOT/tests/fixtures/clean.tsx' 2>&1 | grep -q 'build_prior' || [ -f '$ROOT/data/prior.json' ]"

check "every motion primitive names what to refuse" bash -c '
  for f in "$ROOT"/motion/*.md; do
    case "$f" in */README.md) continue;; esac
    grep -qi "## Refuse" "$f" || exit 1
  done'

check "every motion primitive handles prefers-reduced-motion" bash -c '
  for f in "$ROOT"/motion/*.md; do
    case "$f" in */README.md) continue;; esac
    grep -q "prefers-reduced-motion" "$f" || exit 1
  done'

check "motion/ reduces rather than deleting" bash -c \
  "grep -qi 'Reduce, do not delete' '$ROOT/motion/README.md'"

check "ux-motion refuses to invent a primitive" bash -c \
  "! '$ROOT/bin/ux-motion' teleport 2>/dev/null"

# ux-crawl. The first version silently dropped EVERY focus state because
# ElementHandle.focus() takes no timeout kwarg, and the run still printed a
# clean summary. A capture tool that swallows errors reports success over
# missing data, which is worse than crashing.
check "ux-crawl never passes a timeout to ElementHandle.focus" bash -c \
  "! grep -qE '\.focus\(timeout' '$ROOT/bin/ux-crawl'"

check "ux-crawl reports skipped states instead of swallowing them" bash -c \
  "grep -q 'skipped.append' '$ROOT/bin/ux-crawl' && \
   grep -q 'printed rather than swallowed' '$ROOT/bin/ux-crawl'"

check "ux-crawl drives past the entrance" bash -c \
  "grep -q 'el.hover' '$ROOT/bin/ux-crawl' && \
   grep -q 'reduced_motion' '$ROOT/bin/ux-crawl' && \
   grep -q 'set_viewport_size' '$ROOT/bin/ux-crawl'"

check "ux-crawl reads computed styles, not the stylesheet" bash -c \
  "grep -q 'getComputedStyle' '$ROOT/bin/ux-crawl'"

# SCRAPE-PLAN.md: prose is the worst-measured format for procedural knowledge.
check "ux-crawl refuses to emit a style guide" bash -c \
  "grep -q 'No style guide was written' '$ROOT/bin/ux-crawl'"

# Schultz: dopamine neurons fire for UNPREDICTED reward, not reward. A system
# that never predicts has no error signal and therefore cannot learn from a
# probe. See research/18.
# Slice each function at the NEXT top-level def, not at a named one: probe
# sits before predict in the file, so slicing probe->diff swallowed predict
# and the test failed on its own arithmetic rather than on the code.
check "the predictor sees source and the probe does not" python3 -c "
import pathlib, re
s = pathlib.Path('$ROOT/bin/ux-viewer').read_text()
def body(name):
    i = s.index('def ' + name + '(')
    m = re.search(r'^def ', s[i+4:], re.M)
    return s[i:i+4+m.start()] if m else s[i:]
assert 'read_text' in body('predict'), 'predictor must read the source'
assert 'read_text' not in body('probe'), 'the probe must stay blind to the source'
"

check "no surprise is reported as a result, not as silence" bash -c \
  "grep -q 'NO SURPRISE' '$ROOT/bin/ux-viewer' && \
   grep -q 'taught nothing' '$ROOT/bin/ux-viewer'"

# Measured 2026-09-20: 83 of all blocking findings across the corpus were a
# single rule, emoji-as-icon, and stance guidance did not reduce findings at
# all because no refusal list mentioned emoji. Universal bans must reach every
# prompt or they reach none.
check "every stance prompt carries the universal bans" python3 -c "
import sys; sys.path.insert(0,'$ROOT/tools')
import stances
for k in stances.STANCES:
    p = stances.prompt_for(k, 'a page')
    for ban in ('emoji', 'em dashes', 'invented statistics'):
        assert ban in p, (k, ban)
"

check "derived variants carry the universal bans too" python3 -c "
import sys; sys.path.insert(0,'$ROOT/tools')
import tension
p = tension.prompt_for({'principle':'x','refuse':['a','b'],'resolves':'y'}, 'a page')
assert 'emoji' in p and 'em dashes' in p
"

check "emoji as an icon is a blocking finding" bash -c '
  d=$(mktemp -d); printf "<div><span>\xf0\x9f\x93\x85</span>Calendar</div>" > "$d/e.html"
  "$ROOT/bin/ux-lint" "$d/e.html" | grep -q "emoji-as-icon"; rc=$?; rm -rf "$d"; [ $rc -eq 0 ]'

check "invented social proof is a blocking finding" bash -c '
  d=$(mktemp -d); printf "<p>Trusted by 14,000+ marketers</p>" > "$d/p.html"
  "$ROOT/bin/ux-lint" "$d/p.html" | grep -q "invented-social-proof"; rc=$?; rm -rf "$d"; [ $rc -eq 0 ]'


echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
