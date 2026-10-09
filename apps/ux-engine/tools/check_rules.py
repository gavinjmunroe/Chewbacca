#!/usr/bin/env python3
"""Fail the build if any ux-lint rule cannot say who it hurts, or where it came from.

Bourdieu's objection, from research/05-taste.md, made executable:

    "a rule whose only justification is how the artifact reflects on the
     evaluator is a class marker."

So every rule carries a `why` (a cost to the person using the thing) and a
`src` (a citation). A rule that cannot produce both is taste policing and it
does not ship. This is the check that stops this repo becoming the thing it
was built to criticise.

The second reason is competitive rather than ethical. research/11 found that
the nearest comparable linter's 152 rules carry no provenance field at all.
Provenance is the whole claim this project has left, so it is enforced here
rather than asserted in a README.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bin"))

# Import the rule table directly rather than parsing the file, so the check
# cannot drift from what the linter actually runs.
spec_src = (ROOT / "bin" / "ux-lint").read_text()
ns = {}
exec(compile(spec_src.split("EXT = {")[0], "ux-lint", "exec"), ns)
RULES = ns["RULES"]

CITES = re.compile(r"research/|WCAG|MDN|web\.dev|NN/g|WebAIM|Material|Caleb|Nature|arXiv", re.I)

bad = []
for r in RULES:
    if len(r) != 7:
        bad.append((r[0], f"has {len(r)} fields, expected 7"))
        continue
    rid, sev, pat, what, fix, why, src = r
    if not why or len(why) < 40:
        bad.append((rid, "no user cost, or too short to be one"))
    if not src or not CITES.search(src):
        bad.append((rid, "no citation"))
    if re.search(r"\b(ugly|cheap|tacky|amateur|looks bad|unprofessional)\b", why, re.I):
        bad.append((rid, "the stated cost is about taste, not the user"))
    if sev not in ("high", "med", "low"):
        bad.append((rid, f"bad severity {sev!r}"))

if bad:
    print("rules that would be class markers, not usability rules:", file=sys.stderr)
    for rid, why in bad:
        print(f"  {rid}: {why}", file=sys.stderr)
    sys.exit(1)

print(f"ok  {len(RULES)} rules, every one names a user cost and cites a source")
