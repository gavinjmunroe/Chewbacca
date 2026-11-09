---
name: project_dough_runs_ff_outbound_2026_11_03
description: Dough is being upgraded so Firm Foundation's outbound runs through it, and the order of the work
metadata:
  type: project
---

Dough (calebnewtonusc/dough) is the outbound product for founders. On 2026-11-03 Caleb decided Firm Foundation's own outbound should run through it: "we needa get it right to do our outbound for FF through it", and "we def gotta upgrade dough to do every medium of outreach".

Where it stood that day: Dough main (e99e598) only loads people into Dripify (LinkedIn). It has no email channel, no inboxes, no send ramp, no unsubscribe footer and no email reply handling, so FF's church emails keep going through Chewbacca's gtme until that exists. None of the 11/3 FF outbound fixes were in Dough.

The order agreed: update Dough's SPEC.md first (its CLAUDE.md rule), port the 11/3 gate fixes (https-only source, title-aware first name, eye check plus a live recheck, exclusion vetting, verify results kept, merge not overwrite), add an email channel that drives gtme, dry run FF DFW and SoCal through Dough against the gtme ledger, then switch FF over. Done means a real FF email went out through Dough with Caleb's ok. A branch feat/gate-from-ff was cut from origin/main in ~/code/wt-dough-gate with nothing edited yet.

Scope, set the same afternoon: "For dough we're gonna build everything we can into it across gtm - especially everything we can take from clay!" and "Whole point of Dough is the average joe doesn't hv to hire a gtme anymore". So the build list covers every step a hired GTM engineer does (sourcing, enrichment, research, signals, scoring, copy, gates, every send channel, replies, numbers), and the Clay features get rebuilt inside Dough rather than rented. That keeps feedback_dough_owns_its_stack (no Clay dependence) and project_dough_direction_2026_10_29 (no GTM knowledge needed) both true. A feature that needs the user to know GTM is off the path.

Related: project_ff_outbound_eye_review_2026_11_03, project_dough_page_2026_10_29, feedback_dough_owns_its_stack, project_dough_direction_2026_10_29.
