# Ambient agent

Researched 2026-09-20. Extends `crafts/interface.md` (visual system, component
taxonomy) and `crafts/web-ux.md` (page craft) in the chewbacca repo. Those two
govern what a surface looks like. This one governs **whether it should appear
at all, and who decided.** Rules only, each falsifiable, each sourced.

The genre is ambient and agentic interfaces. It is thirty years old and most of
its hard questions were answered before the word "agent" was marketing.

## Calm technology

Source: Weiser and Brown, *The Coming Age of Calm Technology*, Xerox PARC 1996.

**1. Design for the periphery, which is what someone is attuned to without
attending to.** Their example is driving: road and radio at the center, an
unusual engine note noticed instantly, which proves it was tracked all along.
The periphery has enormous capacity because the brain devotes large resources
to it. An ambient agent that only knows how to occupy the center has thrown
that capacity away.

**2. A calm thing moves both ways, and the user owns the move.** Periphery to
center and back. Their sharpest claim is that **recentering is an act of
control**: "By recentering something formerly in the periphery, we take control
of it." Without that, peripheral awareness turns anxious. So every ambient
surface needs a way to promote it to full attention on demand, and a way to
push it back.

**3. Less bandwidth can mean more calm.** Verbatim: *"Less is more, when less
bandwidth provides more calmness."* Their Multicast example is a low-fidelity
always-on video window that works **because** it is partial. Resolution is not
the goal.

**4. The way to be attuned to more is to attend to it less.** This is the
paper's central counterintuitive claim and it inverts the usual instinct to
make the important thing bigger and louder.

**5. Aim at locatedness**, which they define as being at home in your
environment: connected to what has happened, what is happening, and what is
about to happen. That is the actual target feeling, and it is a better brief
than "feels magical" because you can check it.

**6. Pre-attentive beats symbolic.** The Dangling String is eight feet of
plastic spaghetti twitching with each Ethernet packet. They argue it beats a
screen-based traffic monitor because the brain's peripheral centers match a
physical motion better than symbols needing interpretation. **A number that has
to be read is already in the center.** Prefer motion, size, position and color
for anything meant to live at the edge.

## What an interruption actually costs

Source: Mark, Gudith and Klocke, *The Cost of Interrupted Work: More Speed and
Stress*, CHI 2008. Controlled experiment, 48 subjects.

**7. Relevance does not buy you an interruption.** Their headline surprise:
same-context interruptions (on the subject you were already working on) cost
exactly as much as unrelated ones. **What mattered was that the interruption
happened at all.** This kills the most common design excuse, "but it was
relevant to what they were doing."

**8. The cost does not show up in output, so you cannot see it.** Interrupted
subjects finished *faster* and wrote shorter messages with no measurable drop
in quality or politeness. The entire price was internal: significantly higher
stress, frustration, time pressure, effort and mental workload after only
about 20 minutes. **An ambient agent that looks harmless by its own metrics
can still be costing the user real load.**

**9. Throttle the cumulative volume, not the individual alert.** Their own
design conclusion. Some interruption load is absorbable, the costs accumulate,
and the study could not establish a plateau. So the budget is the control, and
it must be per period rather than per event.

The widely quoted "23 minutes 15 seconds to resume" is from Mark's separate
field work and is contested in secondary sources. [NEED: primary citation
before this number goes in anything user-facing.] Nothing here depends on it.

## Alert fatigue, from the field that has studied it hardest

Source: clinical decision support literature, systematic reviews 2017 to 2026.

**10. A correct alert is not a wanted alert. Override rates for drug interaction alerts
exceed 85%, and in some deployments 90%+**, including alerts graded very
severe. These are medically correct warnings in a life-and-death setting,
ignored nine times in ten. A correct alert and a wanted alert are different
things, and the gap is enormous.

**11. Noise makes you slower on the signal.** Where alert streams carry a high
proportion of non-actionable items, clinician response time to *genuine* events
increases and override rates rise. **A noisy ambient agent is worse than no
agent, and not just aesthetically: it degrades the response to the real thing.**

**12. The metric is declining appropriate-response rate, not alert count.**
Kane-Gill's proposed operationalization. Counting how much it said tells you
nothing. Counting how often the user acted on what it said tells you everything.

**13. The cost asymmetry is not symmetric, so the threshold should not be
centered.** A false negative costs one missed event. A false positive costs
trust across every future alert, because trust is calibrated on the stream
rather than the instance. Two bad interrupts is the user's stated tolerance
here. **Set the bar where a miss is cheaper than a wrong hit.**

## Voice

Sources: Nielsen Norman Group, *The Paradox of Intelligent Assistants: Poor
Usability, High Adoption*; VUI design literature on cognitive load.

**14. Voice is transient, serial and non-persistent**, so it loads short-term
memory in a way a glance does not: the listener cannot re-read a sentence,
cannot skim, and cannot see what options lie ahead.

**15. Voice has command-line discoverability.** Functions are hidden and must
be known in advance.

**16. So voice out earns its place only when the eyes and hands are busy AND
the message is one short imperative that needs no recall.** For status, lists,
numbers, anything re-readable or ignorable, **a glance beats speech**, and the
peripheral display is strictly better. Caleb's suspicion that a talking agent
is the wrong instinct is supported by the literature, and the honest version is
stronger than he put it: **a proactive voice agent is the single easiest way to
build something that gets muted in a week**, because it forces every message
into the center and cannot be scanned or deferred.

## Agentic interfaces

Source: scifiinterfaces.com's critique of the Iron Man HUD, plus shipped-agent
teardowns.

**17. Do not build a placebo interface.** The critique of JARVIS's HUD is that
it is "a placebo interface meant to keep Tony thinking he's in control, but
really there to direct his attention while JARVIS does the job." An agentic
display that shows activity rather than affording control is theater. **If the
user cannot change the outcome from the surface, do not render the surface as
though they can.**

**18. Report what was done, with an undo, rather than asking first for
everything.** Confirmation on every act is pull with extra steps. Reserve the
prompt for actions that are outward-facing or hard to reverse, and make
everything else an after-the-fact line with a way back.

## JARVIS: real design versus movie affordance

Separated explicitly, because "JARVIS had it" is not a reason.

| JARVIS does | Real interaction design, or movie? | Why |
| --- | --- | --- |
| Interrupts only when it matters | **Real, and the hardest part.** | This is rules 7 to 13. It is the whole problem, and the films get it right by never showing a bad interrupt |
| Speaks a single short imperative under load | **Real.** | Rule 16: hands and eyes are busy, message is one action |
| Acts across many systems, then reports | **Real.** | Rule 18 |
| Pushes back without taking control | **Real.** | Trust calibration; an agent that never disagrees is not trusted, it is ignored |
| Persistent ambient awareness with no session | **Real.** | This is the ubicomp thesis, and it is the actual gap |
| Dense HUD showing everything at once | **Movie.** | Contradicts rules 1, 3, 6 and 17. It exists to make Tony look like a genius to the audience. It is a placebo |
| Understands fully-ambiguous speech in a noisy fight | **Movie.** | Bandwidth problem: the user must still state the need clearly and in time |
| Volumetric holograms manipulated in free air | **Movie.** | No haptics, arm fatigue, and nothing to rest against |
| Perfect confidence with no failure mode shown | **Movie, and the dangerous one.** | The films never show JARVIS wrong. Every real deployment is defined by what happens when it is |

## When the brief contradicts these

The usual asks are "make it talk", "make it proactive about everything" and
"show me more on screen". All three are named failures above. Say which rule it
breaks, in one line. Build the version with a budget, a periphery and an undo.
Offer the loud version as a separate mode that is off by default. Silently
delivering either one is wrong.
