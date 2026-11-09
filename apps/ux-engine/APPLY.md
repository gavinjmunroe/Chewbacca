# Applying it

Caleb, 2026-09-23: *"We don't need to re research how to design, we just need
to think through how to apply our knowledge in every vertical of ui/ux."*

The research in this repo is done. What kept failing is the step after it: a
build that never consults any of it, then gets measured afterwards and found
to be at 3 animations against a reference's 214. This file is the application
layer. Every row is a decision a build has to make, the constant that settles
it, and the thing that checks it.

The rule for using it: **declare before building, measure after.** A decision
made implicitly is a decision made at the median.

---

## 1. Stance. Pick one, commit, refuse the rest

`tools/stances.py` carries six: one-voltage, typographic, dense-instrument,
editorial, material, quiet-utility. Each names what it **refuses**.

The failure mode is not picking a bad one. It is picking none, which produces
a page with cards and boxes (`typographic` refuses those), a hero and
marketing copy (`dense-instrument` refuses those), and instrument-flavoured
graphics on top. That incoherence is what reads as derivative, because
borrowing one reference's surface without its underlying commitment is exactly
what it is.

**Check:** name the stance and the four things it refuses, in the repo, before
writing CSS. If the page violates its own stance, the stance was decoration.

## 2. Composition

| Decision | Constant | Source |
|---|---|---|
| Colour | grayscale first, colour last | crafts/interface.md |
| Spacing | `4 8 12 16 24 32 48 64 96`, never arbitrary | same |
| Hierarchy | size, weight, colour. Never position | same |
| De-emphasis | lower contrast BEFORE shrinking | same |
| Whitespace | overshoot, then remove | same |
| Order of work | layout, hierarchy, then details | same |

A layout that only reads once coloured is broken. A generator reaching for a
gradient before the spacing scale is hiding.

## 3. Density rhythm

The vertical nothing in this repo covered until `ux-film` measured it.

uselemma.ai swings **14 to 139 on-screen text elements**, a 9.9x range, across
one page. Dense hero, near-empty middle, dense again. That swing IS the
pacing, and it is why scrolling it feels composed rather than long.

A uniformly dense page has no rhythm no matter how good each section is.

**Check:** `ux-film` reports the swing. Under ~3x means the page has one
density and therefore one beat.

## 4. Motion class, per element

Declare which of these each animated element is. This is the vocabulary that
was missing entirely, and the reason motion read as decoration.

| Class | What it is | Gets used for |
|---|---|---|
| **SPAWN** | fires once on arrival, then holds | entrance choreography |
| **CONSTANT** | changes with no relation to scroll | signalling that something is live |
| **SCROLL-LINKED** | value is a function of scroll offset | the one that reads as magic |
| **STATE-SWAP** | steps between plateaus; the page re-rendered | building a scene as it is read |
| **STATIC** | never moves | most of the page, correctly |

**STATE-SWAP is the most underused and the most effective.** Lemma's trace
grid holds 42 rects constant while its text count goes 33 to 51 and its filled
count goes 0 to 9. Nothing animates. An animation-only capture calls that
scene static, and it is the best effect on their page.

A page whose motion is all SPAWN plays the same on every visit and ignores the
reader. That is the difference between animation and interaction.

**Check:** `ux-film lenses/<name>/film.json` classifies every tracked element.

## 5. Pace differentiation

Two scroll-linked elements moving at **different rates against the same
scroll** is what produces depth. One rate for everything reads as a sheet of
paper sliding.

**Check:** `ux-film` reports the correlation per element. Same-rate everywhere
is visible as identical r with identical slope.

## 6. Timing

| Thing | Value | Source |
|---|---|---|
| Stagger step | 30-80ms | motion/stagger.md |
| Stagger TOTAL | `(n-1) * step <= 400ms`, cap the count not the delay | same |
| Press | 100-160ms, `scale(0.97)`, `ease-out` | motion/press-feedback.md |
| Hover, colour | 50-150ms | same |
| Press vs release | must NOT share a duration | same |
| Interaction ceiling | 200ms. Past it, motion becomes latency | same |
| Scroll reveal travel | 16-32px. 400px is a ride | motion/reveal-on-scroll.md |
| Entry | under 300ms | same |
| Loops | `linear` only. An eased loop pulses | motion/measured-motion.md |

Stagger total is the most-violated of these. On 2026-09-23 all seven staggers
in one build were over the ceiling, the worst at 944ms against 400.

## 7. Entrance order follows READING order

Lemma's cascade: badge, headline line one, headline line two, subhead,
buttons, then the plots last. **What you read first arrives first, and the
decoration arrives last.**

The common failure, named in motion/measured-motion.md, is staggering by DOM
position or grid index, which builds a cascade that fights the reading order
instead of leading it.

## 8. Interaction

| Rule | Why |
|---|---|
| Gate hover behind `@media (hover: hover) and (pointer: fine)` | touch fires a false hover on every tap |
| `transform` and `opacity` only | 4 pages in 10 still animate layout properties |
| Never `ease-in` on a press | it delays the frame the finger is waiting for |
| Reveal once, never re-trigger | re-firing on every pass is noise |
| Never gate above-the-fold content | an animation holding the headline is a loading screen |

## 9. Reduced motion: reduce, do not delete

Keep the fade, drop the travel. Lemma runs 214 animations at load and 4 under
`prefers-reduced-motion`, which is 98% suppressed.

**And the denominator rule that came out of getting this wrong:** an earlier
version of measured-motion.md called that "NOT RESPECTED" on the strength of
the 4. A count without its denominator is the shape of a measurement rather
than a measurement.

---

## The order of operations

1. Name the stance and its refusals.
2. Grayscale layout on the spacing scale. No colour, no motion.
3. Plan the density rhythm: which viewports are dense and which are nearly
   empty. Target a swing above 3x.
4. Assign a motion class to every element that will move. Most should be
   STATIC. At least one scene should be STATE-SWAP.
5. Order the entrance by reading order, decoration last.
6. Apply the timing table.
7. `ux-crawl <url> --states film,hover,focus,narrow`, then `ux-film`, then
   `ux-lint`. Diff what was declared against what was measured.

Step 7 is not a formality. The first TTS build measured 3 animations against a
reference's 214, and its own linter returned clean, because the linter scores
the absence of tells and nothing scored ambition.
