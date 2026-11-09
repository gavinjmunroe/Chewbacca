# The award-winning web corpus

Researched 2026-09-20. **Method matters here and is auditable.** The corpus was
built from primary sources: Awwwards' own galleries and 35 per-site detail
pages (jury score, award date, studio, tech tags, and Awwwards' own labels for
the element that won), CSSDA's Website-of-the-Year posts, and the FWA's
undocumented public JSON API. Then **33 live winner sites were fetched along
with up to 6 JS bundles and 5 stylesheets each: 131 JS files, 65 CSS files,
roughly 30MB, grepped for library signatures.**

So the counts below are measured, not recalled. Where a number is inferred
rather than published, it says so. All library counts are **floors**, because
at most 6 scripts per site were fetched and dynamic imports are invisible.

## The published rubrics

### Awwwards

| Criterion | Weight |
|---|---|
| Design | **40%** |
| Usability | **30%** |
| Creativity | **20%** |
| Content | **10%** |

Minimum 18 jury members score each site and the system **automatically
discards the 3 scores furthest from the average**. Honorable Mention at 6.5+.
The Developer Award requires above 7 from a separate developer jury.
Submission costs **$65**.

**Calibration, from the scrape:** across 35 Site-of-the-Month and
Site-of-the-Year winners, jury scores run **7.45 to 8.25**. Nobody in three
years cleared 8.3. **Plan to a 7.9, not a 9.**

### The FWA

Up to 100 points. The published bands, extracted from the live jury copy:
0-69 "nothing scores here", 70-79 FWA of the Day worthy, 80-89 "a great FWA of
the Day example", 90-100 FWA of the Month worthy. The brief is unusually
explicit about grade inflation: *"A great FWA judge is one who recognises FWA
worthy work and scores it accordingly, rather than someone who frequently
scores low."*

Observed from the API: FOTD around 81, FOTM 83-90, FOTY 87-93.

### CSS Design Awards

Three criteria, UI Design / UX Design / Innovation, 10-point scale, no
published weights. Website of the Day needs above 8.0. **WOTY winners score
9.03 to 9.06, so CSSDA's scale runs visibly hotter than Awwwards' for the same
class of work.**

### The Webby Awards

Seven criteria, no published weights and no published scoring method. **Webby
is the only one of the four whose rubric puts Content first**, and also the
least transparent about arithmetic.

### What no rubric contains

**Not one of the four publishes a performance budget, a Core Web Vitals
threshold, or a WCAG conformance level.** Awwwards' Developer Award mentions
accessibility in prose and attaches no criterion to it. This is the single most
load-bearing fact in the section below.

## The recurring techniques, ranked by measured frequency

1. **Scroll is the timeline, not a scrollbar.** ScrollTrigger on 13/23. The
   sharp version of the rule, from Ponpon Mania: **normalise scroll to a single
   0-1 value and feed it to shader uniforms**, rather than wiring individual
   animations to individual triggers.
2. **Custom smooth scroll as a hard dependency.** **Lenis on 18/23, the single
   most common library in the corpus, more common than GSAP itself.** Also the
   most-attacked technique. Best practice is Trionn's: drive Lenis from
   `gsap.ticker` so scroll and animation share one clock.
3. **Real-time 3D as the page, not a widget.** `3D` is the top Awwwards tag at
   17/35.
4. **Transitions as authored content.** A transition is treated as a scene with
   its own budget, not an effect.
5. **Per-character typography.** GSAP SplitText on 11/23. Cheap and universal.
6. **Sound as a coupled input, not decoration.** Web Audio on 9/23, and sound
   studios appear as **credited co-authors** rather than vendors. Igloo syncs
   particle colour to audio; Trionn drives fog from a live `AnalyserNode`.
7. **The cursor as an input channel.** "Mouse Fluid", "Reactive cursor
   interaction". **Velocity, not position, is what gets read.**
8. **Make it playable.** Three of the four FWA-of-the-Year winners in this
   window are games or game-adjacent.
9. **The loader and the intro are content.** Nobody here treats the wait as
   dead time. The Line Studio's winning element label is "Loading 24FPS", an
   animation studio whose loader animates on twos.
10. **Generate geometry instead of shipping it.** Igloo wrote a custom
    ice-crystal growth algorithm and a bespoke VDB-to-browser volume exporter.
    The stated reason is bandwidth.
11. **Post-processing as brand.** Igloo uses chromatic aberration and frost as
    a continuity device *between sections*: a transition, not a filter.
12. **Physics is rarer than the discourse suggests.** 2-3/23.
13. **Rive is displacing Lottie.** 3/23 against 4/23, a dead heat in a category
    Lottie used to own.

## The technology, measured

| Signature | Sites |
|---|---|
| **Lenis** | **18/23** |
| GSAP ScrollTrigger | 13/23 |
| GSAP core | 12/23 |
| GSAP SplitText | 11/23 |
| **Nuxt** | **10/23** |
| Webflow | 6/23 |
| Three.js | 5/23 strict, ~10/32 loose |
| Draco / glTF | 5/23 |
| Web Audio | 9/23 loose |
| Barba / Taxi / Swup | 4/23 |
| Lottie | 4/23 |
| Rive | 3/23 |
| Physics | 2/23 |
| **Next.js** | **2/23** |

### Hype with no measured footprint

- **Framer Motion: 0 of 32 sites.**
- **React Three Fiber: 0 of 32.** This corpus writes Three.js by hand. Trionn's
  team says so outright: "direct render loop control instead of React Three
  Fiber."
- **Spline: 0 of 32.**
- **WebGPU: one real instance**, Food for Fish, FWA of the Year 2025.
- **React is a minority position.** Nuxt/Vue outnumbers Next.js 10 to 2.

**This contradicts `~/.claude/rules/design-system.md`**, which mandates
Framer Motion for interactivity and React/Next as the default stack. Zero of
the 32 most-awarded sites on the web use Framer Motion. The house rule is not
wrong for product UI, where React dominates, but it is measurably wrong as a
description of award-grade work.

### The winning stack, stated plainly

**Nuxt or Webflow, then Lenis driven from `gsap.ticker`, then ScrollTrigger
normalising scroll to 0-1, then that value pushed into Three.js shader
uniforms, then SplitText on the type, a Draco-compressed glTF pipeline, Web
Audio coupled to the visuals, and a router that treats page transitions as
scenes.**

Note what is absent: React, Framer Motion, R3F, Spline.

## The case against, which is strong

### Scrolljacking is the industry's own diagnosis

NN/g's study: *"the majority of participants experienced at least mild
disorientation."* Disorientation increased with the duration of the jack, users
interpreted it as a bug and tried workarounds, and task-oriented users
tolerated it far less than exploratory ones.
[Scrolljacking 101](https://www.nngroup.com/articles/scrolljacking-101/)

A 2025 peer-reviewed usability investigation reports a **statistically
significant** drop in both accuracy and satisfaction versus normal scrolling.
Participant count **[UNVERIFIED]**, abstract only, paywalled.

Alex Harper's framing is the sharpest: scrolljacking is **"control theft
wrapped in prettier code"**, and the soft versions, parallax reveal, scroll
snapping, inertia damping, are the same override "wrapped in better PR."

### The structural critique

From [Tenet](https://www.wearetenet.com/thoughts/design-awards-vs-real-ux-results):
the rubric itself weights Design plus Creativity at **60%** against Content at
**10%**; judges score a curated submission package rather than a live product,
and "award-winning microsites often become defunct within a year"; the $60-150
entry fee filters out small studios; and the entries are often non-billable
pro-bono builds costing $5-20k of studio time.

### What the scrape measured directly

These are checkable against the same 32-site fetch:

- **Only 11 of 23 sites reference `prefers-reduced-motion` anywhere.** Roughly
  half the most-awarded motion work on the web has no documented respect for
  the OS-level "stop moving things" setting.
- **8 of 32 serve fewer than 60 words of text in the initial HTML.** Messenger
  ships **1 word**. Nothing is readable until the JS lands.
- **13 of 32 have no `<h1>` in the initial HTML.**
- **JS weight, counting only first-response scripts:** Bruno Simon **4.7MB in
  a single bundle**, Zentry 2.9MB, Immersive Garden 2.5MB. Median across 28
  sites: **~555KB**. Textures, models and lazy chunks all excluded, so every
  figure is a floor.
- **None of this costs a site a single point**, because no award body publishes
  a threshold for any of it.

### Three winners that break the house style from inside

- **Zentry** (Resn, SOTM + Developer Award) **deliberately avoided WebGL** and
  built its 3D portal masks in DOM and CSS, for memory and load reasons.
- **Terminal Industries** (SOTM Sep 2025) is tagged "CSS, Vue.js, Vercel". No
  3D, no WebGL, and it still took Site of the Month.
- **Dropbox Brand** took **CSSDA Website of the Year 2025, CSSDA Best UX and a
  Webby for Best User Experience** on Webflow and Lottie with no WebGL at all,
  and it ships more reduced-motion handling than most of the 3D corpus. The
  mechanism: the brand guidelines *are* the toys. "Iconography Slot Machine",
  "Motion Easing Demo", "Typography Cursors".

And **Don't Board Me** won Awwwards Site of the Year Users' Choice 2024 on
copywriting, illustration and a funny 404 page.

## The synthesis

**The corpus does not say "3D wins." It says a single committed, coherent
mechanism wins**, and 3D is merely the most common way to buy one.

The counterexamples share the property that the WebGL entries have: one idea,
executed past the point where it would have been sensible to stop. Igloo wrote
an ice-crystal growth algorithm. The Line Studio made its loader animate on
twos. Dropbox turned its brand guidelines into toys. Don't Board Me wrote a
genuinely funny 404.

**Pick one mechanism, couple everything to it, and skip the rest.** The award
sites that also survive the counter-case (Dropbox, Terminal Industries,
Zentry, Tracing Art) are the ones where the single mechanism did not require
overriding the browser to work.
