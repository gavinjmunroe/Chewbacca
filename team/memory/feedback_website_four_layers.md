---
name: feedback_website_four_layers
description: "Caleb's bar for every website after the uselemma.ai replica (2026-10-03): four layers, site-gate exit 0, never a replica, every link live."
metadata:
  node_type: memory
  type: feedback
  originSessionId: bdf89203-2fef-4e88-b8bc-ad9621f58ff7
  modified: 2026-10-04T06:37:56.189Z
---

**2026-10-03.** After a week rebuilding uselemma.ai, Caleb: "fully learn from
everything this whole process taught you, so every website we make moving
forward is held to this standard", then "This whole process was to learn what
it takes to make a perfect website" and the TTS/T Combinator sites "should not
be replicas, and they should not be the same style". Also: "ALWAYS graph
engineer!!!!!!!!!"

**What it taught.** The replica matched layout for a week and read dead. A
site is four layers and a screenshot shows one: layout, choreography (timed
vs scroll clocks, one progress value, one shared curve), ambience (what moves
at rest: the reference had six loops we lacked) and response (hover, focus,
pressed, keyboard, every link going somewhere real, subpages that exist).
Reading their shipped bundle beat days of fitting curves.

**Why:** a page that passes every screenshot comparison can still feel like a
mockup in the hand, and Caleb feels that instantly ("WAYYYYY better! Super
far from perfect tho").

**How to apply:**

- Read `~/code/chewbacca/library/crafts/website.md` (and `web-ux.md`) before
  building any site.
- `site-gate check <every route>` must exit 0 and `site-gate idle` must show
  the planned ambient layer before calling a site done. It is enforced in the
  interface and clone-site skills and the deploy gate.
- An original site is never a replica: three directions, chosen by the
  reader, with a deny list. See a private note
  and [[feedback_tasteful_editorial_is_the_new_slop]].
- Graph it: split by file ownership, run tracks in parallel, verify with a
  separate context. See a private note.
- Chromium on Metal (`--use-angle=metal`) when measuring a WebGL page, or
  the numbers measure the test rig.

Related: a private note, [[feedback_read_the_bundle_before_measuring]].

**Correction, 2026-10-04.** The first TTS/TC rebuild passed every gate and
carried no false claim, and Caleb called it "infinitely more ugly and boring
than the lemma site and way too text heavy". The brief demanded restraint and
never demanded spectacle. Measured: Lemma 0.52 figure share with motion on
19/19 screens; ours 0.04 and 0.00. Words per screen did NOT separate them.
Now `site-gate story` fails under 0.35 figure / 60% motion screens. Every
site needs an intro that is an event (generative figures, load clock, depth
exit; Caleb: "the coolest intro ever bruh") and a scroll story told by ONE
set of objects changing state. Restraint governs claims and colour only.

