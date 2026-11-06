#!/bin/bash
# plan-check passes a complete plan, names each missing part, and refuses COMMITTED
# without a person, an independent review and a tested or scheduled top assumption.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0; ok() { printf '  ok   %s\n' "$1"; }; no() { printf '  FAIL %s\n' "$1"; fail=1; }
has() { grep -qF -- "$1" <<<"$out"; }
check() { python3 "$ROOT/bin/plan-check" "$@"; }

cat > "$T/good.md" <<'EOF'
# Thing: the plan

## Status

DRAFT

## Outcome

Ten people use it weekly.

## Not doing

- A mobile app, too early

## Evidence

- It runs on stock python. Source: `bin/thing`
- Competitor is free. https://example.test/a
- Nobody has used it. Source: from memory, unverified

## Reference class

- Hall piece 4 took 1 day, 3 commits. Source: `git log`

## Riskiest assumptions

- Anyone wants it
  - If false: nothing else matters
  - Test: show 5 people
  - Status: untested

## Shapes

### Shape 1, chosen: small tool

Bets on: people want the tool

### Shape 2: a service

Bets on: people pay for done work
Rejected because: no time

### Shape 3: nothing

Bets on: the labs ship it
Rejected because: they have not

## Pre-mortem

- Nobody came back
  - Catch: week 4 count
- It broke on real data
  - Catch: first real run
- Rules blocked it
  - Catch: policy read
- Too hard to install
  - Catch: time to first result
- Founder ran out of time
  - Catch: weekly hours

## One-way doors

- Going public, Caleb decides, as late as possible

## Phases

### Phase 1: skeleton

Goal: prove it runs end to end
Tests: assumption 1
Exit: `thing run` prints a result on a real file
Stop if: 5 people shrug
Decides: whether phase 2 is the app or the service
Effort: 2 days, from the reference class
Confidence: low because nobody has used it

### Phase 2: harden

Goal: survive real data
Exit: 20 real files read with no crash
Stop if: under 15 read
Decides: when to go public
Effort: guessed, 1 week
Confidence: medium because the parser exists

### Phase 3: public

Goal: real users
Exit: 10 weekly users

## Adapting

Change without asking: reorders inside a phase
Ask first: anything public
Replan when: a Stop if fires

## Review log

- 2026-11-05, independent reviewer: found the install gap, added phase 2 check
EOF

out="$(check "$T/good.md")"; [ $? = 0 ] && has "complete, status DRAFT" && has "Complete isn't good" && ok "a complete draft passes and says complete isn't good" || no "good: $out"
python3 "$ROOT/bin/plan-check" "$T/good.md" --json | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d["problems"]==[] and d["counts"]["shapes"]==3 and d["counts"]["premortem"]==5 else 1)' && ok "--json carries the same answer" || no "json"
check "$T/nope.md" > /dev/null 2>&1; [ $? = 2 ] && ok "a missing file is exit 2, never a pass" || no "missing file"

# Each removal has to name what's gone. eval here only runs the literal edits in
# this file, on a fixture in a temp folder.
without() {  # label, python expression on text, expected phrase
  python3 -c 'import re,sys; t=open(sys.argv[1]).read(); open(sys.argv[2],"w").write(eval(sys.argv[3]))' "$T/good.md" "$T/bad.md" "$2"
  out="$(check "$T/bad.md")"; rc=$?
  if [ "$rc" = 1 ] && has "$3"; then ok "$1"; else no "$1: rc=$rc $out"; fi
}
without "a missing section is named" 't.replace("## Pre-mortem","## Risks")' "missing section: ## Pre-Mortem"
without "too few rival plans fails" 're.sub(r"### Shape 3.*?(?=## Pre-mortem)","",t,flags=re.S)' "Shapes has 2"
without "two chosen shapes fails" 't.replace("### Shape 2: a service","### Shape 2, chosen: a service")' "Exactly one shape"
without "a losing shape has to say why" 't.replace("Rejected because: no time\n","")' "missing Rejected because"
without "a short pre-mortem fails" 't.replace("- Founder ran out of time\n  - Catch: weekly hours\n","")' "Pre-mortem has 4"
without "a failure with no catch fails" 't.replace("  - Catch: week 4 count\n","")' "no Catch"
without "evidence with no source fails" 't.replace(" Source: `bin/thing`","")' "Evidence with no source"
without "a comparable with no number fails" 't.replace("took 1 day, 3 commits","was fine").replace("Hall piece 4","Hall piece")' "Reference class with no number"
without "an assumption with no test fails" 't.replace("  - Test: show 5 people\n","")' "missing Test"
without "a phase with no Stop if fails" 't.replace("Stop if: 5 people shrug\n","")' "missing Stop if"
without "a vague exit fails" 't.replace("Exit: `thing run` prints a result on a real file","Exit: works")' "Exit nobody can fail"
without "effort with no source fails" 't.replace("Effort: 2 days, from the reference class","Effort: 2 days")' "Effort has to say"
without "confidence with no reason fails" 't.replace("Confidence: low because nobody has used it","Confidence: high")' "Confidence has to read"
without "phase 1 has to test something" 't.replace("Tests: assumption 1\n","")' "has to say what it Tests"
without "adapting has to say what forces a replan" 't.replace("Replan when: a Stop if fires\n","")' "Adapting missing Replan when"
without "a bad status fails" 't.replace("DRAFT","MAYBE")' "Status has to start"

# Later phases stay rough on purpose.
out="$(check "$T/good.md")"; has "Phase 3" && no "phase 3 was held to full detail: $out" || ok "a later phase can stay rough"

commit='t.replace("DRAFT","COMMITTED\n\ncommitted by Caleb, 2026-11-05")'
without_ok() { python3 -c 'import re,sys; t=open(sys.argv[1]).read(); open(sys.argv[2],"w").write(eval(sys.argv[3]))' "$T/good.md" "$T/bad.md" "$1"; }
without_ok "$commit"; out="$(check "$T/bad.md")"; [ $? = 0 ] && ok "a person, a review and a scheduled test can commit" || no "commit: $out"
without "the agent can't commit it alone" 't.replace("DRAFT","COMMITTED")' "committed by"
without "no independent review, no commit" "$commit"'.replace("independent reviewer","my second read")' "needs an independent review"
without "an open NEED blocks commit" "$commit"'.replace("Ten people","[NEED: a number] people")' "NEED"
without "an untested top assumption phase 1 skips blocks commit" "$commit"'.replace("Tests: assumption 1","Tests: assumption 3")' "phase 1 doesn"
without_ok "$commit"'.replace("Status: untested","Status: tested 2026-11-05, 4 of 5 wanted it").replace("Tests: assumption 1","Tests: assumption 3")'; out="$(check "$T/bad.md")"; [ $? = 0 ] && ok "a tested top assumption lets phase 1 test something else" || no "tested: $out"

# The skill has to name its tool and its template has to exist.
grep -q 'plan-check PLAN.md' "$ROOT/skills/big-plan/SKILL.md" && [ -f "$ROOT/skills/big-plan/TEMPLATE.md" ] && ok "the skill points at its tool and template" || no "skill wiring"
exit "$fail"
