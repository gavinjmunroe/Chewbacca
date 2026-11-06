#!/bin/bash
# plan-check passes a complete plan, names each missing part, and refuses COMMITTED
# without a person, an independent review and a tested or scheduled top assumption.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0; ok() { printf '  ok   %s\n' "$1"; }; no() { printf '  FAIL %s\n' "$1"; fail=1; }
has() { grep -qF -- "$1" <<<"$out"; }
check() { python3 "$ROOT/bin/plan-check" --structure-only "$@"; }

cat > "$T/good.md" <<'EOF'
# Thing: the plan

## Status

DRAFT

## Outcome

Ten people use it weekly.

## Capacity

Hours per week: 10
Deadline: none

## Not doing

- A mobile app, too early

## Evidence

- It runs on stock python. Source: `thing.py`
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
Owner: Caleb
Due: 2031-01-31
Tests: assumption 1
Exit: `thing run` prints a result on a real file
Stop if: 5 people shrug
Decides: whether phase 2 is the app or the service
Work hours: 8, from the reference class
Calendar wait: none
Confidence: low because nobody has used it

### Phase 2: harden

Goal: survive real data
Owner: Caleb
Due: 2031-03-31
Exit: 20 real files read with no crash
Stop if: under 15 read
Decides: when to go public
Work hours: 20, guessed
Calendar wait: 5 days waiting on a reader
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

out="$(check "$T/good.md")"; [ $? = 0 ] && has "structure complete, status DRAFT" && has "That isn't right" && ok "a complete draft passes and says that isn't right" || no "good: $out"
python3 "$ROOT/bin/plan-check" --structure-only "$T/good.md" --json | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d["problems"]==[] and d["counts"]["shapes"]==3 and d["counts"]["premortem"]==5 else 1)' && ok "--json carries the same answer" || no "json"
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
without "evidence with no source fails" 't.replace(" Source: `thing.py`","")' "Evidence with no source"
without "a comparable with no number fails" 't.replace("took 1 day, 3 commits","was fine").replace("Hall piece 4","Hall piece")' "Reference class with no number"
without "an assumption with no test fails" 't.replace("  - Test: show 5 people\n","")' "missing Test"
without "a phase with no Stop if fails" 't.replace("Stop if: 5 people shrug\n","")' "missing Stop if"
without "a vague exit fails" 't.replace("Exit: `thing run` prints a result on a real file","Exit: works")' "Exit nobody can fail"
without "hours with no source fails" 't.replace("Work hours: 8, from the reference class","Work hours: 8")' "Work hours has to say"
without "a phase with no owner fails" 't.replace("Owner: Caleb\nDue: 2031-01-31\n","Due: 2031-01-31\n")' "missing Owner"
without "a phase with no calendar wait fails" 't.replace("Calendar wait: none\n","")' "missing Calendar wait"
without "no capacity fails" 't.replace("Hours per week: 10\n","Later: maybe\n")' "Capacity has to say"
without "hours that don't fit the calendar fail" 't.replace("Due: 2031-01-31","Due: 2020-01-31")' "doesn't fit"
without "a deadline needs a cut order" 't.replace("Deadline: none","Deadline: 2031-01-31")' "Cut first"
without "not tested isn't tested" 't.replace("Status: untested","Status: not tested")' "Assumption Status has to be"
without "evidence that's mostly unverified fails" 't.replace("Source: `thing.py`","Source: from memory, unverified").replace("https://example.test/a","Source: from memory, unverified")' "evidence bullets are unverified"
without "confidence with no reason fails" 't.replace("Confidence: low because nobody has used it","Confidence: high")' "Confidence has to read"
without "phase 1 has to test something" 't.replace("Tests: assumption 1\n","")' "has to say what it Tests"
without "adapting has to say what forces a replan" 't.replace("Replan when: a Stop if fires\n","")' "Adapting missing Replan when"
python3 -c 'import sys; t=open(sys.argv[1]).read(); open(sys.argv[2],"w").write(t.replace("DRAFT","DRAFT, made on 2026-11-05 and not committed"))' "$T/good.md" "$T/bad.md"
out="$(check "$T/bad.md")"; [ $? = 0 ] && has "status DRAFT" && ok "a status can carry a note after it" || no "status note: $out"
without "a bad status fails" 't.replace("DRAFT","MAYBE")' "Status has to start"
without "killed has to say why" 't.replace("DRAFT","KILLED")' "has to say why"
python3 -c 'import sys; t=open(sys.argv[1]).read(); open(sys.argv[2],"w").write(t.replace("DRAFT","KILLED because nobody wanted it"))' "$T/good.md" "$T/bad.md"
out="$(check "$T/bad.md")"; [ $? = 0 ] && ok "a plan can be marked dead with a reason" || no "killed: $out"
mkdir -p "$T/repo/real"; touch "$T/repo/real/file.txt"; sed 's#Source: `thing.py`#Source: `real/file.txt`#' "$T/good.md" > "$T/repo/p.md"
out="$(check "$T/repo/p.md")"; [ $? = 0 ] && ok "a cited path that exists passes" || no "real path: $out"
sed 's#Source: `thing.py`#Source: `does/not/exist.md`#' "$T/good.md" > "$T/repo/p.md"
out="$(check "$T/repo/p.md")"; has "isn't there: does/not/exist.md" && ok "a cited path that doesn't exist fails" || no "fake path: $out"
sed 's#Source: `thing.py`#Source: `git log`#' "$T/good.md" > "$T/repo/g.md"
out="$(check "$T/repo/g.md")"; [ $? = 0 ] && ok "a command in backticks isn't read as a path" || no "git log: $out"

# Later phases stay rough on purpose.
out="$(check "$T/good.md")"; has "Phase 3" && no "phase 3 was held to full detail: $out" || ok "a later phase can stay rough"

commit='t.replace("DRAFT","COMMITTED\n\ncommitted by Caleb, 2026-11-05\nActive phase: 1")'
# Writes the receipt the guard would, for whatever bad.md says now.
receipt() { python3 -c 'import json,sys; sys.path.insert(0,sys.argv[1]+"/bin/lib"); import plan_core as p; t=open(sys.argv[2]).read(); json.dump({"core":p.core_hash(t),"signers":[{"who":"Caleb"}]},open(p.receipt_path(sys.argv[2]),"w")); json.dump({"reviews":[{"findings":"x"}]},open(p.review_path(sys.argv[2]),"w"))' "$ROOT" "$T/bad.md"; }
without_receipt() { python3 -c 'import re,sys; t=open(sys.argv[1]).read(); open(sys.argv[2],"w").write(eval(sys.argv[3]))' "$T/good.md" "$T/bad.md" "$1"; receipt; }
committed() {  # label, expression, phrase: the receipt is fresh, so only the plan's own problem can fail it
  without_receipt "$2"; out="$(check "$T/bad.md")"; rc=$?
  if [ "$rc" = 1 ] && has "$3"; then ok "$1"; else no "$1: rc=$rc $out"; fi
}
without_ok() { python3 -c 'import re,sys; t=open(sys.argv[1]).read(); open(sys.argv[2],"w").write(eval(sys.argv[3]))' "$T/good.md" "$T/bad.md" "$1"; }
without_receipt "$commit"; out="$(check "$T/bad.md")"; [ $? = 0 ] && ok "a person, a review and a scheduled test can commit" || no "commit: $out"
committed "the agent can't commit it alone" 't.replace("DRAFT","COMMITTED\nActive phase: 1")' "committed by"
committed "no independent review, no commit" "$commit"'.replace("independent reviewer","my second read")' "needs an independent review"
committed "an open NEED blocks commit" "$commit"'.replace("Ten people","[NEED: a number] people")' "NEED"
committed "an untested top assumption phase 1 skips blocks commit" "$commit"'.replace("Tests: assumption 1","Tests: assumption 3")' "phase 1 doesn"
committed "committed needs an active phase" "$commit"'.replace("Active phase: 1","")' "Active phase"
without_receipt "$commit"'.replace("Status: untested","Status: tested: 4 of 5 wanted it").replace("Tests: assumption 1","Tests: assumption 3")'; out="$(check "$T/bad.md")"; [ $? = 0 ] && ok "a tested top assumption lets phase 1 test something else" || no "tested: $out"

# The receipt covers what they agreed to.
without_receipt "$commit"; sed -i '' 's/Ten people use it weekly./Sell one church t-shirts./' "$T/bad.md"; out="$(check "$T/bad.md")"; [ $? = 1 ] && has "needs a new one" && ok "changing the outcome after a commit needs a new commit" || no "outcome drift: $out"
without_receipt "$commit"; sed -i '' 's/Exit: 20 real files read with no crash/Exit: anything/' "$T/bad.md"; out="$(check "$T/bad.md")"; has "needs a new one" && ok "so does changing an exit" || no "exit drift: $out"
without_receipt "$commit"; sed -i '' 's/- It runs on stock python/- It really runs on stock python/' "$T/bad.md"; out="$(check "$T/bad.md")"; [ $? = 0 ] && ok "updating evidence doesn't" || no "evidence edit: $out"
mkdir -p "$T/moved"; without_receipt "$commit"; cp "$T/bad.md" "$T/bad.commit.json" "$T/bad.review.json" "$T/moved/"; out="$(check "$T/moved/bad.md")"; [ $? = 0 ] && ok "a committed plan moved with its receipt still passes" || no "moved: $out"

# A review has to have really come back.
without_receipt "$commit"; rm "$T/bad.review.json"; out="$(check "$T/bad.md")"; [ $? = 1 ] && has "no review receipt" && ok "a review log line with no real review can't commit" || no "no review: $out"

# A shared plan needs everyone it names.
need="$commit"'.replace("Active phase: 1","Active phase: 1\nCommits needed: Caleb, Gavin")'
without_receipt "$need"; out="$(check "$T/bad.md")"; [ $? = 1 ] && has "Still needs a commit from: Gavin" && ok "a shared plan waits for the other person" || no "shared: $out"
python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["signers"].append({"who":"gavin"}); json.dump(d,open(p,"w"))' "$T/bad.commit.json"; out="$(check "$T/bad.md")"; [ $? = 0 ] && ok "and passes once they've both committed" || no "both: $out"

# One phone screen, and a stalled plan says so.
without_receipt "$commit"; out="$(python3 "$ROOT/bin/plan-check" "$T/bad.md" --now)"; has "Phase 1: skeleton" && has "Owner: Caleb" && has "Stop if: 5 people shrug" && ! has "harden" && ok "--now shows only the active phase" || no "now: $out"
out="$(python3 "$ROOT/bin/plan-check" "$T/good.md" --due)"; [ $? = 0 ] && has "nothing to chase" && ok "--due leaves a draft alone" || no "due draft: $out"
without_receipt "$commit"'.replace("2026-11-05, independent","2020-01-01, independent").replace("Due: 2031-01-31","Due: 2020-02-02")'; out="$(python3 "$ROOT/bin/plan-check" "$T/bad.md" --due)"; [ $? = 1 ] && has "was due 2020-02-02" && has "nothing in the review log" && ok "--due calls out a stalled plan" || no "stalled: $out"

rm -f "$T/bad.commit.json"
without "typing COMMITTED with no receipt fails" "$commit" "has no receipt"

# The read: filler fails, real text passes, and a read that can't run is no pass.
python3 "$ROOT/tests/test_plan_check.py" > "$T/py" 2>&1 && ok "the Jev read fails filler and never calls a failed read a pass" || no "read: $(tail -5 "$T/py")"

# The skill has to name its tool and its template has to exist.
grep -q 'plan-check PLAN.md' "$ROOT/skills/big-plan/SKILL.md" && [ -f "$ROOT/skills/big-plan/TEMPLATE.md" ] && ok "the skill points at its tool and template" || no "skill wiring"
exit "$fail"
