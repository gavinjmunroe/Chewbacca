# Everything measured about uselemma.ai

One page, two days, 2026-09-26 to 27. Every number here was read off the
served payload or measured from the live DOM. Nothing is inferred from a
screenshot, because most of what was inferred from screenshots turned out to
be wrong.

Kept because these are the facts that evaporate. The method that produced them
is in `skills/clone-site/SKILL.md`; this is the output.

---

## Stack, measured across 107 downloaded chunks

Next.js App Router, React, Tailwind v4 (`oklch` present, no `tailwind` string
because v4 compiles away), Lenis for smooth scroll, Three.js in 2 chunks.

**Absent, each checked by grep across every chunk:** GSAP, Framer Motion,
react-spring, popmotion, embla, swiper, Lottie, `matrix3d`, `getTotalLength`,
`transition-delay`, Shadow DOM. Scroll behaviour is hand-rolled:
`requestAnimationFrame` in 17 chunks, `scrollY` in 10, `IntersectionObserver`
in 11.

**Source maps 404.** There is no TypeScript to recover, which is worth knowing
rather than assuming.

**Chunk discovery.** The HTML references 37 chunks; the webpack manifest lists 79. The generators were in the half nobody had fetched. Always parse the
manifest.

**Grep for magic constants, not for an API you guessed.** `setAttribute("cx"`
returns nothing because React does not emit that string. The literal `.5888`
lands in exactly the file that generates it.

## Component names, from the bundle's own exports

```
CellularAutomataFigure   GravLensFigure    HarmographFigure    SphereFigure
ExtrudedCubePreview      IsoGridPreview    EdgesToRender       TraceShowcaseVisual
ColorPanels              Agentation        SmoothScroll        Balancer
AlertsCopy               McpCopy           RegressionsCopy     PlumbDevtools
Button                   Code              Provider
```

This list turns "reverse engineer a complex site" from open-ended into a
finite checklist, and it costs one grep.

## Tokens

|                 |                                                                                   |
| --------------- | --------------------------------------------------------------------------------- |
| brand           | `#755CFE`                                                                         |
| deep navy       | `#322C8A`                                                                         |
| page background | `rgb(242,242,242)`                                                                |
| hairline        | `#d5d5d5`, softer `#e6e6e6`                                                       |
| plate label     | 8px, `font-mono`, uppercase, brand colour, custom SVG cursor with `help` fallback |

**Every font weight on the page is 400.** 21 `font-normal`, 12 `font-mono`,
1 `font-sans`, and zero `font-medium`, `font-semibold` or `font-bold`
anywhere. Hierarchy runs entirely on size, colour and opacity tiers
(`text-primary/25`, `text-primary/65`). Refusing weight as a tool is a large
part of why the page reads as an instrument rather than as marketing.

## Hero plates

Sizes are fixed pixels and identical at 1280, 1600 and 2456. Above 1600 every
plate shifts by exactly half the viewport growth, which is a capped centred
container. Offsets are coordinates inside a **1600px box that centres**.

| plate   | offset    | size    | contents                 | figure                 |
| ------- | --------- | ------- | ------------------------ | ---------------------- |
| LEM 1.1 | 178, 87   | 282×196 | 48 paths                 | gravitational lens     |
| LEM 1.2 | 1288, 141 | 158×214 | 12 lines + `<canvas>`    | extruded cube + shader |
| LEM 1.3 | 1111, 168 | 202×196 | 60 paths                 | harmonograph rosette   |
| LEM 2.1 | 149, 438  | 176×196 | 864 paths, 162 groups    | isometric tiling       |
| LEM 2.2 | 275, 510  | 202×205 | 100 paths                | sphere                 |
| LEM 2.3 | 1140, 456 | 229×196 | 2842 circles, 843 groups | cellular automaton     |

All six use `viewBox="0 0 100 100"`, `preserveAspectRatio="xMidYMid meet"`.

Percentage positioning cannot reproduce this: it scales the GAPS with the
viewport, and the composition depends on specific plates overlapping by
specific pixel amounts.

## LEM 2.3 is Wolfram Rule 30

Their component is `CellularAutomataFigure` and it decomposes the rule number
30 into its 8 bits.

- 40 cells wide, 50 generations, one live seed at index 20, **periodic**
  boundaries so the arms wrap rather than being clipped
- live cells `r=0.5888` opacity 0.85, dead `r=0.2208` opacity 0.3, ratio
  exactly 8/3
- placement `cx=(col+0.5)*2.5`, `cy=8+(row+0.5)*1.84`
- **842 live, 1158 dead.** Not a tuned density: it is what the rule produces
- revealed by a clip rect growing downward, `height = 8 + 1.84 × generation`,
  70ms per generation, 3500ms total, 33ms throttle, `IntersectionObserver`
  threshold 0, loop variant restarts at 5100ms so the hold is 1600ms
- reduced motion jumps straight to the finished state
- each live cell carries a transparent `r=1.012` hit target that mounts only
  after the reveal completes; clicking it moves the dot to a random empty
  orthogonal neighbour over 220ms

That last behaviour is why probing the live page for what drives `cx`/`cy`
found nothing twice. It needs a click, after an entrance.

**The trap:** a quadratic fitted to this plate's density,
`p(d) = -1.0125 d² + 1.4126 d + 0.0556`, matched to within a few percent and
described a mechanism the page does not use. A separable `p(row)·f(col)`
cannot express Rule 30's interior, which is chaotic on one side and periodic
on the other.

## LEM 1.2, the extruded cube

**Orthographic projection**, not isometric and not a 2D rotation. Unit cube at
±1, yaw about Y by `spin`, pitch about X by `tilt`, scale 22, centred in the
100×100 box. No perspective divide.

A rotated square gives a top-face diagonal ratio of 1.000. This gives **2.421**.
That ratio is the cheapest test for whether a cube is projected or just turned.

- starts at 35° yaw, 22° tilt
- cubic ease-out through one full turn in 1.2s, then **6°/sec indefinitely**
- pointer lean through a lerp at 0.08 per frame: ±45° yaw, ±35° pitch
- pauses off screen and **banks elapsed time**, so scrolling back resumes
  mid-drift rather than restarting
- edges are SVG `<line>`, stroke-width 0.25, opacity 0.85
- top face (vertices 3,2,6,7) is a clip-path polygon, and a **WebGL mesh
  gradient** renders inside it: `MeshGradient`, uniforms `u_swirl`,
  `u_distortion`, speed 0.4, distortion 4, swirl 1.2, grain mixed 0.5,
  overlaid 0.25

## Motion

24 named keyframes ship. The load is a **chain, not a stagger**:

```
lemma-cube-draw     1.1s  cubic-bezier(.65,0,.35,1)  delay 0.42s
lemma-cube-dashed   .36s  ease-out                   delay 1.52s
```

`0.42 + 1.1 = 1.52`. Each stage begins the frame the previous one ends. An
`index * 100ms` stagger cannot express that, because it never knows how long
anything takes.

Others worth having:

```
lemma-cube-flip   .9s   cubic-bezier(.34,1.3,.64,1)   1.3 overshoots: the pop
lemma-cube-word   1.25s cubic-bezier(.22,.8,.3,1)
lemma-cl-entry    .24s  cubic-bezier(.33,1,.68,1)
lemma-blog-fade-up .7s  cubic-bezier(.33,1,.68,1)     translateY(18px) + opacity
lemma-shine       .9s   background-position sweep, on hover
lemma-reel        translateY(0) to translateY(-10em)
maskRevealDown    clip-path inset(100% 0 0) to inset(0 0 0)
maskHideUp        clip-path inset(0 0 0) to inset(0 0 100%)
lemma-vt-bottom-up .6s  on ::view-transition-new(root)
```

They use the real **View Transitions API** for page navigation.

`transition: cx 220ms ease-out, cy 220ms ease-out` appears **842 times**, once
per live automaton cell.

Looping animations are gated behind `motion-safe:`.

Most common durations: 220ms (1684 occurrences), 450ms, 400ms, 600ms, 200ms,
150ms.

## Scroll

**38.1% of 9,133 measurable elements move at a rate strictly between pinned
and normal flow.** Clean bands at 0.20-0.25 (564 elements) and 0.85-0.95
(139), plus 52 faster than scroll and 55 pinned.

Hero exit is a **seven-layer depth stack** over ~576px, each layer travelling a
fixed distance: 500, 420, 412, 360, 240, 117, 78px, under one shared opacity
ramp from 1.0 to 0.015 over 552px, identical to three decimals across every
layer.

**Saturation distances are timing-independent and trustworthy. Instantaneous
rates near a scroll jump are not**, because Lenis has not converged inside a
30ms settle.

## Sections, in page order

1. Hero, holding the six plates above
2. Logo wall, label in a centre cell of the grid, cells populate and empty
   (`lg-cell`, r² 0.23-0.61, state-swapping rather than tweening)
3. "Agents in production fail in unpredictable ways": solid bricks land, become
   outlined chips with trace ids, some flip to a failure state with a quote
4. Isometric scenes: a tile ground plane, one cube, a headline with a number
   animating under blur, a large extruded form built from isometric cubes
   (`TraceShowcaseVisual`, chunk `8331`)
5. Trace waterfall panel with nested spans and durations
6. Slack mock (`slackTyping 1.2s ease-in-out infinite`)
7. Integrations: logo row plus two code panels
8. Testimonial carousel, 12 dots, 3 cards, column-constrained
9. Footer

## Corrections, each of which was stated confidently and was wrong

- "No parallax on the reference." The instrument sampled 26 of 9,133 elements
  and read each element's own `transform`, while the page animates containers,
  so a parallaxing child reports `transform: none`.
- "The `lemma-cube-*` keyframes are dead code." Four live keyframes driving the
  richest component on the page.
- "The hero generators are unrecoverable." They were in the 42 chunks not
  referenced by the HTML.
- "LEM 1.1 is 714 paths." It holds 48. The 714 was a page-wide total
  attributed to one plate.
- "The `cx` transition is dead CSS." It fires on click after the entrance.

---

## The counter is an odometer, from chunk `768`

The headline "sift through 526,565 traces" animates its number, and the blur in
a mid-count screenshot is not a transition artifact. It is built in.

- one reel per digit, six for a six-digit number
- each reel is a column of **11 cells**, `(start + i) % 10`, so it always has a
  wrap cell to land on and never shows a gap
- the column translates by `-10em`; `.lemma-reel-window` is `height: 1em`,
  `overflow: hidden`, `inline-block`, `align-baseline`
- each reel takes its own `start`, `duration`, `delay` and `blur`, and owns a
  private SVG filter `lemma-reel-blur-<idx>`. Six filters were observed across
  83 captured states, which is why per-digit blur reads as motion rather than
  as a single blurred number

Independent digit timings are what make it read as a mechanical counter instead
of a number fading in. A single element counting up cannot produce it.

## The headline wipe

`clip-path: inset(0 0 0 X%)` entering and `inset(0 X% 0 0)` leaving, with X
driven by `1 - (1-t)^3`, a cubic ease-out. Horizontal, not a fade.

The headline sits at `top: calc(var(--chrome-h, 3.5rem) + 60px)` with
`transition-[top] duration-300 ease-out`, gated by `motion-reduce`. Type is
`text-[32px]` at `md`, `text-[40px]` at `3xl`, `leading-[1.2]`, weight 400.

## TraceShowcaseVisual is the trace waterfall, not the isometric scenes

Chunk `8331` holds span types, tool calls, citations and status descriptions:
`ai.agent.run`, `ai.generateText`, `ai.toolCall`, `retrieve_context`,
`vector_search`. It is the waterfall panel with its demo trace.

The isometric scenes live with `IsoGridPreview` and `EdgesToRender` in `768`
and `2388`. Naming a component from its position on the page rather than from
its contents was wrong twice.
