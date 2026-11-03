---
name: project_travis_trials_2026_11_02
description: Travis Johnson's two Dough trials (AuraPath PIP law firms vs Botified, Baptize the World churches); reply sent 11/2, domains bought 11/3, first sends 11/13 to 11/18
metadata:
  type: project
---

Travis Johnson emailed 2026-11-02 with two trial briefs (saved in ~/Downloads/travis-tests).
Test 1 is AuraPath head-to-head against Botified: about 50 Michigan no-fault PIP law firms,
judged on meetings booked, sent from a separate Clay workspace on lookalike domains. Test 2
is Baptize the World: get pastors to register to baptize on Pentecost, May 16, 2027, with a
100-church sample, then 200, then 2,000 to 5,000.

Caleb replied 11/2 at 9:57pm from his USC inbox, cc Gavin. The reply says we cover both
trials (about $135 the first month for AuraPath, under $60 for Baptize), that the domains
getaurapath.com, aurapathhq.com and aurapath-ai.com get bought 11/3 with 6 Google Workspace
inboxes, and that warmup puts the first sends at 11/13 to 11/18. It asks six setup questions
and asks Travis to also judge on positive replies per 100, because Botified's published rate
(about 0.3 to 0.4 meetings per 100) makes 50 firms too few to pick a winner.

The PIP list ran through upgraded Dough (`gtme accounts --client aurapath-pip`, branches
fix/gtme-accounts-law-buyers and FF fix/audit-law-titles, not merged): 270 firms sourced,
27 with a confirmed owner and PIP work on their own site, 24 with treg-verified emails. Paid
email finds are cached in the client's accounts/emails.json so a rerun never pays twice.
The Botified teardown is in dough docs/competitors/botified.md and the plan is dough docs/IMPROVEMENT-PLAN.md.

Final state at 11:25pm 11/2, on main (Chewbacca 5011db02, firm-foundation 6962cbd): 267 firms
sourced, 45 send-ready leads with a sourced first line, a verified email and an owner named on
their own site. The review pack is ~/Downloads/travis-tests/AuraPath PIP list for Travis.md and
.csv, built by make_travis_pack.py next to them, and it goes to Travis after he answers. The copy
(copy/aurapath-pip-sequence.txt, 2 variants of 3) passes gtme-grade gates 2 and 3. Gates 1, 4
and 5 wait on Travis's postal address, his do-not-contact list and the senders from the 11/3
setup. Copy lines were hand-written per firm, and 5 firms are held in copy/aurapath-pip-leads-held.csv.

After midnight 11/3: Caleb ruled Dough doesn't depend on Clay (feedback_dough_owns_its_stack), so
sending runs through `gtme send` from the Workspace inboxes and no Clay account is needed; warmup
is the open choice (Instantly $47 or a hand ramp). The gold set is at
~/.chewbacca/gtm/clients/aurapath-pip/gold.csv (40 firms), and `gtme accounts --eval` scored
tonight's run at ICP precision 1.0, recall 0.786. The 6 misses are Michigan car and truck accident
firms whose sites never say no-fault or PIP. Whether those count as ICP is Travis's call. If yes,
widen icp.must_show and hand-write their lines. `gtme meeting` now credits meetings, and the week
report prints per-100 rates against a `benchmark` in the plan.
