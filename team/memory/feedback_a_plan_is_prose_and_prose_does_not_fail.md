---
name: feedback-a-plan-is-prose-and-prose-does-not-fail
description: "Writing a good plan is not following it; a phase that must happen before building needs a gate that refuses the build, because nothing in a session can tell that prose is being ignored."
metadata:
  node_type: memory
  type: feedback
  originSessionId: fbc6e4f2-bde8-442d-97fe-35337209f230
  modified: 2026-09-27T23:29:53.135Z
---

Caleb, 2026-09-27: **"Fix chewbacca so you actually go through with the plans you
say you're going to."**

A `PLAN.md` was written for the site clone whose first phase was a measurement
pass, titled "Stop flying blind", with a full section inventory as its first
deliverable. It was never run. Seven sections got built overnight from
impressions instead. The whole of the next day then went on measuring those
seven one at a time and finding every one wrong: an invented brick wall, opacity
set on the wrong element, plate padding that did not exist, a tile field built as
a sheet when the reference draws a pentagon, and animation stages in the wrong
order.

Two sections reached parity in a day. At that rate twelve sections is two weeks.

Then, asked for a plan, I wrote a **second** one with the same measure-first
phase for the same reason, and he pointed at the real problem rather than the
page.

**Why:** the plan was never the weak part. Both plans were right. The weak part
is that a plan is prose, and **prose does not fail**. No step in a session can
detect that a document is being ignored, so "measure before building" reads as
advice at exactly the moment building looks more productive than measuring. This
is [[feedback_enforce_dont_document]] applied to planning itself, and it is the
same shape as a private note: the capability existed and
nothing made it run.

**How to apply:** when a plan has a phase that MUST precede the rest, give it a
machine readable gate, not a heading. `PLAN.md` now carries a `PLAN-GATES` block
naming, per phase, the artifacts that must exist and the path prefixes writable
until they do. `~/.claude/hooks/plan-guard.sh` walks up from any edited file, finds
the first phase whose `requires` are absent, and exits 2 on a write outside that
phase's `allows`. Shipped in Chewbacca at `.claude/hooks/plan-guard.sh` and
registered in `setup.sh`; inert in any repo whose plan has no such block.

It deliberately checks only that the artifacts EXIST, never that they are good. A
hook cannot read a delta ledger and know whether it is honest. It closes the
"never started" hole, which is the one that actually happened.

Two-sided, exit codes measured directly because `| head` eats `$?`
([[feedback_measure_exit_codes_directly]]): phase 0 active blocks `src/app.js` at
exit 2 and allows `docs/` at 0; with phase 0 satisfied it advances and allows
`src/app.js`; a repo with no plan is untouched. It then refused a real Write to
`lemma-replica/src/`, so it has stopped something rather than merely existing
([[feedback_a_silent_guard_proves_nothing]]).

Related: [[feedback_enforce_dont_document]], a private note,
[[feedback_a_silent_guard_proves_nothing]], a private note,
[[feedback_always_land_on_main]]
